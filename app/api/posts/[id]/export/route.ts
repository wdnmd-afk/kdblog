import type { JSONContent } from "@tiptap/core";

import { requireAdmin } from "@/lib/auth";
import { logError } from "@/lib/logger";
import { buildFrontmatter } from "@/lib/markdown";
import { contentJsonToMarkdown } from "@/lib/markdown/server";
import { getPostForEdit } from "@/server/services/post";

/**
 * 文章导出为 Markdown 文件。
 *
 * 用 Route Handler 而非 Server Action：下载需要 Content-Disposition 响应头，
 * 而 Server Action 只能返回可序列化的值，做不到让浏览器直接存为文件。
 * 前端只需一个 <a href download>，不必拿到字符串再自己造 Blob。
 *
 * 导出的是**当前库里的内容**（contentJson），不是编辑器里未保存的修改。
 * 前端在点导出前会先存一次草稿，见 PostEditor 的说明。
 */

/** 文件名里不能出现的字符，逐个换成连字符 */
const UNSAFE_FILENAME = /[\\/:*?"<>|\x00-\x1f]/g;

/**
 * 由标题生成文件名。
 *
 * 优先用标题而非 slug：slug 是英文短语（甚至可能是自动生成的随机串），
 * 而用户在文件管理器里找文件靠的是标题。中文标题直接保留——
 * 现代操作系统与浏览器都能正确处理，下面的 Content-Disposition
 * 用 filename* 的 UTF-8 编码形式传递。
 */
function buildFilename(title: string, slug: string, id: number): string {
  const base = title.trim().replace(UNSAFE_FILENAME, "-").replace(/\s+/g, " ").trim();
  // 标题为空（新建未填）时退回 slug，再退回 id，保证总有个能用的名字
  const stem = base || slug || `post-${id}`;
  // 截断到 80 字符：部分文件系统对路径长度有限制，过长的标题会导致保存失败
  return `${stem.slice(0, 80)}.md`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
  } catch {
    return new Response("未授权", { status: 401 });
  }

  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return new Response("无效的文章 id", { status: 400 });
  }

  const post = await getPostForEdit(Number(id));
  if (!post) {
    return new Response("文章不存在或已被删除", { status: 404 });
  }

  try {
    const body = contentJsonToMarkdown(post.contentJson as JSONContent);

    /*
     * 带上 frontmatter。
     *
     * 导出的文件要能再导入回来且不丢元信息，因此把标题、slug、摘要、
     * SEO 关键词一并写进头部。发布时间只在已发布时写——草稿的 publishedAt
     * 是 null，输出一个空 date 字段会让 YAML 里多一个无意义的键。
     */
    const frontmatter = buildFrontmatter({
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt,
      keywords: post.seo?.keywords ?? [],
      date: post.publishedAt?.toISOString().slice(0, 10),
    });

    const content = `${frontmatter}\n\n${body}\n`;
    const filename = buildFilename(post.title, post.slug, post.id);

    return new Response(content, {
      headers: {
        // charset 必须显式声明：缺了它部分浏览器会按 latin-1 解读，中文变乱码
        "Content-Type": "text/markdown; charset=utf-8",
        /*
         * 同时给 filename 与 filename*。
         *
         * filename* 是 RFC 5987 的 UTF-8 形式，现代浏览器优先采用它，
         * 中文名得以保留；filename 作为老浏览器的回退，里面的非 ASCII
         * 字符会被替换掉，因此那份只保证「能存下来」而非「名字好看」。
         */
        "Content-Disposition": [
          "attachment",
          `filename="${filename.replace(/[^\x20-\x7e]/g, "_")}"`,
          `filename*=UTF-8''${encodeURIComponent(filename)}`,
        ].join("; "),
        // 导出的内容随文章变化，不能缓存
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logError(error, "exportPostMarkdown", { postId: post.id });
    return new Response("导出失败，请查看系统日志", { status: 500 });
  }
}
