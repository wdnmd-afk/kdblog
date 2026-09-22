import type { ContentStatus, Page, Prisma } from "@prisma/client";
import type { JSONContent } from "@tiptap/core";
import { prisma } from "@/lib/db";
import { renderContentHtml, extractPlainText } from "@/lib/tiptap/sanitize";

/**
 * 独立页面服务。
 *
 * 与文章的差别：无分类、无标签、无版本快照；slug 直接占用根路径（/{slug}），
 * 因此必须过保留字校验（在 action 层用 pageSlugSchema 拦）。
 * 当前范围内页面只在后台管理，不产出前台路由。
 *
 * 同样遵守软删除约定：所有读取默认排除 deletedAt 非空的记录。
 */

/** 未删除页面的基础筛选条件 */
const notDeleted = { deletedAt: null } satisfies Prisma.PageWhereInput;

export interface ListPagesParams {
  status?: ContentStatus;
  keyword?: string;
  page?: number;
  pageSize?: number;
  /** true 时只看回收站内容 */
  trashed?: boolean;
}

export async function listPages({
  status,
  keyword,
  page = 1,
  pageSize = 20,
  trashed = false,
}: ListPagesParams = {}) {
  const where: Prisma.PageWhereInput = {
    ...(trashed ? { deletedAt: { not: null } } : notDeleted),
    ...(status ? { status } : {}),
    ...(keyword
      ? {
          OR: [
            { title: { contains: keyword, mode: "insensitive" } },
            { slug: { contains: keyword, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.page.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.page.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

export async function getPageById(id: number): Promise<Page | null> {
  return prisma.page.findFirst({ where: { id, ...notDeleted } });
}

export interface UpsertPageInput {
  slug: string;
  title: string;
  excerpt?: string;
  contentJson: JSONContent;
}

/** 摘要留空时从正文截取 160 字符 */
function resolveExcerpt(input: UpsertPageInput): string {
  if (input.excerpt && input.excerpt.trim().length > 0) return input.excerpt.trim();
  return extractPlainText(input.contentJson).slice(0, 160);
}

export async function createPage(input: UpsertPageInput, authorId?: string): Promise<Page> {
  return prisma.page.create({
    data: {
      slug: input.slug,
      title: input.title,
      excerpt: resolveExcerpt(input),
      contentJson: input.contentJson as Prisma.InputJsonValue,
      status: "DRAFT",
      authorId,
    },
  });
}

export async function updatePageDraft(id: number, input: UpsertPageInput): Promise<Page> {
  return prisma.page.update({
    where: { id },
    data: {
      slug: input.slug,
      title: input.title,
      excerpt: resolveExcerpt(input),
      contentJson: input.contentJson as Prisma.InputJsonValue,
    },
  });
}

/**
 * 发布页面：与文章同构，预渲染 HTML 后落库。
 * 页面无版本快照需求，因此不涉及事务内的多表写入。
 */
export async function publishPage(id: number): Promise<Page> {
  // 用 findFirst 而非 findFirstOrThrow：后者抛的是 Prisma P2025（英文长文本），
  // normalizeError 匹配不到会退化成通用提示，用户看不出「页面已被删除」这个真实原因
  const existing = await prisma.page.findFirst({ where: { id, ...notDeleted } });
  if (!existing) {
    throw new Error("PAGE_NOT_FOUND");
  }

  const contentHtml = renderContentHtml(existing.contentJson as JSONContent);

  return prisma.page.update({
    where: { id },
    data: {
      contentHtml,
      status: "PUBLISHED",
      // 首次发布才写 publishedAt，重复发布保留原始时间
      publishedAt: existing.publishedAt ?? new Date(),
    },
  });
}

export async function unpublishPage(id: number): Promise<Page> {
  return prisma.page.update({ where: { id }, data: { status: "DRAFT" } });
}

/** 软删除到回收站 */
export async function trashPage(id: number): Promise<Page> {
  return prisma.page.update({ where: { id }, data: { deletedAt: new Date() } });
}

export async function restorePage(id: number): Promise<Page> {
  return prisma.page.update({ where: { id }, data: { deletedAt: null } });
}

/** 彻底删除。SeoMeta 靠 pageId 外键 onDelete: Cascade 自动清理，无需手动处理 */
export async function deletePagePermanently(id: number): Promise<void> {
  await prisma.page.delete({ where: { id } });
}

/** slug 唯一性检查，编辑时排除自身 */
export async function isPageSlugTaken(slug: string, excludeId?: number): Promise<boolean> {
  const found = await prisma.page.findFirst({
    where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  return found !== null;
}
