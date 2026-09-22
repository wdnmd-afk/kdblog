"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import { clearLogs, logError } from "@/lib/logger";
import { normalizeError, type ActionResult } from "./types";

/**
 * 日志相关的 Server Action。
 *
 * 只提供「清空」：日志是诊断产物，不存在编辑需求；而排查完一轮后需要清场，
 * 否则旧错误会混在新错误里，看不出这次操作到底报了什么。
 */

export async function clearLogsAction(): Promise<ActionResult> {
  await requireAdmin();
  try {
    clearLogs();
    revalidatePath("/admin/logs");
    return { ok: true, data: undefined };
  } catch (error) {
    logError(error, "clearLogsAction");
    return { ok: false, error: normalizeError(error) };
  }
}
