"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ContentStatus } from "@prisma/client";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { buildPreviewUrl } from "@/lib/preview";
import { seoDraftSchema, seoPublishSchema, slugSchema } from "@/lib/seo/schema";
import { POST_TAG, POST_LIST_TAG, buildPostPath } from "@/lib/url";
import * as postService from "@/server/services/post";
import { logError } from "@/lib/logger";
import { normalizeError, toFieldErrors, type ActionResult } from "./types";

/**
 * 文章相关的 Server Actions。
 *
 * 约定：
 * 1. 每个 action 在 try 内先 requireAdmin()，既拦截直接 POST，也把会话与连接异常转为提示。
 * 2. 校验失败返回字段级错误对象而非抛异常，便于表单就地展示。
 * 3. 写成功后按 tag 精准失效，不做全站 revalidate。
 */

/** Tiptap 文档 JSON 的最小结构校验，具体节点合法性交由 generateHTML 处理 */
const contentJsonSchema = z.object({
  type: z.literal("doc"),
  content: z.array(z.record(z.string(), z.unknown())).optional(),
});

const basePostSchema = z.object({
  title: z.string().trim().min(1, "标题不能为空").max(200, "标题不超过 200 字符"),
  slug: slugSchema,
  excerpt: z.string().trim().max(500, "摘要不超过 500 字符").optional().default(""),
  contentJson: contentJsonSchema,
  categoryId: z.number().int().positive().nullable().optional(),
  tagIds: z.array(z.number().int().positive()).max(20, "标签最多 20 个").optional().default([]),
  /**
   * 编辑器里现场输入的新标签名。
   * 与 tagIds 分开传：已有标签用 id（稳定），新标签只有名字，
   * 由服务层 resolveTagIds 统一 upsert 后合并，避免前端先建标签再提交的两步操作。
   */
  newTagNames: z
    .array(z.string().trim().min(1).max(50))
    .max(20, "新标签最多 20 个")
    .optional()
    .default([]),
});

/** 草稿保存：SEO 字段全部可空，允许边写边存 */
const saveDraftSchema = basePostSchema.extend({
  id: z.number().int().positive().optional(),
  seo: seoDraftSchema,
});

/** 发布：SEO 标题、描述、关键词为硬性必填，不合规不写库 */
const publishSchema = basePostSchema.extend({
  id: z.number().int().positive().optional(),
  seo: seoPublishSchema,
});

/**
 * 保存草稿（新建或更新）。
 *
 * 注意：本操作会直接重写 contentHtml。若目标文章已处于 PUBLISHED 状态，
 * 前台内容随之改变，因此必须同步失效缓存——否则库里已是新内容，
 * 而前台会继续吐旧 HTML 直到缓存自然过期（最长数天）。
 */
export async function saveDraftAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  try {
    const user = await requireAdmin();
    const parsed = saveDraftSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, msg: "请检查并完善表单信息后重试。", fieldErrors: toFieldErrors(parsed.error) };
    }

    const post = await postService.saveDraft({ ...parsed.data, authorId: user.id });
    if (post.status === ContentStatus.PUBLISHED) {
      updateTag(POST_TAG(post.id));
      updateTag(POST_LIST_TAG);
    }
    revalidatePath("/admin/posts");
    return { ok: true, msg: "文章已保存。", data: { id: post.id } };
  } catch (error) {
    logError(error, "saveDraftAction");
    return { ok: false, msg: normalizeError(error) };
  }
}

/**
 * 发布文章。
 *
 * 全同步单事务：SEO 强校验 -> 渲染 contentHtml -> 写 Post + SeoMeta + 版本快照。
 * 事务提交即算发布成功，随后按 tag 精准失效该文章页与列表页。
 */
