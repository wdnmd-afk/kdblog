"use client";

import { useRef, useState, useTransition } from "react";
import { FileUp, Upload } from "lucide-react";

import { Modal } from "@/components/overlay";
import { Button, cx } from "@/components/ui";
// 从 ./file 而非 barrel 引入：barrel 会连带评估 marked 与 turndown
// （合计约 650KB），而这里只需要三个常量。同理见 lib/tiptap/plain-text.ts
import {
  MARKDOWN_ACCEPT,
  MARKDOWN_MAX_BYTES,
  isMarkdownFilename,
} from "@/lib/markdown/file";
import { parseMarkdownAction, type MarkdownImportResult } from "@/server/actions/markdown";

/**
 * Markdown 导入对话框。
 *
 * 流程刻意分两步：**选文件 → 看预览 → 确认导入**，不做「选完直接灌进编辑器」。
 * 原因是导入会覆盖编辑器里的全部正文，一旦文件格式不合预期（编码乱码、
 * 其实是别的格式改了扩展名、自定义语法没被识别），用户正在写的内容就没了。
 * 先给一个不可编辑的预览，确认无误再落地。
 *
 * 解析在服务端做（见 server/actions/markdown.ts 的说明）：marked 的产物是
 * 不可信 HTML，必须经 Tiptap schema + sanitize 两道清洗才能渲染，
 * 而第一道依赖 happy-dom，跑不到浏览器里。
 */

/** 用户确认导入时回传的内容 */
export interface MarkdownImportPayload {
  contentJson: unknown;
  /** 勾选了「套用元信息」时才带上，否则为 null */
  meta: {
    title: string | null;
    excerpt: string | null;
    slug: string | null;
    tags: string[];
    keywords: string[];
  } | null;
}

