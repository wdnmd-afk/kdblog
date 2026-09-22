import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { buildPostUrl, getSiteUrl } from "@/lib/url";
import { listPostsForSitemapCached } from "@/server/services/post-cache";

/**
 * 站点地图。
 *
 * 当前范围内前台只有文章详情页，因此只收录已发布文章 + 首页。
 * 分类/标签归档页与独立页面暂不产出前台路由，故不在此列出——
 * 收录不存在的 URL 会被搜索引擎判为软 404，反而扣分。
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // 推迟到请求时再查库：Docker 等部署形态下构建机通常访问不到生产数据库，
  // 若在预渲染阶段连库会直接构建失败。数据本身仍由 listPostsForSitemapCached
  // 跨请求缓存，并随 POST_LIST_TAG 失效，因此只有首次请求真正查库。
  await connection();

  const posts = await listPostsForSitemapCached();

  return [
    {
      url: getSiteUrl(),
      lastModified: posts[0]?.updatedAt ?? new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    ...posts.map((post) => ({
      url: buildPostUrl(post.slug, post.id),
      lastModified: post.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
