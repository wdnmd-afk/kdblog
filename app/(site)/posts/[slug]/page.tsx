import { draftMode } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import { Calendar, Eye, FolderOpen, Hash } from "lucide-react";

import { ArticleToc } from "@/components/article-toc";
import { buildPostPath, buildPostUrl, parsePostRouteSlug } from "@/lib/url";
import { extractFirstImage } from "@/lib/tiptap/sanitize";
import { buildToc } from "@/lib/toc";
import { getPostPreview } from "@/server/services/post";
import { getPublishedPostCached } from "@/server/services/post-cache";
import { resolvePostSeo } from "@/server/services/seo";
import type { JSONContent } from "@tiptap/core";

/**
 * 前台唯一路由：/posts/{slug}-{id}
 *
 * URL 的末段 id 才是查询键，前面的 slug 只是可读装饰。这样改标题不会断链，
 * 也不需要维护历史重定向表；slug 与当前记录不一致时 301 到规范地址。
 *
 * 正文直接输出 Post.contentHtml —— 该字段在保存/发布时已完成渲染与 sanitize，
 * 读取路径不再重复处理，因此这里可以安全地 dangerouslySetInnerHTML。
 */

type RouteParams = { params: Promise<{ slug: string }> };

/**
 * 允许阻塞渲染。
 *
 * 草稿预览依赖 draftMode()（请求态 API），它使本路由无法进入静态外壳。
 * 但这不等于每次请求都查库：文章数据经 getPublishedPostCached 的 'use cache' 缓存，
 * 由发布动作的 updateTag 精准失效，因此数据库压力与 ISR 方案相当。
 */
export const instant = false;

/** 统一的取数入口：预览模式绕过缓存并放行未发布内容 */
async function loadPost(routeSlug: string) {
  const parsed = parsePostRouteSlug(routeSlug);
  if (!parsed) return null;

  const { isEnabled } = await draftMode();
  // 缓存读取统一走 server/services/post-cache.ts：那里同时打了单篇与列表两个 tag，
  // 页面内不再维护副本，否则批量失效（如分类改名刷新所有文章页）会漏掉本页面。
  const post = isEnabled ? await getPostPreview(parsed.id) : await getPublishedPostCached(parsed.id);
  if (!post) return null;

  return { post, requestedSlug: parsed.slug, isPreview: isEnabled };
}

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await loadPost(slug);
  if (!loaded) return { title: "文章不存在" };

  const { post } = loaded;
  const seo = resolvePostSeo({
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    seo: post.seo,
    firstImage: extractFirstImage(post.contentJson as JSONContent),
  });

  return {
    title: seo.title,
    description: seo.description,
    keywords: seo.keywords,
    alternates: { canonical: seo.canonical },
    // 草稿预览一律不允许索引，避免未发布内容被抓取
    robots: loaded.isPreview ? { index: false, follow: false } : seo.robots,
    openGraph: {
      type: "article",
      title: seo.ogTitle,
      description: seo.ogDescription,
      url: seo.canonical,
      images: seo.ogImage ? [{ url: seo.ogImage }] : undefined,
      publishedTime: post.publishedAt?.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
    },
    twitter: {
      card: "summary_large_image",
      title: seo.ogTitle,
      description: seo.ogDescription,
      images: seo.ogImage ? [seo.ogImage] : undefined,
    },
  };
}

export default async function PostPage({ params }: RouteParams) {
  const { slug } = await params;
  const loaded = await loadPost(slug);
  if (!loaded) notFound();

  const { post, requestedSlug, isPreview } = loaded;

  // slug 与当前记录不符（标题改过）时 301 到规范地址，避免重复内容
  if (requestedSlug !== post.slug) {
    permanentRedirect(buildPostPath(post.slug, post.id));
  }

  const seo = resolvePostSeo({
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    seo: post.seo,
    firstImage: extractFirstImage(post.contentJson as JSONContent),
  });

  // Article 结构化数据由系统生成，不作为可维护字段暴露给编辑者
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: seo.title,
    description: seo.description,
    image: seo.ogImage ? [seo.ogImage] : undefined,
    datePublished: post.publishedAt?.toISOString(),
    dateModified: post.updatedAt.toISOString(),
    mainEntityOfPage: { "@type": "WebPage", "@id": buildPostUrl(post.slug, post.id) },
  };

  // 大纲在渲染时从已落库的 HTML 中提取，并顺带给标题注入锚点 id。
  // 放在这里而非发布时：标题改动后 id 自动跟随，旧文章也无需回填。
  const toc = buildToc(post.contentHtml ?? "");

  return (
    <>
      {isPreview && (
        // 预览横幅吸顶：滚动到正文深处时仍能看出这不是线上内容
        <div className="sticky top-0 z-10 flex items-center justify-center gap-2 bg-ink-100/15 px-4 py-2.5 text-sm text-ink-800 backdrop-blur">
          <Eye size={15} className="shrink-0" />
          <span>预览模式 · 未发布内容，不会被搜索引擎索引</span>
        </div>
      )}

      <div className="mx-auto w-full max-w-2xl px-5 py-12 sm:px-6 sm:py-16 lg:max-w-5xl">
        {/**
         * 两栏：正文 42rem，右侧 13rem 放大纲。
         *
         * 用 grid 的 minmax(0,42rem) 而非固定宽度，正文在窄屏下才能正常收缩；
         * 大纲在 lg 以下隐藏——空间不够时它会把正文挤成窄条，反而不如没有。
         */}
        <div className="lg:grid lg:grid-cols-[minmax(0,42rem)_13rem] lg:justify-center lg:gap-12">
          <article className="min-w-0">
            <header className="mb-12">
              <h1 className="text-balance text-3xl font-semibold leading-tight tracking-tight text-ink-900 sm:text-4xl">
                {post.title}
              </h1>

              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-500">
                {post.publishedAt && (
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar size={14} className="shrink-0 text-ink-400" />
                    <time dateTime={post.publishedAt.toISOString()}>
                      {post.publishedAt.toLocaleDateString("zh-CN", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </time>
                  </span>
                )}

                {post.category && (
                  <span className="inline-flex items-center gap-1.5">
                    <FolderOpen size={14} className="shrink-0 text-ink-400" />
                    {post.category.name}
                  </span>
                )}
              </div>

              {post.tags.length > 0 && (
                <ul className="mt-5 flex flex-wrap gap-2">
                  {post.tags.map((t) => (
                    <li
                      key={t.tag.id}
                      className="inline-flex items-center gap-1 rounded-md bg-ink-100 px-2 py-0.5 text-xs text-ink-600"
                    >
                      <Hash size={11} className="shrink-0 text-ink-400" />
                      {t.tag.name}
                    </li>
                  ))}
                </ul>
              )}
            </header>

            {/* toc.html 是在已 sanitize 的 contentHtml 基础上补了标题 id，同样可直接输出 */}
            <div
              className="prose prose-article prose-lg max-w-none prose-headings:font-semibold prose-headings:tracking-tight prose-a:underline-offset-2 prose-pre:rounded-xl prose-img:rounded-xl"
              dangerouslySetInnerHTML={{ __html: toc.html }}
            />
          </article>

          <aside className="hidden lg:block">
            <ArticleToc items={toc.items} />
          </aside>
        </div>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  );
}
