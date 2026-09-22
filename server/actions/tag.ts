"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { slugSchema } from "@/lib/seo/schema";
import * as tagService from "@/server/services/tag";
import { logError } from "@/lib/logger";
import { normalizeError, toFieldErrors, type ActionResult } from "./types";

/** 标签管理的写操作。读取由 RSC 直接调用 service，不经过 action。 */

const tagSchema = z.object({
  name: z.string().trim().min(1, "标签名不能为空").max(50, "标签名不超过 50 字符"),
  /** 留空则由服务层从名称转写（中文名会退化为随机 slug） */
  slug: slugSchema.optional().or(z.literal("")),
});

export async function createTagAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  await requireAdmin();

  const parsed = tagSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "表单校验未通过", fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const tag = await tagService.createTag({
      name: parsed.data.name,
      slug: parsed.data.slug || undefined,
    });
    revalidatePath("/admin/tags");
    return { ok: true, data: { id: tag.id } };
  } catch (error) {
    logError(error, "createTagAction");
    return { ok: false, error: normalizeError(error) };
  }
}

export async function updateTagAction(
  id: number,
  input: unknown
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = tagSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "表单校验未通过", fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    await tagService.updateTag(id, {
      name: parsed.data.name,
      slug: parsed.data.slug || undefined,
    });
    revalidatePath("/admin/tags");
    return { ok: true, data: undefined };
  } catch (error) {
    logError(error, "updateTagAction");
    return { ok: false, error: normalizeError(error) };
  }
}

/**
 * 删除标签。文章与标签的关联由 PostTag 的级联删除清理，
 * 因此不阻止删除有文章的标签，但 UI 会先展示占用数量供确认。
 */
export async function deleteTagAction(id: number): Promise<ActionResult> {
  await requireAdmin();
  try {
    await tagService.deleteTag(id);
    revalidatePath("/admin/tags");
    return { ok: true, data: undefined };
  } catch (error) {
    logError(error, "deleteTagAction");
    return { ok: false, error: normalizeError(error) };
  }
}
