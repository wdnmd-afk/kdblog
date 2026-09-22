import type { z } from "zod";

/**
 * Server Action 的统一返回契约与共享辅助函数。
 *
 * 为什么不抛异常而返回结果对象：Server Action 抛出的错误在生产构建中会被 Next
 * 脱敏成通用信息，前端拿不到字段级提示。统一返回 ok/error 结构后，表单可以就地
 * 标红具体字段。
 */

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** 把 ZodError 拍平成 { 字段路径: [错误信息] }，供表单逐项展示 */
export function toFieldErrors(error: z.ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_root";
    (result[key] ??= []).push(issue.message);
  }
  return result;
}

/**
 * 服务层抛出的错误码 -> 可展示的中文提示。
 *
 * 服务层统一抛错误码（大写下划线）而非中文文案，原因是同一错误在不同入口
 * 可能需要不同措辞，且避免把堆栈或数据库细节泄露到前端。
 */
const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: "登录状态已失效，请重新登录",
  SLUG_TAKEN: "该 slug 已被占用，请更换",
  POST_NOT_FOUND: "文章不存在或已被删除",
  PAGE_NOT_FOUND: "页面不存在或已被删除",
  REVISION_NOT_FOUND: "指定的版本快照不存在",
  CATEGORY_NOT_FOUND: "分类不存在",
  CATEGORY_HAS_CHILDREN: "该分类下还有子分类，请先处理子分类",
  CATEGORY_CYCLE: "不能把分类移动到自己的子分类下",
  CATEGORY_SELF_PARENT: "分类的父级不能是自己",
  TAG_NOT_FOUND: "标签不存在",
  TAG_NAME_TAKEN: "该标签名已存在",
  TAG_SLUG_TAKEN: "该标签 slug 已被占用，请更换",
  RESERVED_SLUG: "该 slug 为系统保留字，请更换",
};

/**
 * Prisma 错误码 -> 可展示的中文提示。
 *
 * 服务层自己抛的错误码上面那张表已覆盖，但数据库约束是另一条失败路径：
 * 外键、唯一约束、记录不存在都由 Prisma 直接抛出，若不加映射就会一路掉到
 * 「操作失败，请稍后重试」——用户既看不懂也不知道下一步做什么。
 *
 * 用字符串字面量而非 import { Prisma }：本模块会被打进客户端包
 * （编辑器从 server/actions/post 引类型时连带评估），不宜引入数据库客户端。
 */
const PRISMA_ERROR_MESSAGES: Record<string, string> = {
  P2002: "该内容与已有记录重复，请检查后重试",
  P2003: "关联的数据不存在，可能已被删除",
  P2025: "目标记录不存在，可能已被删除",
  P2000: "输入的内容过长，请精简后重试",
};

export function normalizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (ERROR_MESSAGES[message]) return ERROR_MESSAGES[message];

  // Prisma 的已知请求错误带 code 字段，据它给出更具体的提示
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  if (code && PRISMA_ERROR_MESSAGES[code]) return PRISMA_ERROR_MESSAGES[code];

  return "操作失败，请稍后重试";
}
