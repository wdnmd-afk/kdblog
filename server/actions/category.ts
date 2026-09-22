"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { slugSchema } from "@/lib/seo/schema";
import * as categoryService from "@/server/services/category";
import type { ActionResult } from "./types";
import { logError } from "@/lib/logger";
import { normalizeError, toFieldErrors } from "./types";

/**
 * 分类相关 Server Actions。
 *
 * 分类是树形结构，写操作的风险点在于父子关系：
 * 把某节点的父节点设为自己的后代会形成环，服务层的 wouldCreateCycle 负责拦截。
 */

const categorySchema = z.object({
  name: z.string().trim().min(1, "分类名不能为空").max(60, "分类名不超过 60 字符"),
  slug: slugSchema,
  description: z.string().trim().max(200, "描述不超过 200 字符").optional().default(""),
  parentId: z.number().int().positive().nullable().optional(),
});

export async function createCategoryAction(
  input: unknown
): Promise<ActionResult<{ id: number }>> {
  await requireAdmin();

  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "表单校验未通过", fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const category = await categoryService.createCategory(parsed.data);
    revalidatePath("/admin/categories");
    return { ok: true, data: { id: category.id } };
  } catch (error) {
    logError(error, "createCategoryAction");
    return { ok: false, error: normalizeError(error) };
  }
}

export async function updateCategoryAction(
  id: number,
  input: unknown
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "表单校验未通过", fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    await categoryService.updateCategory(id, parsed.data);
    revalidatePath("/admin/categories");
    return { ok: true, data: undefined };
  } catch (error) {
    logError(error, "updateCategoryAction");
    return { ok: false, error: normalizeError(error) };
  }
}

/**
 * 删除分类。有子分类时服务层会拒绝（避免孤儿节点）；
 * 关联文章的 categoryId 由外键 SetNull 置空，文章本身不受影响。
 */
export async function deleteCategoryAction(id: number): Promise<ActionResult> {
  await requireAdmin();

  try {
    await categoryService.deleteCategory(id);
    revalidatePath("/admin/categories");
    revalidatePath("/admin/posts");
    return { ok: true, data: undefined };
  } catch (error) {
    logError(error, "deleteCategoryAction");
    return { ok: false, error: normalizeError(error) };
  }
}
