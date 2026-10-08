import type { z } from "zod";

export { normalizeError } from "@/lib/errors";

/**
 * Server Action 的统一返回契约与共享辅助函数。
 *
 * 为什么不抛异常而返回结果对象：Server Action 抛出的错误在生产构建中会被 Next
 * 脱敏成通用信息，前端拿不到字段级提示。统一返回 ok/msg 结构后，表单可以就地
 * 标红具体字段。
 */

export type ActionResult<T = void> =
  | { ok: true; msg: string; data: T }
  | { ok: false; msg: string; fieldErrors?: Record<string, string[]> };

/** 把 ZodError 拍平成 { 字段路径: [错误信息] }，供表单逐项展示 */
export function toFieldErrors(error: z.ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_root";
    (result[key] ??= []).push(issue.message);
  }
  return result;
}
