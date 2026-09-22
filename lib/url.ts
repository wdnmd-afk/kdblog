/**
 * URL 生成与解析。
 *
 * 文章地址形如 /posts/hello-world-42：末尾的 id 是真正的查询键，前面的 slug 只是
 * 可读装饰。这样改标题不会断链，也不需要维护历史重定向表；slug 与当前记录不一致时
 * 页面层做 301 到规范地址。
 */

export function getSiteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * ISR 缓存标签。
 *
 * 发布/取消发布/删除后只失效受影响的标签，不做全站 revalidate：
 * 单篇变更打 POST_TAG(id)，涉及列表顺序或数量的变更再叠加 POST_LIST_TAG。
 */
export const POST_TAG = (id: number) => `post:${id}`;
export const POST_LIST_TAG = "posts";

/** 生成文章的站内相对路径 */
export function buildPostPath(slug: string, id: number): string {
  return `/posts/${slug}-${id}`;
}

/** 生成文章的绝对 URL，用于 canonical、OpenGraph 与 sitemap */
export function buildPostUrl(slug: string, id: number): string {
  return `${getSiteUrl()}${buildPostPath(slug, id)}`;
}

/**
 * 从路由参数中拆出 id 与 slug。
 * 取最后一段连字符后的数字为 id；解析失败返回 null 交由页面层 404。
 */
export function parsePostRouteSlug(routeSlug: string): { id: number; slug: string } | null {
  const match = /^(.*)-(\d+)$/.exec(routeSlug);
  if (!match) return null;
  const id = Number(match[2]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { id, slug: match[1] };
}

/** 把任意标题转成候选 slug；中文场景通常仍需人工填写英文 slug */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}
