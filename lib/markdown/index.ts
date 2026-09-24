/**
 * Markdown 导入导出的公开入口。
 *
 * 分两类导出：
 *
 * 1. **同构**（客户端与服务端都可用）：frontmatter 解析、MD -> HTML。
 *    上传预览需要在客户端先把文件转成 HTML 看一眼，因此这两个不能依赖服务端能力。
 * 2. **仅服务端**：Tiptap JSON 与 MD 的互转，它们依赖 @tiptap/html/server
 *    （连带 happy-dom），必须从 ./server 单独引入。
 *
 * 这样分是为了不让客户端组件因为想用一个 frontmatter 解析函数，
 * 就把 happy-dom 整条依赖链拖进浏览器包（构建会直接失败）。
 */

export {
  splitFrontmatter,
  buildFrontmatter,
  type Frontmatter,
  type SplitResult,
} from "./frontmatter";
export { markdownToHtml } from "./to-html";
export { htmlToMarkdown } from "./to-markdown";

/**
 * 文件约定在 ./file 里独立成模块，这里只做转发。
 *
 * ⚠ 客户端组件请直接 import "@/lib/markdown/file"，不要走这个 barrel：
 * 从这里引任何东西都会连带评估上面两行，把 marked（约 490KB）与
 * turndown（约 160KB）打进浏览器包——而客户端只需要那三个常量。
 */
export { MARKDOWN_ACCEPT, MARKDOWN_MAX_BYTES, isMarkdownFilename } from "./file";
