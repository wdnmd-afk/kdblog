import { Prisma, ContentStatus, type SeoMeta } from "@prisma/client";
import type { JSONContent } from "@tiptap/core";
import { prisma } from "@/lib/db";
import { extractFirstImage, extractPlainText, renderContentHtml } from "@/lib/tiptap/sanitize";
import { seoPublishSchema, type SeoDraftInput } from "@/lib/seo/schema";
import { fromRobotsDirective, toSeoMetaData } from "./seo";
import { resolveTagIds } from "./tag";

/**
 * 文章服务层。
 *
 * 所有文章读写都必须经过这里，组件与 action 不得直连 prisma.post。
 * 原因：Prisma 没有全局软删过滤，deletedAt 的判断只有集中在一处才不会漏，
 * 否则回收站里的文章会意外出现在前台或列表中。
 */

/** 版本快照保留数量，超出的按 version 升序清理 */
const REVISION_KEEP = 20;

/** 摘要自动生成时的截取长度 */
const EXCERPT_LENGTH = 160;

/** 未软删的基础过滤条件，所有查询都要带上 */
const notDeleted = { deletedAt: null } satisfies Prisma.PostWhereInput;

/**
 * 列表排序选项。
 *
 * 只开放这几种：发布时间用于「最近发了什么」，更新时间用于「最近改了什么」，
 * 标题用于按名找稿。访问量与评论数需要额外的计数字段，当前数据模型里没有。
 */
export type PostSort =
  | "updated_desc"
  | "published_desc"
  | "published_asc"
  | "created_desc"
  | "title_asc";

