"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEditor, useEditorState, type Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import {
  ArrowLeft,
  Check,
  CloudUpload,
  Eye,
  History,
  Settings2,
} from "lucide-react";

import { EditorBody, insertImages, pickImages } from "@/components/editor/editor-body";
import { EditorBubbleMenu } from "@/components/editor/bubble-menu";
import { SlashMenu } from "@/components/editor/slash-menu";
import { EditorToolbar } from "@/components/editor/toolbar";
import { useFeedback } from "@/components/feedback";
import { Tooltip } from "@/components/overlay";
import { Button } from "@/components/ui";
import { editorOnlyExtensions, sharedExtensions } from "@/lib/tiptap/extensions";
// 从 plain-text 而非 sanitize 导入：sanitize 会拉入 @tiptap/html/server
// （连带 happy-dom 与 fs），那是服务端专属依赖，进不了浏览器包
import { extractPlainText } from "@/lib/tiptap/plain-text";
import { toPlainJson } from "@/lib/json";
import { slugify } from "@/lib/url";
import type { SeoFormValues } from "@/lib/seo/schema";
import {
  formatDraftTime,
  shouldOfferRecovery,
  useLocalDraft,
} from "@/lib/use-local-draft";
import {
  createPreviewLinkAction,
  publishPostAction,
  revertToRevisionAction,
  saveDraftAction,
} from "@/server/actions/post";

import { RevisionsModal, type RevisionItem } from "./RevisionsModal";
import { SettingsDrawer } from "./SettingsDrawer";

/**
 * 文章编辑器。
 *
 * 布局按「写作优先」组织：顶部一条操作栏，往下依次是标题与正文，
 * 占满整个可用高度且中间不插任何设置项。设置（slug / 分类 / 标签 / SEO）
 * 收进右侧抽屉，版本历史收进模态——两者都不是写作过程中要一直盯着的东西。
 *
 * 状态全部集中在这里，抽屉与模态只做展示。原因是保存时要一次性拿到所有字段，
 * 若各组件各存一份，两边的值迟早会不同步（如抽屉里改了分类但提交的是旧值）。
 */

type SaveKind = "draft" | "publish";

export interface PostEditorProps {
  post: {
    id?: number;
    title: string;
    slug: string;
    excerpt: string;
    contentJson: unknown;
    categoryId: number | null;
    tagIds: number[];
    /** 服务端最后更新时间，用于判断本地草稿是否更新 */
    updatedAt?: string;
  };
  seo: SeoFormValues;
  categories: { id: number; name: string; depth: number }[];
  allTags: { id: number; name: string }[];
  revisions: RevisionItem[];
}

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

