"use server";

import { z } from "zod";
import type { JSONContent } from "@tiptap/core";

import { requireAdmin } from "@/lib/auth";
import { logError } from "@/lib/logger";
import { MARKDOWN_MAX_BYTES, splitFrontmatter } from "@/lib/markdown";
import { parseMarkdownBody } from "@/lib/markdown/server";
import { normalizeError, type ActionResult } from "./types";

/**
 * Markdown 导入的 Server Action。
 *
 * 为什么解析放在服务端而不是客户端：
 *
 * 1. marked 的产物是**不可信 HTML**，要经 Tiptap schema + sanitize 两道清洗
 *    才能渲染。第一道依赖 @tiptap/html/server（happy-dom），只能在服务端跑。
 * 2. 若在客户端直接 dangerouslySetInnerHTML 渲染 marked 的输出，
 *    一个带 <script> 或 onerror 的 .md 文件就是一次 XSS。
 *
 * 导出不在这里：它要返回文件下载（Content-Disposition），
 * Server Action 只能返回可序列化的值，因此走 Route Handler（见 app/api/posts/[id]/export）。
 */

/**
 * 导入内容的入参。
 *
 * 只收文本而非 File：文件读取在客户端完成（FileReader），
 * 这样大小与扩展名校验能在上传前就给出反馈，不必先把 2MB 传上来再被拒。
 * 服务端仍然复查一遍大小——客户端校验只是体验优化，不能当作防线。
 */
const importSchema = z.object({
  /**
   * 原始 Markdown 全文（含 frontmatter）。
   *
   * 上限按字节数校验而非字符数：一个中文字符在 UTF-8 下占 3 字节，
   * 按字符算会让实际体积超出预期三倍。
   */
  raw: z.string().min(1, "文件内容为空"),
});

/** 导入解析的返回结果 */
export interface MarkdownImportResult {
  /** 可直接灌进编辑器的 Tiptap 文档 */
  contentJson: unknown;
  /** 已两道清洗的 HTML，预览可安全渲染 */
  previewHtml: string;
  charCount: number;
  blockCount: number;
  /** frontmatter 里解析出的元信息，供用户勾选是否套用到表单 */
  meta: {
    /** frontmatter 的 title，缺失时回退为正文首个标题 */
    title: string | null;
    excerpt: string | null;
    slug: string | null;
    tags: string[];
    keywords: string[];
    /** 原始 frontmatter 里出现过、但本系统不认的键，如实告知而非静默丢弃 */
    unknownKeys: string[];
  };
}

/**
 * 解析上传的 Markdown。
 *
 * 只解析不落库：用户要先在预览里确认解析结果对不对，再决定是否灌进编辑器。
 * 直接写库的话，一个格式不合预期的文件会覆盖掉编辑器里正在写的内容。
 */
export async function parseMarkdownAction(
  input: unknown
): Promise<ActionResult<MarkdownImportResult>> {
  await requireAdmin();

  const parsed = importSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "内容不合法" };
  }

  const { raw } = parsed.data;

  // 服务端复查体积：客户端的校验可以被绕过（直接调 action）
  const bytes = Buffer.byteLength(raw, "utf8");
  if (bytes > MARKDOWN_MAX_BYTES) {
    return {
      ok: false,
      error: `文件超过 ${Math.round(MARKDOWN_MAX_BYTES / 1024 / 1024)}MB 上限`,
    };
  }

  try {
    const { frontmatter, body } = splitFrontmatter(raw);
    const result = parseMarkdownBody(body);

    /*
     * 正文解析为空时直接报错，而不是返回一个空文档让用户自己发现。
     *
     * 常见原因：上传的其实是纯 frontmatter 文件，或整篇内容都是
     * Tiptap schema 不认的节点（如全文只有 HTML 标签）。
     */
    if (result.blockCount === 0 || result.charCount === 0) {
      return {
        ok: false,
        error: "解析后正文为空，请确认文件内容是有效的 Markdown",
      };
    }

    return {
      ok: true,
      data: {
        contentJson: result.contentJson,
        previewHtml: result.previewHtml,
        charCount: result.charCount,
        blockCount: result.blockCount,
        meta: {
          /*
           * 标题回退到正文首个标题。
           *
           * MD 文件普遍把标题写成正文第一行的 `# 标题` 而非 frontmatter，
           * 不做这层回退的话，绝大多数导入都需要用户再手敲一遍标题。
           * 注意首个标题在 clampHeadings 之后已是 h2（见 to-html.ts 的说明）。
           */
          title: frontmatter?.title ?? firstHeadingText(result.contentJson),
          excerpt: frontmatter?.excerpt ?? null,
          slug: frontmatter?.slug ?? null,
          // tags 与 keywords 都收进来：前者用于文章标签，后者用于 SEO 关键词，
          // 但不同生成器的习惯不一，两个键都可能承载同一批词
          tags: frontmatter?.tags ?? [],
          keywords: frontmatter?.keywords ?? [],
          // rest 里是本系统不认的键。如实告知而非静默丢弃——
          // 用户能据此判断是不是有元信息没被带过来
          unknownKeys: Object.keys(frontmatter?.rest ?? {}),
        },
      },
    };
  } catch (error) {
    logError(error, "parseMarkdownAction", { bytes });
    return { ok: false, error: normalizeError(error) };
  }
}

/**
 * 取正文里第一个标题的纯文本，作为标题的回退来源。
 *
 * 只看顶层节点的头几个：标题若埋在文档中段，它多半是小节标题而非文章标题，
 * 拿来当标题反而是错的。限定前 3 个顶层节点，容忍开头有一两段引言。
 *
 * 返回 null 表示推断不出来，由调用方决定是留空还是用文件名。
 */
function firstHeadingText(doc: JSONContent): string | null {
  const top = doc.content?.slice(0, 3) ?? [];

  for (const node of top) {
    if (node.type !== "heading") continue;
    const text = (node.content ?? [])
      .map((child) => (child.type === "text" ? (child.text ?? "") : ""))
      .join("")
      .trim();
    if (text) return text;
  }

  return null;
}
