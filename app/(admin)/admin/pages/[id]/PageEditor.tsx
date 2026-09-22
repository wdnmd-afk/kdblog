"use client";

import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Bold, Heading2, Heading3, Italic, List, Quote } from "lucide-react";

import { cx } from "@/components/ui";
import { toPlainJson } from "@/lib/json";
import { editorOnlyExtensions, sharedExtensions } from "@/lib/tiptap/extensions";
import {
  createPageAction,
  publishPageAction,
  savePageDraftAction,
} from "@/server/actions/page";

/**
 * 独立页面编辑器。
 *
 * 与文章编辑器的差别：没有 SEO Tab、没有分类标签、没有版本历史。
 * 需求里只有文章需要 SEO，页面保持最小字段集，避免维护两套等价但不同步的表单。
 */

interface PageEditorProps {
  page: {
    /** 新建时为 undefined */
    id?: number;
    title: string;
    slug: string;
    excerpt: string;
    contentJson: unknown;
    status: string;
  };
}

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

export function PageEditor({ page }: PageEditorProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const [title, setTitle] = useState(page.title);
  const [slug, setSlug] = useState(page.slug);
  const [excerpt, setExcerpt] = useState(page.excerpt);

  const editor = useEditor({
    extensions: [...sharedExtensions, ...editorOnlyExtensions],
    content: (page.contentJson as object) ?? EMPTY_DOC,
    // SSR 阶段不立即渲染，避免 hydration 不匹配
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "prose max-w-none min-h-[20rem] focus:outline-none" },
    },
  });

  function collectInput() {
    return {
      title,
      slug,
      excerpt,
      // 同 PostEditor：Tiptap 的 attrs 是无原型对象，需归一后再发往服务端
      contentJson: toPlainJson(editor?.getJSON() ?? EMPTY_DOC),
    };
  }

  /** 保存草稿：新建走 create，已存在走 update */
  function handleSave(thenPublish = false) {
    setMessage(null);
    setFieldErrors({});

    startTransition(async () => {
      const input = collectInput();

      const saved = page.id
        ? await savePageDraftAction(page.id, input)
        : await createPageAction(input);

      if (!saved.ok) {
        setMessage(saved.error);
        setFieldErrors(saved.fieldErrors ?? {});
        return;
      }

      const pageId = page.id ?? (saved.data as { id: number }).id;

      if (thenPublish) {
        const published = await publishPageAction(pageId);
        if (!published.ok) {
          setMessage(published.error);
          return;
        }
      }

      setMessage(thenPublish ? "已发布" : "已保存");

      // 新建成功后跳到编辑地址，避免重复提交产生多条记录
      if (!page.id) {
        router.replace(`/admin/pages/${pageId}`);
      }
      router.refresh();
    });
  }

  const errorOf = (field: string) => fieldErrors[field]?.[0];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-ink-500">
          状态：{page.status === "PUBLISHED" ? "已发布" : "草稿"}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => handleSave(false)}
            className="rounded border border-ink-200 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            保存草稿
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => handleSave(true)}
            className="rounded bg-ink-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            发布
          </button>
        </div>
      </div>

      {message && (
        <p className="rounded bg-ink-100 px-3 py-2 text-sm text-ink-700">{message}</p>
      )}

      <div className="max-w-2xl space-y-4">
        <label className="block">
          <span className="text-sm text-ink-700">标题</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded border border-ink-200 px-3 py-2 text-sm"
          />
          {errorOf("title") && (
            <span className="mt-1 block text-xs text-ink-900">{errorOf("title")}</span>
          )}
        </label>

        <label className="block">
          <span className="text-sm text-ink-700">
            slug<span className="ml-1 text-xs text-ink-400">页面地址为 /{slug || "…"}</span>
          </span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="about"
            className="mt-1 w-full rounded border border-ink-200 px-3 py-2 font-mono text-sm"
          />
          {errorOf("slug") && (
            <span className="mt-1 block text-xs text-ink-900">{errorOf("slug")}</span>
          )}
        </label>

        <label className="block">
          <span className="text-sm text-ink-700">
            摘要<span className="ml-1 text-xs text-ink-400">留空则从正文截取</span>
          </span>
          <textarea
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded border border-ink-200 px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="rounded border border-ink-200 p-4">
        <PageToolbar editor={editor} />
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

/** 简化工具栏：页面正文通常比文章简单，只保留基础格式 */
function PageToolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;

  // active 用于高亮当前光标所在格式，否则用户无法判断当前状态
  const items = [
    {
      icon: Heading2,
      title: "二级标题",
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      active: editor.isActive("heading", { level: 2 }),
    },
    {
      icon: Heading3,
      title: "三级标题",
      run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      active: editor.isActive("heading", { level: 3 }),
    },
    {
      icon: Bold,
      title: "加粗",
      run: () => editor.chain().focus().toggleBold().run(),
      active: editor.isActive("bold"),
    },
    {
      icon: Italic,
      title: "斜体",
      run: () => editor.chain().focus().toggleItalic().run(),
      active: editor.isActive("italic"),
    },
    {
      icon: List,
      title: "无序列表",
      run: () => editor.chain().focus().toggleBulletList().run(),
      active: editor.isActive("bulletList"),
    },
    {
      icon: Quote,
      title: "引用",
      run: () => editor.chain().focus().toggleBlockquote().run(),
      active: editor.isActive("blockquote"),
    },
  ];

  return (
    <div className="mb-4 flex flex-wrap items-center gap-0.5 border-b border-ink-200 pb-3">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.title}
            type="button"
            onClick={item.run}
            title={item.title}
            aria-label={item.title}
            aria-pressed={item.active}
            className={cx(
              "flex h-8 w-8 items-center justify-center rounded-panel transition-colors",
              item.active
                ? "bg-ink-100 text-ink-900"
                : "text-ink-500 hover:bg-ink-100 hover:text-ink-800"
            )}
          >
            <Icon size={16} />
          </button>
        );
      })}
    </div>
  );
}