export async function publishPostAction(input: unknown): Promise<ActionResult<{ id: number; path: string }>> {
  try {
    const user = await requireAdmin();
    const parsed = publishSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, msg: "文章或 SEO 信息不完整，请检查并完善后再发布。", fieldErrors: toFieldErrors(parsed.error) };
    }

    const post = await postService.publish({ ...parsed.data, authorId: user.id });
    updateTag(POST_TAG(post.id));
    updateTag(POST_LIST_TAG);
    revalidatePath("/admin/posts");
    return { ok: true, msg: "文章已发布。", data: { id: post.id, path: buildPostPath(post.slug, post.id) } };
  } catch (error) {
    logError(error, "publishPostAction");
    return { ok: false, msg: normalizeError(error) };
  }
}

/** 取消发布：退回草稿态，前台立即不可见 */
export async function unpublishPostAction(id: number): Promise<ActionResult> {
  try {
    await requireAdmin();
    await postService.unpublish(id);
    updateTag(POST_TAG(id));
    updateTag(POST_LIST_TAG);
    revalidatePath("/admin/posts");
    return { ok: true, msg: "已取消发布，文章已转为草稿。", data: undefined };
  } catch (error) {
    logError(error, "unpublishPostAction");
    return { ok: false, msg: normalizeError(error) };
  }
}

/** 移入回收站（软删除），前台立即不可见但数据保留 */
export async function trashPostAction(id: number): Promise<ActionResult> {
  try {
    await requireAdmin();
    await postService.softDelete(id);
    updateTag(POST_TAG(id));
    updateTag(POST_LIST_TAG);
    revalidatePath("/admin/posts");
    revalidatePath("/admin/trash");
    return { ok: true, msg: "文章已移入回收站，可在回收站还原。", data: undefined };
  } catch (error) {
    logError(error, "trashPostAction");
    return { ok: false, msg: normalizeError(error) };
  }
}

/** 从回收站还原，还原后保持原状态（已发布的文章会重新在前台可见） */
export async function restorePostAction(id: number): Promise<ActionResult> {
  try {
    await requireAdmin();
    await postService.restore(id);
    updateTag(POST_TAG(id));
    updateTag(POST_LIST_TAG);
    revalidatePath("/admin/posts");
    revalidatePath("/admin/trash");
    return { ok: true, msg: "文章已还原。", data: undefined };
  } catch (error) {
    logError(error, "restorePostAction");
    return { ok: false, msg: normalizeError(error) };
  }
}

/** 彻底删除：连带版本快照与 SEO 元信息一并清除，不可恢复 */
export async function purgePostAction(id: number): Promise<ActionResult> {
  try {
    await requireAdmin();
    await postService.purge(id);
    revalidatePath("/admin/trash");
    return { ok: true, msg: "文章已彻底删除。", data: undefined };
  } catch (error) {
    logError(error, "purgePostAction");
    return { ok: false, msg: normalizeError(error) };
  }
}

/**
 * 签发草稿预览链接。
 *
 * 令牌是 HMAC 签名串（不建表），默认 30 分钟有效。签发本身需要管理员身份，
 * 但拿到链接的人无需登录即可查看——因此有效期不宜放长。
 */
export async function createPreviewLinkAction(
  postId: number
): Promise<ActionResult<{ url: string }>> {
  try {
    await requireAdmin();
    return { ok: true, msg: "预览链接已生成。", data: { url: buildPreviewUrl(postId) } };
  } catch (error) {
    logError(error, "createPreviewLinkAction");
    return { ok: false, msg: normalizeError(error) };
  }
}

/**
 * 回滚到指定版本快照：只恢复内容，不自动重新发布。
 *
 * 返回值带上恢复后的内容，而不只是成功标志：编辑器里的文档是 Tiptap 实例，
 * 只在挂载时读一次初始 content，router.refresh() 改不动它。不让这里把内容
 * 交回去，用户回滚后看到的仍是回滚前的正文，会以为操作没生效。
 */
