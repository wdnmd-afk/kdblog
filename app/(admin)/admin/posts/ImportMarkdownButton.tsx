"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Upload } from "lucide-react";

import { useFeedback } from "@/components/feedback";
import { Button } from "@/components/ui";
import { PUBLIC_ERRORS } from "@/lib/errors";
// 从 ./file 而非 barrel 引入：barrel 会连带评估 marked 与 turndown
// （合计约 650KB），而这里只需要三个常量。同理见 ImportMarkdownModal
import {
  MARKDOWN_ACCEPT,
  MARKDOWN_MAX_BYTES,
  isMarkdownFilename,
} from "@/lib/markdown/file";
import { stashPendingMarkdownImport } from "@/lib/pending-md-import";
import { parseMarkdownAction } from "@/server/actions/markdown";

/**
 * 文章列表页的「上传 MD」入口。
 *
 * 与编辑器里的「导入 MD」是两条语义不同的路径，不复用同一个组件：
 * 编辑器那条是「替换当前正文」，会先弹预览确认；这里没有"当前正文"可谈，
 * 语义是「用这个文件新开一篇文章」，因此解析成功后直接跳到写文章页——
 * 那里本来就是最适合看结果的地方，所见即真实编辑器。
 *
 * 只收单个文件：每篇文章的 slug / 分类 / SEO 都要人工确认，
 * 批量上传会让确认环节失去意义（见 006 号文档的同一结论）。
 * 因此 <input> 刻意不带 multiple。
 *
 * 用程序化 input.click() 而非 ImportMarkdownModal 那种 label 包 input：
 * 这里的按钮是标准按钮外观、与页头的「写文章」并排，用真 <button>
 * 才能直接拿到 disabled 态与统一焦点环。键盘路径同样成立——
 * Tab 聚焦按钮、回车触发 click()，属于用户手势，文件选择器能正常打开。
 */
export function ImportMarkdownButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { toast } = useFeedback();

  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    // 扩展名与大小先拦一道：2MB 的文件传上去再被拒，用户白等一次往返。
    // 服务端仍会复查（客户端校验可被绕过），这里只是体验优化
    if (!isMarkdownFilename(file.name)) {
      toast("只支持 .md 与 .markdown 文件", "error");
      return;
    }

    if (file.size > MARKDOWN_MAX_BYTES) {
      toast(`文件超过 ${Math.round(MARKDOWN_MAX_BYTES / 1024 / 1024)}MB 上限`, "error");
      return;
    }

    startTransition(async () => {
      let raw: string;
      try {
        // 用 File.text() 而非 FileReader：前者返回 Promise，
        // 且统一按 UTF-8 解码，不必自己处理 onload / onerror 回调
        raw = await file.text();
      } catch {
        toast("文件读取失败，请重新选择", "error");
        return;
      }

      if (!raw.trim()) {
        toast("文件内容为空", "error");
        return;
      }

      const parsed = await parseMarkdownAction({ raw }).catch(() => ({
        ok: false as const,
        msg: PUBLIC_ERRORS.REQUEST_FAILED.message,
      }));
      if (!parsed.ok) {
        toast(parsed.msg, "error");
        return;
      }

      /*
       * 解析结果暂存到浏览器再把用户送走。
       *
       * 必须检查写入结果：sessionStorage 在隐私模式下会直接抛错，
       * 写不进去却照样跳转的话，用户到了新建页看到一片空白，
       * 会以为上传把内容弄丢了。写失败就留在列表页报错。
       */
      const stashed = stashPendingMarkdownImport({
        contentJson: parsed.data.contentJson,
        meta: {
          title: parsed.data.meta.title,
          excerpt: parsed.data.meta.excerpt,
          slug: parsed.data.meta.slug,
          tags: parsed.data.meta.tags,
          keywords: parsed.data.meta.keywords,
        },
        fileName: file.name,
      });

      if (!stashed) {
        toast("浏览器存储不可用，无法把内容带到写文章页", "error");
        return;
      }

      router.push("/admin/posts/new");
    });
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={MARKDOWN_ACCEPT}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          // 清空 value，否则连续选同一个文件不会触发 change
          e.target.value = "";
        }}
      />

      {/* 文案始终可见，因此不额外加 title / aria-label——
          可见文字本身就是它的可访问名，再挂一份只是重复 */}
      <Button size="sm" disabled={pending} onClick={() => inputRef.current?.click()}>
        {pending ? <Upload size={16} className="animate-pulse" /> : <FileUp size={16} />}
        {pending ? "解析中…" : "上传 MD"}
      </Button>
    </>
  );
}
