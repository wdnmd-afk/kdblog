/**
 * Markdown 文件层面的约定（零依赖）。
 *
 * 单独成模块而不是放进 index.ts：上传对话框是客户端组件，它只需要这里的
 * 三个约定，但 index.ts 会重导出 markdownToHtml / htmlToMarkdown，
 * 连带把 marked（约 490KB）与 turndown（约 160KB）拖进浏览器包。
 *
 * 打包器的 tree-shaking 未必救得了这件事：turndown 是 CommonJS 风格的包，
 * 副作用分析保守，很容易整包保留。与其赌它，不如物理隔开——
 * 这与 lib/tiptap 里 plain-text.ts 从 sanitize.ts 拆出来是同一个理由。
 *
 * 判断标准：本文件不许出现任何 import。
 */

/** 上传与导出统一使用的文件约定。用于 <input accept> */
export const MARKDOWN_ACCEPT = ".md,.markdown,text/markdown";

/** 单个 .md 文件的大小上限。纯文本 2MB 已相当于数十万字，超出多半是误传 */
export const MARKDOWN_MAX_BYTES = 2 * 1024 * 1024;

/**
 * 判断文件名是否为受支持的 Markdown 扩展名。
 *
 * 只按扩展名判断而不看 MIME：各操作系统对 .md 的 MIME 猜测很不一致
 * （text/markdown、text/plain、application/octet-stream 甚至空字符串都出现过），
 * 按 MIME 拦会把正常文件挡在外面。真正的内容安全由后续的 sanitize 负责，
 * 这里只是给用户一个早期提示。
 */
export function isMarkdownFilename(name: string): boolean {
  return /\.(md|markdown)$/i.test(name.trim());
}
