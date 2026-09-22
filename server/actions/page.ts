"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { pageSlugSchema } from "@/lib/seo/schema";
import * as pageService from "@/server/services/page";
import { logError } from "@/lib/logger";
import { normalizeError, toFieldErrors, type ActionResult } from "./types";

/**
 * 独立页面的写操作。
 *
 * 与文章的关键差别：slug 直接占用根路径（/{slug}），因此用 pageSlugSchema
 * 而非 slugSchema——多一层保留字黑名单校验，避免抢占 /admin、/api 等内置路由。
 */

const contentJsonSchema = z.object({
  type: z.literal("doc"),
  content: z.array(z.record(z.string(), z.unknown())).optional(),
});

const pageSchema = z.object({
  title: z.string().trim().min(1, "标题不能为空").max(200, "标题不超过 200 字符"),
  slug: pageSlugSchema,
  excerpt: z.string().trim().max(500, "摘要不超过 500 字符").optional().default(""),
  contentJson: contentJsonSchema,
});

export async function createPageAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  const user = await requireAdmin();

  const parsed = pageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "表单校验未通过", fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const page = await pageService.createPage(parsed.data, user.id);
    revalidatePath("/admin/pages");
    return { ok: true, data: { id: page.id } };
  } catch (error) {
    logError(error, "createPageAction");
    return { ok: false, error: normalizeError(error) };
  }
}

export async function savePageDraftAction(
  id: number,
  input: unknown
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = pageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "表单校验未通过", fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    await pageService.updatePageDraft(id, parsed.data);
    revalidatePath("/admin/pages");
    return { ok: true, data: undefined };
  } catch (error) {
    logError(error, "savePageDraftAction");
    return { ok: false, error: normalizeError(error) };
  }
}

/**
 * 发布页面。
 * 当前范围内页面不产出前台路由，因此只失效后台列表，无需 revalidateTag。
 */
export async function publishPageAction(id: number): Promise<ActionResult> {
  await requireAdmin();
  try {
    await pageService.publishPage(id);
    revalidatePath("/admin/pages");
    return { ok: true, data: undefined };
  } catch (error) {
    logError(error, "publishPageAction");
    return { ok: false, error: normalizeError(error) };
  }
}

export async function unpublishPageAction(id: number): Promise<ActionResult> {
  await requireAdmin();
  try {
    await pageService.unpublishPage(id);
    revalidatePath("/admin/pages");
    return { ok: true, data: undefined };
  } catch (error) {
    logError(error, "unpublishPageAction");
    return { ok: false, error: normalizeError(error) };
  }
}

export async function trashPageAction(id: number): Promise<ActionResult> {
  await requireAdmin();
  try {
    await pageService.trashPage(id);
    revalidatePath("/admin/pages");
    revalidatePath("/admin/trash");
    return { ok: true, data: undefined };
  } catch (error) {
    logError(error, "trashPageAction");
    return { ok: false, error: normalizeError(error) };
  }
}

export async function restorePageAction(id: number): Promise<ActionResult> {
  await requireAdmin();
  try {
    await pageService.restorePage(id);
    revalidatePath("/admin/pages");
    revalidatePath("/admin/trash");
    return { ok: true, data: undefined };
  } catch (error) {
    logError(error, "restorePageAction");
    return { ok: false, error: normalizeError(error) };
  }
}

/** 彻底删除：SeoMeta 由外键级联清理，不可恢复 */
export async function purgePageAction(id: number): Promise<ActionResult> {
  await requireAdmin();
  try {
    await pageService.deletePagePermanently(id);
    revalidatePath("/admin/trash");
    return { ok: true, data: undefined };
  } catch (error) {
    logError(error, "purgePageAction");
    return { ok: false, error: normalizeError(error) };
  }
}