export function PostEditor({
  post,
  seo: initialSeo,
  categories,
  allTags,
  revisions,
}: PostEditorProps) {
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const [pending, startTransition] = useTransition();

  const isNew = post.id === undefined;

  const [title, setTitle] = useState(post.title);
  const [slug, setSlug] = useState(post.slug);
  const [excerpt, setExcerpt] = useState(post.excerpt);
  const [categoryId, setCategoryId] = useState<number | null>(post.categoryId);
  const [tagIds, setTagIds] = useState<number[]>(post.tagIds);
  // 现场新建的标签名。提交时交给服务层 resolveTagIds upsert，
  // 避免用户先跳去标签页创建再回来
  const [newTagNames, setNewTagNames] = useState<string[]>([]);
  const [seo, setSeo] = useState(initialSeo);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  /**
   * 预览链接单独用 state 而非 toast：链接需要被选中复制，
   * 自动消失的提示做不到这件事。
   */
  const [previewLink, setPreviewLink] = useState<string | null>(null);
  /** 最近一次写入本地草稿的时间，用于在顶栏给出安静的「已存本地」反馈 */
  const [localSavedAt, setLocalSavedAt] = useState<string | null>(null);

  const editorRef = useRef<Editor | null>(null);

  const editor = useEditor({
    extensions: [...sharedExtensions, ...editorOnlyExtensions],
    content: (post.contentJson as object) ?? EMPTY_DOC,
    // SSR 期间不立即渲染，避免 hydration 不匹配
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "prose prose-article max-w-none min-h-[28rem] px-6 py-6 focus:outline-none sm:px-8",
      },
      /**
       * 粘贴与拖入的图片都走上传接口。
       *
       * 两者都必须在这里拦截，不能挂在包裹层的 onPaste / onDrop 上：
       * ProseMirror 在 contenteditable 自身监听这两个事件，事件冒泡到外层时
       * 浏览器的默认行为已经执行（图片以 base64 直插，或整页跳转到图片地址），
       * 那时再 preventDefault 已经晚了。
       *
       * 返回 true 表示已处理，ProseMirror 不再插入默认内容。
       */
      handlePaste: (_view, event) => {
        const files = pickImages(event.clipboardData?.files ?? null);
        const instance = editorRef.current;
        if (files.length === 0 || !instance) return false;

        void insertImages(instance, files, undefined, (m) => toast(m, "error"));
        return true;
      },

      handleDrop: (view, event, _slice, moved) => {
        // moved 为真说明是编辑器内部的块拖动重排，不是从外部拖入文件
        if (moved) return false;

        const dragEvent = event as DragEvent;
        const files = pickImages(dragEvent.dataTransfer?.files ?? null);
        const instance = editorRef.current;
        if (files.length === 0 || !instance) return false;

        dragEvent.preventDefault();

        /*
         * 插到鼠标松开的位置，而不是文档开头或光标处——
         * 拖拽的语义就是「放到这里」。
         *
         * 用 clientX/clientY 而非 event.offsetX：offsetX 是相对目标元素内部的
         * 偏移，落到嵌套节点上时参照物会变，算出来的位置会偏。
         */
        const at = view.posAtCoords({
          left: dragEvent.clientX,
          top: dragEvent.clientY,
        })?.pos;

        void insertImages(instance, files, at, (m) => toast(m, "error"));
        return true;
      },
    },
  });

  /**
   * 同步编辑器实例到 ref。
   *
   * 粘贴处理挂在 editorProps 上，那是 ProseMirror 的 DOM 事件回调，
   * 不在 React 的渲染链里，拿不到后续渲染的新闭包。用 ref 读到当前实例，
   * 避免把 useEditor 的配置项变成随时间失效的旧值。
   */
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // -------------------------------------------------------------------------
  // 本地草稿
  // -------------------------------------------------------------------------

  const snapshot = useCallback(
    (): { title: string; contentJson: JSONContent } => ({
      title,
      contentJson: editor?.getJSON() ?? EMPTY_DOC,
    }),
    [title, editor]
  );

  const { draft, schedule, saveNow, clear } = useLocalDraft(
    post.id,
    snapshot,
    Boolean(editor)
  );

  /**
   * 内容变化后写本地草稿。
   *
   * 订阅 update 事件而不是把 onUpdate 挂在 useEditor 上：那样每次渲染都会
   * 重建回调，而 schedule 本身已用 ref 持有最新的 snapshot，不需要重订阅。
   */
  useEffect(() => {
    if (!editor) return;

    const onUpdate = () => {
      schedule();
      setLocalSavedAt(new Date().toISOString());
    };

    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
    };
  }, [editor, schedule]);

  /**
   * 关页面前把草稿落盘。
   *
   * 只依赖 debounce 会丢掉最后不到 1 秒的输入——用户往往就是打完最后几个字
   * 立刻切走，那段内容恰恰是最新的。
   */
  useEffect(() => {
    const onBeforeUnload = () => saveNow();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saveNow]);

  /**
   * 提示恢复本地草稿。
   *
   * 用 ref 保证只问一次：React 严格模式下 effect 会跑两遍，
   * 否则用户会看到两个叠在一起的确认框。
   */
  const askedRecovery = useRef(false);
  useEffect(() => {
    if (!editor || askedRecovery.current) return;
    if (!shouldOfferRecovery(draft, post.updatedAt)) return;
    askedRecovery.current = true;

    const savedAt = draft!.savedAt;
    void confirm({
      title: "发现未保存的本地内容",
      description: `浏览器里留有一份 ${formatDraftTime(savedAt)} 的记录，比服务器上的版本新。要恢复到编辑器吗？选择「丢弃」会删掉这份本地记录。`,
      confirmLabel: "恢复",
      cancelLabel: "丢弃",
    }).then((ok) => {
      if (ok) {
        setTitle(draft!.title);
        editor.commands.setContent(draft!.contentJson);
        toast("已恢复本地内容", "success");
      } else {
        clear();
      }
    });
  }, [editor, draft, post.updatedAt, confirm, toast, clear]);

  // -------------------------------------------------------------------------
  // 保存与发布
  // -------------------------------------------------------------------------

  function collectInput() {
    return {
      ...(post.id ? { id: post.id } : {}),
      title,
      slug,
      excerpt,
      // 必须经 toPlainJson 归一：Tiptap 的 attrs 是 Object.create(null) 的无原型对象，
      // 直接传给 Server Action 会被 React 当作不可序列化而替换成客户端引用，
      // 服务端渲染时读属性即抛错（详见 lib/json.ts）
      contentJson: toPlainJson(editor?.getJSON() ?? EMPTY_DOC),
      categoryId,
      tagIds,
      newTagNames,
      seo,
    };
  }

  /**
   * 经 ref 读取最新的 collectInput。
   *
   * collectInput 每次都按当前 state 重建，直接引用它会让下面的 runSave
   * 跟着一起变化；而 ref 在每次渲染后由 effect 同步，在用户能触发
   * 键盘事件之前必然已是最新。这样 runSave 才能保持引用稳定。
   */
  const collectInputRef = useRef(collectInput);
  useEffect(() => {
    collectInputRef.current = collectInput;
  });

  /**
   * 落库。
   *
   * 返回是否成功，便于调用方串联后续动作（如预览要先落草稿再签发链接）。
   */
  async function savePost(kind: SaveKind, silent = false): Promise<boolean> {
    setFieldErrors({});

    const input = collectInputRef.current();
    const result =
      kind === "draft" ? await saveDraftAction(input) : await publishPostAction(input);

    if (!result.ok) {
      setFieldErrors(result.fieldErrors ?? {});

      /**
       * toast 里带上具体缺了什么。
       *
       * 只说「SEO 信息不完整」的话，用户打开抽屉仍要自己逐个字段找红字——
       * 抽屉很长，SEO 区在最下面，滚不到就等于没有提示。
       * 这里把字段错误摘出前两条拼进提示，超出的折叠为「等 N 项」。
       */
      const details = Object.values(result.fieldErrors ?? {}).flat();
      const summary =
        details.length === 0
          ? result.error
          : details.length <= 2
            ? `${result.error}：${details.join("；")}`
            : `${result.error}：${details.slice(0, 2).join("；")} 等 ${details.length} 项`;
      toast(summary, "error");

      // SEO 校验失败时打开抽屉，否则用户在编辑区看不到任何错误提示
      if (Object.keys(result.fieldErrors ?? {}).some((k) => k.startsWith("seo."))) {
        setSettingsOpen(true);
      }
      return false;
    }

    // 落库成功，本地草稿已完成使命。留着它下次打开会误报「有未保存内容」
    clear();

    if (!silent) {
      toast(kind === "draft" ? "草稿已保存" : "已发布", "success");
    }

    /**
     * 新文章拿到 id 后必须换地址。
     *
     * 这里刻意不区分草稿与发布：两者都会创建记录并返回 id。
     * 若只在 kind === "draft" 时替换（改版前的写法），新文章点「发布」后
     * URL 仍停在 /admin/posts/new——刷新即变回空白新建页，看起来像发布失败、
     * 内容丢失，再点一次还会重复创建一篇。
     */
    if (isNew && "id" in result.data) {
      router.replace(`/admin/posts/${result.data.id}`);
    } else {
      router.refresh();
    }
    return true;
  }

  /**
   * 触发保存。
   *
   * 用 useCallback 保持引用稳定：Ctrl+S 的 effect 依赖它，
   * 若每次渲染都换新函数，监听会反复重挂，快速连按时容易漏掉事件。
   */
  const runSave = useCallback(
    (kind: SaveKind, silent = false) => {
      startTransition(async () => {
        await savePost(kind, silent);
      });
    },
    // savePost 与 startTransition 都不随渲染变化，真实依赖只有下面这些
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast, clear, isNew, router]
  );

  /**
   * Ctrl/Cmd+S：先落本地再存库。
   *
   * 本地写入是同步的，先做能保证即使请求失败也不丢内容。
   */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key !== "s") return;
      e.preventDefault();
      saveNow();
      runSave("draft", true);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveNow, runSave]);

  /**
   * 生成预览链接。
   *
   * 先落一次草稿再签发：预览读的是库里的内容，不保存的话看到的会是上一版。
   * 链接带 HMAC 签名与 30 分钟有效期，可直接分享给未登录的人查看。
   */
  function handlePreview() {
    setPreviewLink(null);
    startTransition(async () => {
      const input = collectInput();
      const saved = await saveDraftAction(input);
      if (!saved.ok) {
        toast(saved.error, "error");
        setFieldErrors(saved.fieldErrors ?? {});
        return;
      }

      const result = await createPreviewLinkAction(saved.data.id);
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }

      const absolute = `${window.location.origin}${result.data.url}`;
      window.open(absolute, "_blank", "noopener");
      // 同时给出可复制的地址：新窗口可能被浏览器拦截
      setPreviewLink(absolute);
      // 预览前刚落过一次草稿，本地记录已完成使命，留着下次会误报「有未保存内容」
      clear();
      router.refresh();
    });
  }

  /**
   * 回滚到指定版本。
   *
   * 只恢复内容，不自动重新发布——已发布文章的线上内容在编辑者确认后
   * 再次点「发布」才会变化，避免误点直接影响前台。
   */
  async function handleRevert(version: number) {
    if (!post.id) return;

    const ok = await confirm({
      title: `回滚到版本 v${version}？`,
      description: "编辑器中未保存的修改会丢失。回滚只恢复内容，不会自动更新线上文章。",
      confirmLabel: "回滚",
    });
    if (!ok) return;

    startTransition(async () => {
      const result = await revertToRevisionAction(post.id!, version);
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }

      /**
       * 手动把快照内容灌回编辑器。
       *
       * useEditor 的 content 只在挂载时读一次，router.refresh() 只刷新
       * 服务端组件，改不动已存在的 Tiptap 实例。不在这里 setContent，
       * 用户回滚后看到的仍是回滚前的正文，会以为操作没生效。
       *
       * emitUpdate 传 false：这次变更不是用户输入，不该触发本地草稿写入，
       * 否则刚回滚完就被记成「有待保存的修改」。
       */
      setTitle(result.data.title);
      setExcerpt(result.data.excerpt);
      editor?.commands.setContent(
        result.data.contentJson as object,
        { emitUpdate: false }
      );

      toast(`已回滚到 v${version}，如需更新线上内容请再次发布`, "success");
      setRevisionsOpen(false);
    });
  }

  /** 按当前标题重新生成 slug */
  function regenerateSlug() {
    const next = slugify(title);
    if (!next) {
      toast("标题为空，无法生成地址", "error");
      return;
    }
    setSlug(next);
  }

  // -------------------------------------------------------------------------
  // 渲染
  // -------------------------------------------------------------------------

  return (
    /**
     * 负外边距抵消后台壳的内边距（px-5 py-5 / lg:px-7），让编辑器贴边铺满。
     *
     * 这么做而不是改壳层：壳的内边距被其余所有管理页依赖，为编辑器一处改动
     * 要连带调整那些页面。编辑器是唯一的沉浸式界面，让特例只留在特例这里。
     *
     * 高度用 flex-1 + min-h-0 而非 calc(100vh - 常量)：壳层高度由顶栏、页脚
     * 与内边距共同决定，硬编码常量迟早与实际值差几像素，差出来的部分会变成
     * 一条多余的竖直滚动条。
     */
    <div className="-mx-5 -mt-5 flex min-h-0 flex-1 flex-col overflow-hidden border-y border-ink-200 bg-white lg:-mx-7">
      {/* ---------------------------------------------------------------- */}
      {/* 顶部操作栏                                                       */}
      {/* ---------------------------------------------------------------- */}
      {/**
       * 顶栏固定 48px 高。
       *
       * 不用 flex-wrap：换行会让顶栏在窄屏下变成两行、把正文往下挤。
       * 改为按钮文字在窄屏收起（只留图标），高度始终恒定。
       */}
      <div className="flex h-12 flex-none items-center gap-1.5 border-b border-ink-200 px-3">
        <Link
          href="/admin/posts"
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-panel text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/35"
          aria-label="返回文章列表"
        >
          <ArrowLeft size={16} />
        </Link>

        {/* 保存状态。比 toast 安静：自动保存是持续发生的，每次都弹提示会干扰写作 */}
        <SaveStatus pending={pending} localSavedAt={localSavedAt} isNew={isNew} />

        <div className="ml-auto flex items-center gap-1.5">
          {!isNew && (
            <Button size="sm" onClick={() => setRevisionsOpen(true)}>
              <History size={14} />
              <span className="hidden lg:inline">版本</span>
            </Button>
          )}

          {!isNew && (
            <Button size="sm" onClick={handlePreview} disabled={pending}>
              <Eye size={14} />
              <span className="hidden lg:inline">预览</span>
            </Button>
          )}

          <Button size="sm" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={14} />
            <span className="hidden lg:inline">设置</span>
          </Button>

          {/* 分隔线把「查看类」操作与「写入类」操作分开，避免误点发布 */}
          <span className="mx-0.5 h-5 w-px bg-ink-200" aria-hidden="true" />

          <Button size="sm" onClick={() => runSave("draft")} disabled={pending}>
            存草稿
          </Button>

          <Button
            size="sm"
            variant="primary"
            onClick={() => runSave("publish")}
            disabled={pending}
          >
            <CloudUpload size={14} />
            发布
          </Button>
        </div>
      </div>

      {/* 预览链接不用 toast：它需要能被选中复制，自动消失的提示做不到 */}
      {previewLink && (
        <div className="flex flex-none flex-wrap items-center gap-2 border-b border-ink-200 bg-accent-50 px-3 py-2 text-xs">
          <span className="font-medium text-accent-700">预览链接</span>
          <span className="text-ink-500">30 分钟内有效</span>
          <code className="min-w-0 flex-1 truncate font-mono text-ink-700">
            {previewLink}
          </code>
          <Button
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(previewLink).then(
                () => toast("链接已复制", "success"),
                () => toast("复制失败，请手动选中", "error")
              );
            }}
          >
            复制
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPreviewLink(null)}>
            关闭
          </Button>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* 标题与正文                                                       */}
      {/* ---------------------------------------------------------------- */}
      {/**
       * 工具栏通栏吸顶，不跟着内容列收窄。
       *
       * 改版前它被塞进 max-w 容器里居中，两侧各留一大片空白，
       * 看起来像一条浮在半空的孤立控件。工具栏是"面板级"的东西，
       * 应当与顶栏同宽、贴着边界，靠背景与细线和正文分层。
       */}
      <div className="sticky top-0 z-sticky flex-none border-b border-ink-200 bg-white/95 backdrop-blur">
        <EditorToolbar editor={editor} onError={(m) => toast(m, "error")} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/**
         * 标题与正文共用同一条 42rem 内容轴。
         *
         * 42rem 在中英混排下约合 70 字符，接近长文阅读的舒适上限；
         * 再宽眼睛要横扫，再窄则频繁换行。上方留 2.5rem 呼吸，
         * 底部 40vh 是刻意的——写到文末时光标仍停在屏幕中部而非贴底。
         */}
        <div className="mx-auto w-full max-w-[42rem] px-5 pb-[40vh] pt-10 sm:px-8">
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              // 新建时按标题自动填 slug；已有 slug 不覆盖，
              // 避免改标题导致已收录的 URL 变化
              if (isNew && !slug) setSlug(slugify(e.target.value));
              // 标题也要进本地草稿与状态提示，否则改完标题看到的仍是旧的暂存时间
              schedule();
              setLocalSavedAt(new Date().toISOString());
            }}
            placeholder="标题"
            aria-label="文章标题"
            className="w-full border-none bg-transparent p-0 text-[2rem] font-semibold leading-tight tracking-[-0.021em] text-ink-900 placeholder:text-ink-300 focus:outline-none"
          />

          <div className="mt-5">
            <EditorBody editor={editor} />
          </div>

          <SlashMenu editor={editor} onError={(m) => toast(m, "error")} />
        </div>
      </div>

      {editor && <EditorBubbleMenu editor={editor} />}

      {/* ---------------------------------------------------------------- */}
      {/* 底部状态条                                                       */}
      {/* ---------------------------------------------------------------- */}
      {/**
       * 底部状态条。
       *
       * 只留字数常驻。改版前右侧挂着一整句操作说明，它对熟手是纯噪音，
       * 而新手看一次就够——因此收进右侧的提示气泡，按需展开。
       */}
      <div className="flex flex-none items-center justify-between gap-3 border-t border-ink-200 bg-ink-50/60 px-4 py-1.5">
        <WordCount editor={editor} />

        <Tooltip label="输入 / 唤起命令 · 选中文字设置格式 · Ctrl/⌘+S 保存" side="top">
          <span className="flex size-5 cursor-help items-center justify-center rounded-full text-[11px] font-medium text-ink-400 transition-colors hover:bg-ink-200 hover:text-ink-600">
            ?
          </span>
        </Tooltip>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* 抽屉与模态                                                       */}
      {/* ---------------------------------------------------------------- */}
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        isNew={isNew}
        postId={post.id}
        slug={slug}
        onSlugChange={setSlug}
        onRegenerateSlug={regenerateSlug}
        categoryId={categoryId}
        onCategoryChange={setCategoryId}
        categories={categories}
        tagIds={tagIds}
        onTagIdsChange={setTagIds}
        newTagNames={newTagNames}
        onNewTagNamesChange={setNewTagNames}
        allTags={allTags}
        excerpt={excerpt}
        onExcerptChange={setExcerpt}
        seo={seo}
        onSeoChange={setSeo}
        fieldErrors={fieldErrors}
      />

      <RevisionsModal
        open={revisionsOpen}
        onClose={() => setRevisionsOpen(false)}
        revisions={revisions}
        onRevert={handleRevert}
        pending={pending}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 字数