export async function revertToRevisionAction(
  postId: number,
  version: number
): Promise<ActionResult<{ title: string; excerpt: string; contentJson: unknown }>> {
  try {
    await requireAdmin();
    const post = await postService.revertToRevision(postId, version);
    // 回滚同样重写正文，已发布文章需要立即失效前台缓存
    if (post.status === ContentStatus.PUBLISHED) {
      updateTag(POST_TAG(postId));
      updateTag(POST_LIST_TAG);
    }
    revalidatePath(`/admin/posts/${postId}`);
    return {
      ok: true,
      msg: "已恢复所选版本，请确认内容。",
      data: {
        title: post.title,
        excerpt: post.excerpt,
        contentJson: post.contentJson,
      },
    };
  } catch (error) {
    logError(error, "revertToRevisionAction");
    return { ok: false, msg: normalizeError(error) };
  }
}

// ---------------------------------------------------------------------------
// 批量操作
// ---------------------------------------------------------------------------

/** 批量操作的入参：一组文章 id */
const batchIdsSchema = z.array(z.number().int().positive()).min(1, "请先选择文章").max(100);

/** 批量结果的展示层形状：直接给一句可读的结论，避免每个调用方各自拼文案 */
export interface BatchActionResult {
  ok: boolean;
  msg: string;
}

/**
 * 批量发布。
 *
 * SEO 不完整的文章会被跳过而非阻断整批，因此返回的提示要说清跳了哪几篇——
 * 批量场景下用户没机会逐篇补字段，静默失败会让人以为系统坏了。
 */
export async function publishPostsInBatchAction(ids: unknown): Promise<BatchActionResult> {
  try {
    await requireAdmin();
    const parsed = batchIdsSchema.safeParse(ids);
    if (!parsed.success) {
      return { ok: false, msg: parsed.error.issues[0]?.message ?? "请选择要操作的文章后重试。" };
    }

    const { succeeded, skipped } = await postService.publishPostsInBatch(parsed.data);

    for (const id of succeeded) {
      updateTag(POST_TAG(id));
    }
    if (succeeded.length > 0) {
      updateTag(POST_LIST_TAG);
    }
    revalidatePath("/admin/posts");

    if (skipped.length === 0) {
      return { ok: true, msg: `已发布 ${succeeded.length} 篇` };
    }

    const names = skipped.map((s) => s.title).join("、");
    return {
      ok: true,
      msg: `已发布 ${succeeded.length} 篇；${skipped.length} 篇因 SEO 字段不完整未发布：${names}`,
    };
  } catch (error) {
    logError(error, "publishPostsInBatchAction");
    return { ok: false, msg: normalizeError(error) };
  }
}

/** 批量取消发布：退回草稿态，前台立即不可见 */
export async function unpublishPostsInBatchAction(ids: unknown): Promise<BatchActionResult> {
  try {
    await requireAdmin();
    const parsed = batchIdsSchema.safeParse(ids);
    if (!parsed.success) {
      return { ok: false, msg: parsed.error.issues[0]?.message ?? "请选择要操作的文章后重试。" };
    }

    const { succeeded } = await postService.unpublishPostsInBatch(parsed.data);
    for (const id of succeeded) {
      updateTag(POST_TAG(id));
    }
    updateTag(POST_LIST_TAG);
    revalidatePath("/admin/posts");
    return { ok: true, msg: `已取消发布 ${succeeded.length} 篇` };
  } catch (error) {
    logError(error, "unpublishPostsInBatchAction");
    return { ok: false, msg: normalizeError(error) };
  }
}

/** 批量移入回收站：软删可恢复，因此不需要二次确认之外的保护 */
export async function trashPostsInBatchAction(ids: unknown): Promise<BatchActionResult> {
  try {
    await requireAdmin();
    const parsed = batchIdsSchema.safeParse(ids);
    if (!parsed.success) {
      return { ok: false, msg: parsed.error.issues[0]?.message ?? "请选择要操作的文章后重试。" };
    }

    const { succeeded } = await postService.trashPostsInBatch(parsed.data);
    for (const id of succeeded) {
      updateTag(POST_TAG(id));
    }
    updateTag(POST_LIST_TAG);
    revalidatePath("/admin/posts");
    revalidatePath("/admin/trash");
    return { ok: true, msg: `已移入回收站 ${succeeded.length} 篇` };
  } catch (error) {
    logError(error, "trashPostsInBatchAction");
    return { ok: false, msg: normalizeError(error) };
  }
}