const SORT_CLAUSES: Record<PostSort, Prisma.PostOrderByWithRelationInput[]> = {
  updated_desc: [{ updatedAt: "desc" }],
  // 草稿的 publishedAt 为 null，Postgres 默认把 null 排在 desc 的最前，
  // 显式 nulls: "last" 让未发布的沉到底部，否则一堆草稿会挡住已发布内容
  published_desc: [{ publishedAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
  published_asc: [{ publishedAt: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
  created_desc: [{ createdAt: "desc" }],
  title_asc: [{ title: "asc" }],
};

export type PostListFilter = {
  keyword?: string;
  status?: ContentStatus;
  categoryId?: number | null;
  /** 按标签过滤，走 PostTag 关联表 */
  tagId?: number;
  sort?: PostSort;
  page?: number;
  pageSize?: number;
};

/** 后台文章列表：分页 + 关键词/状态/分类/标签过滤 + 排序 */
export async function listPosts(filter: PostListFilter = {}) {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20));

  const where: Prisma.PostWhereInput = {
    ...notDeleted,
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.categoryId !== undefined ? { categoryId: filter.categoryId } : {}),
    // 标签是多对多，条件下沉到关联表：some 表示"至少有一条关联指向该标签"
    ...(filter.tagId !== undefined ? { tags: { some: { tagId: filter.tagId } } } : {}),
    ...(filter.keyword
      ? {
          OR: [
            { title: { contains: filter.keyword, mode: "insensitive" } },
            { slug: { contains: filter.keyword, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.post.findMany({
      where,
      orderBy: SORT_CLAUSES[filter.sort ?? "updated_desc"],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        category: { select: { id: true, name: true } },
        tags: { include: { tag: { select: { id: true, name: true } } } },
        seo: { select: { metaTitle: true, keywords: true } },
      },
    }),
    prisma.post.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

/** 后台编辑用：取单篇文章的完整数据（含 SEO 与标签） */
export async function getPostForEdit(id: number) {
  return prisma.post.findFirst({
    where: { id, ...notDeleted },
    include: {
      tags: { include: { tag: true } },
      seo: true,
    },
  });
}

/**
 * 前台文章详情：只返回已发布且未软删的文章。
 * 草稿预览走 getPostPreview，两条路径分开以免误放行未发布内容。
 */
export async function getPublishedPost(id: number) {
  return prisma.post.findFirst({
    where: { id, ...notDeleted, status: ContentStatus.PUBLISHED },
    include: {
      category: { select: { id: true, name: true, slug: true } },
      tags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
      seo: true,
    },
  });
}

/** 草稿预览：不限状态，仅供已通过 draftMode 校验的请求调用 */
export async function getPostPreview(id: number) {
  return prisma.post.findFirst({
    where: { id, ...notDeleted },
    include: {
      category: { select: { id: true, name: true, slug: true } },
      tags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
      seo: true,
    },
  });
}

/** sitemap 用：已发布文章的 id/slug/更新时间 */
export async function listPublishedPostsForSitemap() {
  return prisma.post.findMany({
    where: { ...notDeleted, status: ContentStatus.PUBLISHED },
    select: { id: true, slug: true, updatedAt: true, publishedAt: true },
    orderBy: { publishedAt: "desc" },
  });
}

export type SavePostInput = {
  id?: number;
  title: string;
  slug: string;
  excerpt?: string;
  contentJson: JSONContent;
  categoryId?: number | null;
  tagIds?: number[];
  seo: SeoDraftInput;
  /**
   * 编辑器里现场输入的新标签名（尚无 id）。
   * 与 tagIds 合并前先经 resolveTagIds upsert，因此调用方不必先建标签再提交。
   */
  newTagNames?: string[];
  /** 当前登录管理员，仅新建时写入；后续编辑不改变原作者 */
  authorId?: string;
};

/**
 * 保存草稿。
 *
 * 同时预渲染 contentHtml 落库：虽然草稿不对外，但预渲染让草稿预览与正式发布走
 * 完全相同的渲染路径，避免"预览正常、发布后不一致"。
 */
export async function saveDraft(input: SavePostInput) {
  // slug 唯一性前置校验：放在事务外，避免撞库时抛出难以解读的 Prisma 约束错误
  if (await isSlugTaken(input.slug, input.id)) {
    throw new Error("SLUG_TAKEN");
  }

  const contentHtml = renderContentHtml(input.contentJson);
  const plainText = extractPlainText(input.contentJson);
  const excerpt = input.excerpt?.trim() || plainText.slice(0, EXCERPT_LENGTH);

  // 新标签的 upsert 必须在事务外完成：resolveTagIds 用的是全局 prisma 客户端，
  // 放进事务回调里会用两条连接，在同一事务内看不到刚创建的标签
  const allTagIds = await resolveAllTagIds(input);

  return prisma.$transaction(async (tx) => {
    const post = input.id
      ? await tx.post.update({
          where: { id: input.id },
          data: {
            title: input.title,
            slug: input.slug,
            excerpt,
            contentJson: input.contentJson as Prisma.InputJsonValue,
            contentHtml,
            categoryId: input.categoryId ?? null,
          },
        })
      : await tx.post.create({
          data: {
            title: input.title,
            slug: input.slug,
            excerpt,
            contentJson: input.contentJson as Prisma.InputJsonValue,
            contentHtml,
            categoryId: input.categoryId ?? null,
            status: ContentStatus.DRAFT,
            authorId: input.authorId,
          },
        });

    await syncTags(tx, post.id, allTagIds);
    await upsertSeo(tx, post.id, input.seo);

    return post;
  });
}

/**
 * 发布文章（全同步单事务）。
 *
 * SEO 强校验放在事务之前：不合规直接抛错，不产生任何写入。
 * 事务内一次性完成正文更新、SEO 落库、版本快照与快照裁剪，
 * 保证不会出现"文章已发布但 SEO 缺失"的中间态。
 */
export async function publishPost(input: SavePostInput) {
  // 发布前置条件：SEO 字段必须完整，校验失败由调用方捕获 ZodError 转成字段级错误
  const seo = seoPublishSchema.parse(input.seo);

  if (await isSlugTaken(input.slug, input.id)) {
    throw new Error("SLUG_TAKEN");
  }

  const contentHtml = renderContentHtml(input.contentJson);
  const plainText = extractPlainText(input.contentJson);
  const excerpt = input.excerpt?.trim() || plainText.slice(0, EXCERPT_LENGTH);

  // 新标签的 upsert 必须在事务外：resolveTagIds 走全局 prisma 而非事务客户端
  const allTagIds = await resolveAllTagIds(input);

  return prisma.$transaction(async (tx) => {
    const existing = input.id
      ? await tx.post.findFirst({ where: { id: input.id, deletedAt: null } })
      : null;

    if (input.id && !existing) {
      throw new Error("POST_NOT_FOUND");
    }

    const post = existing
      ? await tx.post.update({
          where: { id: existing.id },
          data: {
            title: input.title,
            slug: input.slug,
            excerpt,
            contentJson: input.contentJson as Prisma.InputJsonValue,
            contentHtml,
            categoryId: input.categoryId ?? null,
            status: ContentStatus.PUBLISHED,
            // 首次发布才写 publishedAt，重复发布保留原始发布时间
            publishedAt: existing.publishedAt ?? new Date(),
          },
        })
      : await tx.post.create({
          data: {
            title: input.title,
            slug: input.slug,
            excerpt,
            contentJson: input.contentJson as Prisma.InputJsonValue,
            contentHtml,
            categoryId: input.categoryId ?? null,
            status: ContentStatus.PUBLISHED,
            publishedAt: new Date(),
            authorId: input.authorId,
          },
        });

    await syncTags(tx, post.id, allTagIds);
    await upsertSeo(tx, post.id, seo);
    await createRevision(tx, post.id, {
      title: input.title,
      excerpt,
      contentJson: input.contentJson,
    });

    return post;
  });
}

/** 软删除：移入回收站，前台与列表立即不可见 */
export async function trashPost(id: number) {
  return prisma.post.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

/** 从回收站恢复 */
export async function restorePost(id: number) {
  return prisma.post.update({
    where: { id },
    data: { deletedAt: null },
  });
}

/** 彻底删除：级联清理 SEO、标签关联与版本快照（由 schema 的 onDelete 处理） */
export async function deletePostPermanently(id: number) {
  return prisma.post.delete({ where: { id } });
}

/**
 * 取消发布：退回草稿态。
 *
 * 保留 publishedAt 不清空，这样重新发布时仍沿用初次发布时间，
 * 避免文章在搜索引擎侧的发布日期反复跳动。
 */
export async function unpublish(id: number) {
  return prisma.post.update({
    where: { id },
    data: { status: ContentStatus.DRAFT },
  });
}

/**
 * 回滚到指定版本快照。
 *
 * 只恢复内容（标题/摘要/正文）到草稿字段，不改状态、不自动重新发布：
 * 回滚后仍需人工确认再发布，避免误操作直接影响线上内容。
 * 同时重新渲染 contentHtml，保证草稿预览与快照内容一致。
 */
export async function revertToRevision(postId: number, version: number) {
  const revision = await prisma.postRevision.findUnique({
    where: { postId_version: { postId, version } },
  });
  if (!revision) {
    throw new Error("REVISION_NOT_FOUND");
  }

  const contentJson = revision.contentJson as JSONContent;

  return prisma.post.update({
    where: { id: postId },
    data: {
      title: revision.title,
      excerpt: revision.excerpt,
      contentJson: contentJson as Prisma.InputJsonValue,
      contentHtml: renderContentHtml(contentJson),
    },
  });
}

// ---------------------------------------------------------------------------
// 面向 action 层的别名：action 用动词短名（publish/softDelete/purge），
// 服务层内部用带实体名的全名，两套命名通过这里对齐，避免任一侧大规模改名。
// ---------------------------------------------------------------------------

export {
  publishPost as publish,
  trashPost as softDelete,
  restorePost as restore,
  deletePostPermanently as purge,
};

/** 回收站列表 */
export async function listTrashedPosts() {
  return prisma.post.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
    select: { id: true, title: true, slug: true, deletedAt: true },
  });
}

/** 某篇文章的版本历史（不含正文，列表页只需要元信息） */
export async function listRevisions(postId: number) {
  return prisma.postRevision.findMany({
    where: { postId },
    orderBy: { version: "desc" },
    select: { id: true, version: true, title: true, createdAt: true },
  });
}

/** 取单个版本的完整快照，用于对比或回滚 */
export async function getRevision(id: number) {
  return prisma.postRevision.findUnique({ where: { id } });
}

/** slug 唯一性校验，排除自身 */
export async function isSlugTaken(slug: string, excludeId?: number) {
  const found = await prisma.post.findFirst({
    where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  return found !== null;
}

// ---------------------------------------------------------------------------
// 事务内部使用的私有辅助函数
// ---------------------------------------------------------------------------

type TxClient = Prisma.TransactionClient;

/**
 * 合并「已选既有标签」与「现场新建标签」。
 *
 * 新标签的 upsert 放在事务之外：标签是扁平查找表，即使随后文章保存失败，
 * 多出一个空标签也无副作用；反之若放进事务，createMany 与后续查询会
 * 拉长事务持有时间。
 */
async function resolveAllTagIds(input: SavePostInput): Promise<number[]> {
  const base = input.tagIds ?? [];
  const names = input.newTagNames ?? [];
  if (names.length === 0) return base;

  const created = await resolveTagIds(names);
  return Array.from(new Set([...base, ...created]));
}

/** 全量替换标签关联：先清空再插入，避免 diff 逻辑的边界问题 */
async function syncTags(tx: TxClient, postId: number, tagIds: number[]) {
  await tx.postTag.deleteMany({ where: { postId } });
  if (tagIds.length === 0) return;
  await tx.postTag.createMany({
    data: tagIds.map((tagId) => ({ postId, tagId })),
    skipDuplicates: true,
  });
}

/**
 * SEO 数据 upsert。
 *
 * 字段转换统一走 toSeoMetaData：它负责空串转 null 以及 robots 的
 * 表单值（"index,follow"）到数据库枚举（INDEX_FOLLOW）的映射，
 * 这两件事不能在此处重复实现，否则两边容易走偏。
 */
async function upsertSeo(tx: TxClient, postId: number, seo: SeoDraftInput) {
  const data = toSeoMetaData(seo);

  await tx.seoMeta.upsert({
    where: { postId },
    create: { postId, ...data },
    update: data,
  });
}

/**
 * 创建版本快照并裁剪至 REVISION_KEEP 条。
 * version 取当前最大值 +1，在事务内执行所以不会并发冲突。
 */
async function createRevision(
  tx: TxClient,
  postId: number,
  snapshot: { title: string; excerpt: string; contentJson: JSONContent }
) {
  const latest = await tx.postRevision.findFirst({
    where: { postId },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  await tx.postRevision.create({
    data: {
      postId,
      version: (latest?.version ?? 0) + 1,
      title: snapshot.title,
      excerpt: snapshot.excerpt,
      contentJson: snapshot.contentJson as Prisma.InputJsonValue,
    },
  });

  // 超出保留数量的旧版本直接删除，避免长文章场景下存储无限增长
  const obsolete = await tx.postRevision.findMany({
    where: { postId },
    orderBy: { version: "desc" },
    skip: REVISION_KEEP,
    select: { id: true },
  });

  if (obsolete.length > 0) {
    await tx.postRevision.deleteMany({
      where: { id: { in: obsolete.map((r) => r.id) } },
    });
  }
}

export { extractFirstImage };

// ---------------------------------------------------------------------------
// 批量操作
// ---------------------------------------------------------------------------

/** 批量操作结果：分别报出成功与被跳过的条目，调用方据此给出精确提示 */
export interface BatchResult {
  succeeded: number[];
  /** 被跳过的条目及原因，用于告诉用户"哪几篇没成功、为什么" */
  skipped: Array<{ id: number; title: string; reason: string }>;
}

/**
 * 批量发布。
 *
 * 与单篇发布的关键差别：批量场景下用户没有机会逐篇补 SEO，
 * 因此这里对每篇独立校验，SEO 不合规的跳过并报出标题，不阻断其余文章。
 * 这样"选了 10 篇，发布了 7 篇，3 篇缺关键词"是可见的，而非静默失败。
 */
export async function publishPostsInBatch(ids: number[]): Promise<BatchResult> {
  const posts = await prisma.post.findMany({
    where: { id: { in: ids }, ...notDeleted },
    include: { seo: true },
  });

  const succeeded: number[] = [];
  const skipped: BatchResult["skipped"] = [];

  for (const post of posts) {
    // 已发布的无需重复处理，计入成功以免用户以为漏了
    if (post.status === ContentStatus.PUBLISHED) {
      succeeded.push(post.id);
      continue;
    }

    const parsed = seoPublishSchema.safeParse(toSeoInput(post.seo));
    if (!parsed.success) {
      skipped.push({ id: post.id, title: post.title, reason: "SEO 字段不完整" });
      continue;
    }

    await prisma.post.update({
      where: { id: post.id },
      data: {
        status: ContentStatus.PUBLISHED,
        publishedAt: post.publishedAt ?? new Date(),
      },
    });
    succeeded.push(post.id);
  }

  return { succeeded, skipped };
}

/** 批量取消发布：退回草稿态，不涉及校验 */
export async function unpublishPostsInBatch(ids: number[]): Promise<BatchResult> {
  const result = await prisma.post.updateMany({
    where: { id: { in: ids }, ...notDeleted, status: ContentStatus.PUBLISHED },
    data: { status: ContentStatus.DRAFT },
  });

  // updateMany 只回条数不回 id，受影响的就是传入的已发布集合
  return result.count > 0 ? { succeeded: ids, skipped: [] } : { succeeded: [], skipped: [] };
}

/** 批量移入回收站 */
export async function trashPostsInBatch(ids: number[]): Promise<BatchResult> {
  await prisma.post.updateMany({
    where: { id: { in: ids }, ...notDeleted },
    data: { deletedAt: new Date() },
  });
  return { succeeded: ids, skipped: [] };
}

/**
 * 把已存的 SeoMeta 还原成校验用的输入形状。
 *
 * 批量发布读的是库里已有的 SEO 记录，而 seoPublishSchema 期望的是表单形状，
 * 两者字段名一致但 robots 的枚举写法不同（库里是 INDEX_FOLLOW，表单是 index,follow）。
 */
function toSeoInput(seo: SeoMeta | null) {
  if (!seo) return {};
  return {
    metaTitle: seo.metaTitle ?? "",
    metaDescription: seo.metaDescription ?? "",
    keywords: seo.keywords,
    ogImage: seo.ogImage ?? "",
    ogTitle: seo.ogTitle ?? "",
    ogDescription: seo.ogDescription ?? "",
    canonicalUrl: seo.canonicalUrl ?? "",
    robots: fromRobotsDirective(seo.robots),
  };
}
