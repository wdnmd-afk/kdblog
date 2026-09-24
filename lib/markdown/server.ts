import { generateJSON } from "@tiptap/html/server";
import type { JSONContent } from "@tiptap/core";

import { sharedExtensions } from "@/lib/tiptap/extensions";
import { renderContentHtml } from "@/lib/tiptap/sanitize";
import { extractPlainText } from "@/lib/tiptap/plain-text";
import { markdownToHtml } from "./to-html";
import { htmlToMarkdown } from "./to-markdown";

/**
 * Markdown 与 Tiptap 文档的互转（仅服务端）。
 *
 * ⚠ 本模块 import @tiptap/html/server，它依赖 happy-dom（Node 专属）。
 * 客户端组件引用会把整条服务端依赖链拖进浏览器包，构建直接失败。
 * 客户端只能引用 ./to-html 与 ./frontmatter 这两个同构模块。
 *
 * 为什么导入必须过一遍 generateJSON：
 * 用户上传的 MD 经 marked 转出的 HTML 是**完全不可信的**，可能带 script、
 * 事件属性、javascript: 伪协议。generateJSON 按 Tiptap schema 解析，
 * 白名单外的节点与属性会被丢弃，这是第一道防线；随后 renderContentHtml
 * 的 sanitize 是第二道。两道都过完的 HTML 才可以拿去渲染预览。
 */

/** 导入一个 Markdown 文档后的解析结果 */
export interface ParsedMarkdown {
  /** 可直接灌进编辑器的 Tiptap 文档 */
  contentJson: JSONContent;
  /** 已 sanitize 的 HTML，供预览安全渲染 */
  previewHtml: string;
  /** 正文纯文本字数，让用户在导入前判断是不是拿错了文件 */
  charCount: number;
  /** 顶层节点数量，为 0 说明解析后正文是空的 */
  blockCount: number;
}

/**
 * 解析 Markdown 正文为可导入的文档。
 *
 * 不处理 frontmatter：那一步在调用方完成（parseFrontmatter 是同构的，
 * 客户端也要用它做即时反馈），这里只接纯正文。
 */
export function parseMarkdownBody(body: string): ParsedMarkdown {
  const rawHtml = markdownToHtml(body);

  /*
   * 过 Tiptap schema。
   *
   * generateJSON 的类型签名是 Record<string, any>，但实测返回的就是标准
   * Tiptap 文档结构（{ type: "doc", content: [...] }）。文档注释里写的
   * Promise 返回值是错的，它是同步函数。
   */
  const contentJson = generateJSON(rawHtml, sharedExtensions) as JSONContent;

  return {
    contentJson,
    // 二次清洗后才交给预览渲染。这一步同时保证「预览所见」与「发布后所得」
    // 走的是同一条渲染路径，不会出现预览正常、发布后样式丢失
    previewHtml: renderContentHtml(contentJson),
    charCount: extractPlainText(contentJson).length,
    blockCount: contentJson.content?.length ?? 0,
  };
}

/**
 * 把 Tiptap 文档导出为 Markdown 正文。
 *
 * 从 contentJson 重新渲染而不读 Post.contentHtml：contentHtml 在草稿从未
 * 保存过时为 null，且它是「上次保存时」的快照。contentJson 才是编辑器的
 * 唯一事实源（见 schema.prisma 的字段说明），从它出发保证导出的是当前内容。
 */
export function contentJsonToMarkdown(contentJson: JSONContent): string {
  return htmlToMarkdown(renderContentHtml(contentJson));
}
