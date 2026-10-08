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
  try {
    await requireAdmin();
    const parsed = tagSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, msg: "请检查并完善表单信息后重试。", fieldErrors: toFieldErrors(parsed.error) };
    }

    const tag = await tagService.createTag({
      name: parsed.data.name,
      slug: parsed.data.slug || undefined,
    });
    revalidatePath("/admin/tags");
    return { ok: true, msg: "标签已创建。", data: { id: tag.id } };
  } catch (error) {
    logError(error, "createTagAction");
    return { ok: false, msg: normalizeError(error) };
  }
}

export async function updateTagAction(
  id: number,
  input: unknown
): Promise<ActionResult> {
  try {
    await requireAdmin();
    const parsed = tagSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, msg: "请检查并完善表单信息后重试。", fieldErrors: toFieldErrors(parsed.error) };
    }

    await tagService.updateTag(id, {
      name: parsed.data.name,
      slug: parsed.data.slug || undefined,
    });
    revalidatePath("/admin/tags");
    return { ok: true, msg: "标签已更新。", data: undefined };
  } catch (error) {
    logError(error, "updateTagAction");
    return { ok: false, msg: normalizeError(error) };
  }
}

/**
 * 删除标签。文章与标签的关联由 PostTag 的级联删除清理，
 * 因此不阻止删除有文章的标签，但 UI 会先展示占用数量供确认。
 */
export async function deleteTagAction(id: number): Promise<ActionResult> {
  try {
    await requireAdmin();
    await tagService.deleteTag(id);
    revalidatePath("/admin/tags");
    return { ok: true, msg: "标签已删除。", data: undefined };
  } catch (error) {
    logError(error, "deleteTagAction");
    return { ok: false, msg: normalizeError(error) };
  }
}