export function ImportMarkdownModal({
  open,
  onClose,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (payload: MarkdownImportPayload) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MarkdownImportResult | null>(null);
  /** 是否把 frontmatter 的元信息一起套用到表单。默认勾选——有元信息通常就是想用 */
  const [applyMeta, setApplyMeta] = useState(true);
  /** 拖拽悬停态，给出「可以松手了」的反馈 */
  const [dragging, setDragging] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  /** 关闭时清空全部状态：留着上次的预览，下次打开会以为文件已经选好了 */
  function handleClose() {
    setFileName(null);
    setError(null);
    setResult(null);
    setApplyMeta(true);
    setDragging(false);
    onClose();
  }

  /**
   * 读取并解析文件。
   *
   * 大小与扩展名在客户端先拦一道：2MB 的文件传上去再被拒，用户白等一次往返。
   * 服务端仍会复查（客户端校验可被绕过），这里只是体验优化。
   */
  function handleFile(file: File) {
    setError(null);
    setResult(null);
    setFileName(file.name);

    if (!isMarkdownFilename(file.name)) {
      setError("只支持 .md 与 .markdown 文件");
      return;
    }

    if (file.size > MARKDOWN_MAX_BYTES) {
      setError(`文件超过 ${Math.round(MARKDOWN_MAX_BYTES / 1024 / 1024)}MB 上限`);
      return;
    }

    startTransition(async () => {
      let raw: string;
      try {
        // 用 File.text() 而非 FileReader：前者返回 Promise，
        // 且统一按 UTF-8 解码，不必自己处理 onload/onerror 回调
        raw = await file.text();
      } catch {
        setError("文件读取失败，请重新选择");
        return;
      }

      if (!raw.trim()) {
        setError("文件内容为空");
        return;
      }

      const parsed = await parseMarkdownAction({ raw });
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }

      setResult(parsed.data);
    });
  }

  function handleConfirm() {
    if (!result) return;

    onImport({
      contentJson: result.contentJson,
      meta: applyMeta
        ? {
            title: result.meta.title,
            excerpt: result.meta.excerpt,
            slug: result.meta.slug,
            tags: result.meta.tags,
            keywords: result.meta.keywords,
          }
        : null,
    });
    handleClose();
  }

  const hasMeta =
    result !== null &&
    Boolean(
      result.meta.title ||
        result.meta.excerpt ||
        result.meta.slug ||
        result.meta.tags.length > 0 ||
        result.meta.keywords.length > 0
    );

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="导入 Markdown"
      description="解析后先预览，确认无误再替换编辑器内容"
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-ink-400">
            导入会替换正文全部内容，原内容可用 Ctrl/⌘+Z 撤销
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleClose}>
              取消
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={handleConfirm}
              disabled={!result || pending}
            >
              导入到编辑器
            </Button>
          </div>
        </div>
      }
    >
      {/* ------------------------------ 选择文件 ------------------------------ */}
      {/**
       * 拖放区同时是点击区。
       *
       * 用 label 包住隐藏的 input 而非自己调 input.click()：原生关联让键盘
       * （Tab 聚焦 + 空格）也能打开文件选择器，自己转发点击则只服务鼠标。
       */}
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        className={cx(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-panel border border-dashed px-4 py-7 text-center transition-colors duration-150",
          dragging
            ? "border-accent-500 bg-accent-50"
            : "border-ink-300 bg-ink-50/60 hover:border-ink-400 hover:bg-ink-50"
        )}
      >
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
        <FileUp size={22} strokeWidth={1.5} className="text-ink-400" />
        <span className="text-[13px] font-medium text-ink-700">
          {fileName ?? "点击选择或拖入 .md 文件"}
        </span>
        <span className="text-[11px] text-ink-400">
          最大 {Math.round(MARKDOWN_MAX_BYTES / 1024 / 1024)}MB
        </span>
      </label>

      {pending && (
        <p className="mt-3 flex items-center gap-1.5 text-[13px] text-ink-500">
          <Upload size={14} className="animate-pulse" />
          解析中…
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 text-[13px] text-danger-600">
          {error}
        </p>
      )}

      {/* ------------------------------- 预览 ------------------------------- */}
      {result && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-500">
            <span className="tabular-nums">{result.charCount} 字</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{result.blockCount} 个段落块</span>
          </div>

          {/* 元信息：有才显示这一块，没有 frontmatter 的文件不必占一行空白 */}
          {hasMeta && (
            <div className="rounded-panel border border-ink-200 bg-ink-50/60 px-3 py-2.5">
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={applyMeta}
                  onChange={(e) => setApplyMeta(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-ink-800">
                    套用文件里的元信息
                  </span>
                  <span className="mt-1 block space-y-0.5 text-[11px] leading-relaxed text-ink-500">
                    {result.meta.title && <span className="block">标题：{result.meta.title}</span>}
                    {result.meta.slug && <span className="block">地址：{result.meta.slug}</span>}
                    {result.meta.excerpt && (
                      <span className="block truncate">摘要：{result.meta.excerpt}</span>
                    )}
                    {result.meta.tags.length > 0 && (
                      <span className="block">标签：{result.meta.tags.join("、")}</span>
                    )}
                    {result.meta.keywords.length > 0 && (
                      <span className="block">关键词：{result.meta.keywords.join("、")}</span>
                    )}
                  </span>
                </span>
              </label>
            </div>
          )}

          {/* 未识别的键如实告知，而不是静默丢弃 */}
          {result.meta.unknownKeys.length > 0 && (
            <p className="text-[11px] leading-relaxed text-ink-400">
              以下元信息本系统不使用，不会被导入：
              {result.meta.unknownKeys.join("、")}
            </p>
          )}

          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.055em] text-ink-500">
              正文预览
            </p>
            {/**
             * 预览用 dangerouslySetInnerHTML 是安全的：previewHtml 已经过
             * Tiptap schema 解析 + sanitize-html 两道清洗，与发布后前台
             * 输出的是同一条渲染路径（见 lib/markdown/server.ts）。
             *
             * 限高并滚动：导入的文档可能很长，撑开模态会让底部的
             * 「导入」按钮被推到视口外。
             */}
            <div
              className="prose prose-sm prose-article max-h-64 max-w-none overflow-y-auto rounded-panel border border-ink-200 px-3 py-2.5"
              dangerouslySetInnerHTML={{ __html: result.previewHtml }}
            />
          </div>

          {/**
           * 降级说明。
           *
           * MD 里没有提示块/折叠块语法，这些节点在导入时不会出现；
           * 而 h1 会被压到 h2（正文不出 h1，见 lib/markdown/to-html.ts）。
           * 提前说明比让用户自己发现「标题层级怎么变了」要好。
           */}
          <p className="text-[11px] leading-relaxed text-ink-400">
            一级标题会转为正文二级标题（正文不使用 h1）；提示块与折叠块没有对应的
            Markdown 语法，导入后需手动添加。
          </p>
        </div>
      )}
    </Modal>
  );
}
