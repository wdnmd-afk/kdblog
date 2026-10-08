import type { RobotsDirective, SeoMeta } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { SeoDraftInput, SeoFormValues } from "@/lib/seo/schema";
import { buildPostUrl } from "@/lib/url";

/**
 * SEO 元信息的读写与回退计算。
 *
 * 数据库枚举（INDEX_FOLLOW）与表单值（"index,follow"）是两套表示：前者便于建索引和
 * 迁移，后者直接就是 meta 标签的内容。转换只在这一层发生，其他地方不重复实现。
 */

const ROBOTS_TO_DB: Record<string, RobotsDirective> = {
  "index,follow": "INDEX_FOLLOW",
  "index,nofollow": "INDEX_NOFOLLOW",
  "noindex,follow": "NOINDEX_FOLLOW",
  "noindex,nofollow": "NOINDEX_NOFOLLOW",
};

const DB_TO_ROBOTS: Record<RobotsDirective, string> = {
  INDEX_FOLLOW: "index,follow",
  INDEX_NOFOLLOW: "index,nofollow",
  NOINDEX_FOLLOW: "noindex,follow",
  NOINDEX_NOFOLLOW: "noindex,nofollow",
};

export function toRobotsDirective(value: string): RobotsDirective {
  return ROBOTS_TO_DB[value] ?? "INDEX_FOLLOW";
}

export function fromRobotsDirective(value: RobotsDirective): string {
  return DB_TO_ROBOTS[value];
}

/** 把表单输入转成 SeoMeta 的可写字段；空字符串统一存为 null，避免「空串」与「未填」两种语义并存 */
export function toSeoMetaData(input: SeoDraftInput) {
  const emptyToNull = (value: string | undefined) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  };

  return {
    metaTitle: emptyToNull(input.metaTitle),
    metaDescription: emptyToNull(input.metaDescription),
    keywords: input.keywords.map((k) => k.trim()).filter(Boolean),
    ogImage: emptyToNull(input.ogImage),
    ogTitle: emptyToNull(input.ogTitle),
    ogDescription: emptyToNull(input.ogDescription),
    canonicalUrl: emptyToNull(input.canonicalUrl),
    robots: toRobotsDirective(input.robots),
  };
}

export async function getPostSeoMeta(postId: number): Promise<SeoMeta | null> {
  return prisma.seoMeta.findUnique({ where: { postId } });
}

/**
 * 把 SeoMeta 转成表单初始值，供编辑器 SEO Tab 使用。
 *
 * 返回 SeoFormValues 而非 SeoDraftInput：后者的字段是可选的（便于 Zod 解析入参），
 * 而表单受控组件要求每个字段都有确定的初始值，null 统一转成空字符串。
 */
export function toSeoFormValues(meta: SeoMeta | null): SeoFormValues {
  return {
    metaTitle: meta?.metaTitle ?? "",
    metaDescription: meta?.metaDescription ?? "",
    keywords: meta?.keywords ?? [],
    ogImage: meta?.ogImage ?? "",
    ogTitle: meta?.ogTitle ?? "",
    ogDescription: meta?.ogDescription ?? "",
    canonicalUrl: meta?.canonicalUrl ?? "",
    robots: meta ? (fromRobotsDirective(meta.robots) as SeoFormValues["robots"]) : "index,follow",
  };
}

/** 前台 generateMetadata 消费的最终结果，回退链已在此处解析完毕 */
export interface ResolvedSeo {
  title: string;
  description: string;
  keywords: string[];
  canonical: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string | null;
  robots: { index: boolean; follow: boolean };
}

/**
 * 解析文章的最终 SEO 输出。
 *
 * 回退链（架构约定）：
 * - metaTitle -> title
 * - metaDescription -> excerpt
 * - ogImage -> 正文首图 -> 站点默认图
 * - ogTitle/ogDescription 留空即继承 metaTitle/metaDescription
 * - canonicalUrl 留空则由系统按 /posts/{slug}-{id} 生成
 */
export function resolvePostSeo(params: {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  seo: SeoMeta | null;
  firstImage?: string | null;
}): ResolvedSeo {
  const { id, slug, title, excerpt, seo, firstImage } = params;

  const resolvedTitle = seo?.metaTitle?.trim() || title;
  const resolvedDescription = seo?.metaDescription?.trim() || excerpt;
  const robots = fromRobotsDirective(seo?.robots ?? "INDEX_FOLLOW");

  return {
    title: resolvedTitle,
    description: resolvedDescription,
    keywords: seo?.keywords ?? [],
    canonical: seo?.canonicalUrl?.trim() || buildPostUrl(slug, id),
    ogTitle: seo?.ogTitle?.trim() || resolvedTitle,
    ogDescription: seo?.ogDescription?.trim() || resolvedDescription,
    ogImage: seo?.ogImage?.trim() || firstImage || process.env.NEXT_PUBLIC_DEFAULT_OG_IMAGE || null,
    robots: {
      index: !robots.startsWith("noindex"),
      follow: !robots.endsWith("nofollow"),
    },
  };
}
