import Link from "next/link";
import { FileText } from "lucide-react";

import { EmptyState } from "@/components/ui";
import { buildPostPath } from "@/lib/url";
import { listPublishedPostsCached } from "@/server/services/post-cache";

/**
 * 站点首页：已发布文章列表。
 *
 * 数据经 listPublishedPostsCached 缓存，随 POST_LIST_TAG 失效——
 * 任何文章的发布或下架都会刷新这里。
 *
 * 页头与页脚由 (site)/layout.tsx 提供，这里只渲染列表本身。
 * 页面内不出现任何通往管理后台的入口：这是对外站点，读者不该被引向后台
 * （后台只能通过直接访问 /admin 进入）。
 */
export const metadata = {
  description: "基于 Next.js 的内容管理与发布系统",
};

export default async function Home() {
  const posts = await listPublishedPostsCached();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-12 sm:px-6 sm:py-16">
      {posts.length === 0 ? (
        <EmptyState
          icon={<FileText size={32} strokeWidth={1.5} />}
          title="还没有已发布的文章"
          description="发布之后，这里会自动出现。"
        />
      ) : (
        <ul className="space-y-10">
          {posts.map((post) => (
            <li key={post.id}>
              <article className="group">
                <div className="flex items-center gap-3 text-xs text-ink-400">
                  {post.publishedAt && (
                    <time dateTime={post.publishedAt.toISOString()}>
                      {post.publishedAt.toLocaleDateString("zh-CN", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </time>
                  )}
                  {post.category && (
                    <>
                      <span className="text-ink-300">·</span>
                      <span>{post.category.name}</span>
                    </>
                  )}
                </div>

                <h2 className="mt-2 text-xl font-semibold leading-snug tracking-tight text-ink-900">
                  <Link href={buildPostPath(post.slug, post.id)}>
                    {post.title}
                  </Link>
                </h2>

                {post.excerpt && (
                  <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink-500">
                    {post.excerpt}
                  </p>
                )}
              </article>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
