import type { Tag } from "@prisma/client";
import { prisma } from "@/lib/db";

/** 标签服务。标签是扁平结构，无层级 */

export interface TagWithCount extends Tag {
  /** 关联的未删除文章数 */
  postCount: number;
}

/** 列出全部标签及其文章数，按文章数倒序（常用标签靠前） */
export async function listTagsWithCount(): Promise<TagWithCount[]> {
  const tags = await prisma.tag.findMany({
    orderBy: { name: "asc" },
    include: {
      posts: {
        where: { post: { deletedAt: null } },
        select: { postId: true },
      },
    },
  });

  return tags
    .map(({ posts, ...tag }) => ({ ...tag, postCount: posts.length }))
    .sort((a, b) => b.postCount - a.postCount || a.name.localeCompare(b.name));
}

export async function listTags(): Promise<Tag[]> {
  return prisma.tag.findMany({ orderBy: { name: "asc" } });
}

export async function getTagById(id: number): Promise<Tag | null> {
  return prisma.tag.findUnique({ where: { id } });
}

/**
 * 按名称批量取标签，不存在的自动创建，返回全部 id。
 * 编辑器里允许直接输入新标签名，这里统一收口，避免调用方各写一份 upsert。
 */
export async function resolveTagIds(names: string[]): Promise<number[]> {
  const unique = Array.from(
    new Set(names.map((n) => n.trim()).filter((n) => n.length > 0))
  );
  if (unique.length === 0) return [];

  const existing = await prisma.tag.findMany({ where: { name: { in: unique } } });
  const existingNames = new Set(existing.map((t) => t.name));
  const missing = unique.filter((n) => !existingNames.has(n));

  if (missing.length > 0) {
    // slug 由名称转写，重名时交由唯一约束拦截并回退为带随机后缀
    await prisma.tag.createMany({
      data: missing.map((name) => ({ name, slug: toTagSlug(name) })),
      skipDuplicates: true,
    });
  }

  const all = await prisma.tag.findMany({ where: { name: { in: unique } } });
  return all.map((t) => t.id);
}

/**
 * 标签名转 slug。中文标签无法转出有意义的英文 slug，
 * 此时退化为 tag-{时间戳后缀}，保证唯一且可用。
 */
function toTagSlug(name: string): string {
  const ascii = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (ascii.length > 0) return ascii.slice(0, 60);
  return `tag-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 删除标签前的占用检查 */
export async function getTagUsage(id: number): Promise<{ postCount: number }> {
  const postCount = await prisma.postTag.count({
    where: { tagId: id, post: { deletedAt: null } },
  });
  return { postCount };
}

export interface UpsertTagInput {
  name: string;
  /** 留空则由名称自动转写 */
  slug?: string;
}

export async function createTag(input: UpsertTagInput): Promise<Tag> {
  const name = input.name.trim();
  const slug = input.slug?.trim() || toTagSlug(name);

  if (await isTagNameTaken(name)) throw new Error("TAG_NAME_TAKEN");
  if (await isTagSlugTaken(slug)) throw new Error("TAG_SLUG_TAKEN");

  return prisma.tag.create({ data: { name, slug } });
}

export async function updateTag(id: number, input: UpsertTagInput): Promise<Tag> {
  const name = input.name.trim();
  const slug = input.slug?.trim() || toTagSlug(name);

  if (await isTagNameTaken(name, id)) throw new Error("TAG_NAME_TAKEN");
  if (await isTagSlugTaken(slug, id)) throw new Error("TAG_SLUG_TAKEN");

  return prisma.tag.update({ where: { id }, data: { name, slug } });
}

/**
 * 删除标签。文章与标签的关联由 PostTag 的 onDelete: Cascade 清理，
 * 因此即使标签仍被文章使用也可以直接删除，只是会解除关联。
 */
export async function deleteTag(id: number): Promise<void> {
  await prisma.tag.delete({ where: { id } });
}

async function isTagNameTaken(name: string, excludeId?: number): Promise<boolean> {
  const found = await prisma.tag.findFirst({
    where: { name, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  return found !== null;
}

async function isTagSlugTaken(slug: string, excludeId?: number): Promise<boolean> {
  const found = await prisma.tag.findFirst({
    where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  return found !== null;
}
