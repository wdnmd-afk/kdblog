import type { Category } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * 分类服务。
 *
 * 分类是自引用树。层级读取用 PostgreSQL 递归 CTE 一次取回整棵子树，避免 N+1；
 * 分类总量通常很小（几十到几百），因此列表页直接取全表在内存里建树也够用，
 * 两种方式都提供：buildTree 走内存，getSubtreeIds 走 CTE（用于按分类筛文章时含子分类）。
 */

export interface CategoryNode extends Category {
  children: CategoryNode[];
  /** 该分类下未删除的文章数（不含子分类） */
  postCount: number;
}

/** 拍平后的分类项，depth 表示层级深度 */
export interface FlatCategory {
  id: number;
  name: string;
  depth: number;
}

/**
 * 把分类树拍平成带层级深度的一维列表。
 *
 * 下拉框与表格无法呈现真正的树形结构，用 depth 让展示层自行决定缩进方式
 * （这里不预先拼缩进字符串，避免把展示细节固化进数据）。
 */
export function flattenCategoryTree(nodes: CategoryNode[], depth = 0): FlatCategory[] {
  return nodes.flatMap((node) => [
    { id: node.id, name: node.name, depth },
    ...flattenCategoryTree(node.children, depth + 1),
  ]);
}

/** 取全部分类并在内存中组装成树；顺序按 name 升序 */
export async function getCategoryTree(): Promise<CategoryNode[]> {
  const [categories, counts] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    prisma.post.groupBy({
      by: ["categoryId"],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
  ]);

  const countMap = new Map(
    counts.filter((c) => c.categoryId !== null).map((c) => [c.categoryId!, c._count._all])
  );

  const nodeMap = new Map<number, CategoryNode>();
  for (const category of categories) {
    nodeMap.set(category.id, {
      ...category,
      children: [],
      postCount: countMap.get(category.id) ?? 0,
    });
  }

  const roots: CategoryNode[] = [];
  for (const node of nodeMap.values()) {
    if (node.parentId === null) {
      roots.push(node);
      continue;
    }
    const parent = nodeMap.get(node.parentId);
    // 父分类不存在时降级为根节点，避免数据异常导致整棵树丢失
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  return roots;
}

/**
 * 取某分类及其所有后代的 id（含自身）。
 * 用递归 CTE 而非应用层遍历，是为了让「按分类筛文章」能一条 SQL 覆盖子分类。
 */
export async function getSubtreeIds(categoryId: number): Promise<number[]> {
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    WITH RECURSIVE subtree AS (
      SELECT id FROM categories WHERE id = ${categoryId}
      UNION ALL
      SELECT c.id FROM categories c INNER JOIN subtree s ON c."parentId" = s.id
    )
    SELECT id FROM subtree
  `;
  return rows.map((r) => r.id);
}

/**
 * 判断把 categoryId 的父级设为 newParentId 是否会形成环。
 * 树结构必须在写入前校验，否则递归 CTE 会无限展开。
 */
export async function wouldCreateCycle(
  categoryId: number,
  newParentId: number | null
): Promise<boolean> {
  if (newParentId === null) return false;
  if (newParentId === categoryId) return true;
  const descendants = await getSubtreeIds(categoryId);
  return descendants.includes(newParentId);
}

export async function listCategories(): Promise<Category[]> {
  return prisma.category.findMany({ orderBy: { name: "asc" } });
}

export async function getCategoryById(id: number): Promise<Category | null> {
  return prisma.category.findUnique({ where: { id } });
}

export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  return prisma.category.findUnique({ where: { slug } });
}

/**
 * 删除分类前的占用检查。
 * 有子分类时禁止删除（避免孤儿节点）；有文章时允许删除，文章的 categoryId 会被置空
 * （schema 中该外键为 onDelete: SetNull），但仍把数量返回给 UI 供二次确认。
 */
export async function getCategoryUsage(id: number): Promise<{
  childCount: number;
  postCount: number;
}> {
  const [childCount, postCount] = await Promise.all([
    prisma.category.count({ where: { parentId: id } }),
    prisma.post.count({ where: { categoryId: id, deletedAt: null } }),
  ]);
  return { childCount, postCount };
}

export interface UpsertCategoryInput {
  name: string;
  slug: string;
  description?: string | null;
  parentId?: number | null;
}

/** slug 唯一性校验，编辑时排除自身 */
export async function isCategorySlugTaken(slug: string, excludeId?: number): Promise<boolean> {
  const found = await prisma.category.findFirst({
    where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  return found !== null;
}

export async function createCategory(input: UpsertCategoryInput): Promise<Category> {
  if (await isCategorySlugTaken(input.slug)) {
    throw new Error("SLUG_TAKEN");
  }
  return prisma.category.create({
    data: {
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      parentId: input.parentId ?? null,
    },
  });
}

/**
 * 更新分类。
 * 改动 parentId 时必须先过环检测：把某节点挂到自己的后代下会让树查询无限递归。
 */
export async function updateCategory(id: number, input: UpsertCategoryInput): Promise<Category> {
  if (await isCategorySlugTaken(input.slug, id)) {
    throw new Error("SLUG_TAKEN");
  }
  const nextParentId = input.parentId ?? null;
  if (nextParentId !== null && (await wouldCreateCycle(id, nextParentId))) {
    throw new Error("CATEGORY_CYCLE");
  }
  return prisma.category.update({
    where: { id },
    data: {
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      parentId: nextParentId,
    },
  });
}

/**
 * 删除分类。
 * 有子分类时拒绝删除，避免产生孤儿节点（schema 中 parentId 为 onDelete: Restrict，
 * 这里提前拦一次以便返回可读的错误码）。关联文章的 categoryId 会被置空。
 */
export async function deleteCategory(id: number): Promise<void> {
  const { childCount } = await getCategoryUsage(id);
  if (childCount > 0) {
    throw new Error("CATEGORY_HAS_CHILDREN");
  }
  await prisma.category.delete({ where: { id } });
}
