import type { JSONContent } from "@tiptap/core";

/**
 * 从 Tiptap JSON 中提取纯文本与图片地址。
 *
 * 单独成模块而不是留在 sanitize.ts 里：这两个函数是纯 JSON 遍历，
 * 不依赖任何服务端能力，而 sanitize.ts 会 import @tiptap/html/server
 * （连带 happy-dom、fs），只能跑在服务端。混在一起时，客户端组件
 * 哪怕只想用 extractPlainText 数一下字数，也会把整条服务端依赖链
 * 拖进浏览器包，构建直接失败。
 *
 * 判断标准很简单：这个文件里不许出现任何服务端专用的 import。
 */

/** 抽取纯文本，用于生成摘要与字数统计 */
export function extractPlainText(json: JSONContent): string {
  const parts: string[] = [];
  const walk = (node: JSONContent) => {
    if (node.type === "text" && node.text) parts.push(node.text);
    node.content?.forEach(walk);
  };
  walk(json);
  return parts.join("").replace(/\s+/g, " ").trim();
}

/** 取正文首图，作为 ogImage 的第二级回退来源 */
export function extractFirstImage(json: JSONContent): string | null {
  let found: string | null = null;
  const walk = (node: JSONContent) => {
    if (found) return;
    if (node.type === "image" && typeof node.attrs?.src === "string") {
      found = node.attrs.src;
      return;
    }
    node.content?.forEach(walk);
  };
  walk(json);
  return found;
}