// ---------------------------------------------------------------------------

/**
 * 正文字数。
 *
 * 单独成组件是为了把 getJSON() 关进 useEditorState 的 selector：
 * 直接写在 PostEditor 里会让整棵编辑区在每次输入时都做一遍全文序列化，
 * 长文下这点开销会累积成可感知的输入延迟。
 */
function WordCount({ editor }: { editor: Editor | null }) {
  const count = useEditorState({
    editor,
    selector: ({ editor: e }) => (e ? extractPlainText(e.getJSON()).length : 0),
  });

  return <span>{count ?? 0} 字</span>;
}

// ---------------------------------------------------------------------------
// 保存状态
// ---------------------------------------------------------------------------

/**
 * 顶栏的保存状态指示。
 *
 * 优先显示「保存中」，其次是本地暂存时间。自动保存持续发生，
 * 每次弹 toast 会干扰写作，这里用一行安静的文字给出「内容没丢」的确认。
 */
function SaveStatus({
  pending,
  localSavedAt,
  isNew,
}: {
  pending: boolean;
  localSavedAt: string | null;
  isNew: boolean;
}) {
  if (pending) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-ink-500">
        <CloudUpload size={13} className="animate-pulse" />
        保存中…
      </span>
    );
  }

  if (localSavedAt) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-ink-400">
        <Check size={13} />
        已存本地 {formatDraftTime(localSavedAt)}
      </span>
    );
  }

  return (
    <span className="text-xs text-ink-400">{isNew ? "尚未保存" : "已同步"}</span>
  );
}
