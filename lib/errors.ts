import type { AuthError } from "next-auth";

export const PUBLIC_ERRORS = {
  INVALID_CREDENTIALS: { status: 401, message: "账号或密码不正确，请检查后重新输入。" },
  UNAUTHORIZED: { status: 401, message: "登录状态已失效，请重新登录后再试。" },
  FORBIDDEN: { status: 403, message: "当前账号没有执行此操作的权限，请联系管理员。" },
  LOGIN_EXPIRED: { status: 400, message: "登录页面已过期，请刷新页面后重新登录。" },
  VALIDATION_ERROR: { status: 400, message: "提交的信息有误，请检查并完善后重试。" },
  NOT_FOUND: { status: 404, message: "内容不存在或已被删除，请刷新页面后重试。" },
  CONFLICT: { status: 409, message: "内容与已有记录冲突，请检查后重试。" },
  FILE_TOO_LARGE: { status: 413, message: "文件过大，请压缩文件或选择较小的文件。" },
  UNSUPPORTED_FILE_TYPE: { status: 415, message: "不支持此文件格式，请选择支持的文件后重试。" },
  INVALID_IMAGE: { status: 400, message: "图片无法读取，可能已损坏，请重新选择或导出图片。" },
  RATE_LIMITED: { status: 429, message: "操作过于频繁，请稍等片刻再试。" },
  SERVICE_UNAVAILABLE: { status: 503, message: "服务暂时不可用，请稍后重试；若持续失败，请联系管理员。" },
  TIMEOUT: { status: 504, message: "服务响应超时，请先确认操作结果，再稍后重试。" },
  INTERNAL_ERROR: { status: 500, message: "暂时无法完成操作，请稍后重试；若持续失败，请联系管理员。" },
  REQUEST_FAILED: { status: 503, message: "请求未能完成，请检查网络或稍后重试。" },
  INVALID_RESPONSE: { status: 502, message: "服务返回的内容异常，请稍后重试。" },
} as const;

export type PublicErrorCode = keyof typeof PUBLIC_ERRORS;

export interface PublicError {
  code: PublicErrorCode;
  status: number;
  message: string;
}

export function publicError(code: PublicErrorCode, message?: string): PublicError {
  return { code, status: PUBLIC_ERRORS[code].status, message: message ?? PUBLIC_ERRORS[code].message };
}

export function isPublicErrorCode(code: unknown): code is PublicErrorCode {
  return typeof code === "string" && Object.hasOwn(PUBLIC_ERRORS, code);
}

const BUSINESS_ERRORS: Record<string, PublicError> = {
  UNAUTHORIZED: publicError("UNAUTHORIZED"),
  SLUG_TAKEN: publicError("CONFLICT", "地址标识已被占用，请更换后重试。"),
  POST_NOT_FOUND: publicError("NOT_FOUND", "文章不存在或已被删除，请返回列表刷新后重试。"),
  PAGE_NOT_FOUND: publicError("NOT_FOUND", "页面不存在或已被删除，请返回列表刷新后重试。"),
  REVISION_NOT_FOUND: publicError("NOT_FOUND", "该版本快照已不存在，请刷新版本列表后重试。"),
  CATEGORY_NOT_FOUND: publicError("NOT_FOUND", "分类不存在，请刷新页面重新选择。"),
  CATEGORY_HAS_CHILDREN: publicError("CONFLICT", "该分类下还有子分类，请先移动或删除子分类。"),
  CATEGORY_CYCLE: publicError("VALIDATION_ERROR", "不能把分类移动到自己的子分类下，请选择其他父级。"),
  CATEGORY_SELF_PARENT: publicError("VALIDATION_ERROR", "分类的父级不能是自己，请选择其他分类。"),
  TAG_NOT_FOUND: publicError("NOT_FOUND", "标签不存在，请刷新页面重新选择。"),
  TAG_NAME_TAKEN: publicError("CONFLICT", "该标签名已存在，请使用已有标签或更换名称。"),
  TAG_SLUG_TAKEN: publicError("CONFLICT", "该标签的地址标识已被占用，请更换后重试。"),
  RESERVED_SLUG: publicError("VALIDATION_ERROR", "该地址标识由系统保留，请更换后重试。"),
};

const INFRASTRUCTURE_ERRORS: Record<string, PublicError> = {
  P1000: publicError("SERVICE_UNAVAILABLE"),
  P1001: publicError("SERVICE_UNAVAILABLE"),
  P1002: publicError("TIMEOUT"),
  P1003: publicError("SERVICE_UNAVAILABLE"),
  P1008: publicError("TIMEOUT"),
  P1010: publicError("SERVICE_UNAVAILABLE"),
  P1011: publicError("SERVICE_UNAVAILABLE"),
  P1017: publicError("SERVICE_UNAVAILABLE"),
  P2000: publicError("VALIDATION_ERROR", "输入的内容过长，请精简后重试。"),
  P2002: publicError("CONFLICT", "该内容与已有记录重复，请检查名称或地址标识后重试。"),
  P2003: publicError("CONFLICT", "关联的数据已变更或被删除，请刷新页面重新选择。"),
  P2024: publicError("TIMEOUT"),
  P2025: publicError("NOT_FOUND"),
  P2034: publicError("CONFLICT", "内容正在被其他操作修改，请刷新确认后重试。"),
  ECONNREFUSED: publicError("SERVICE_UNAVAILABLE"),
  ECONNRESET: publicError("SERVICE_UNAVAILABLE"),
  ETIMEDOUT: publicError("TIMEOUT"),
  ENOSPC: publicError("SERVICE_UNAVAILABLE"),
};

/** 只映射已确认的错误码，原始 message、SQL 和堆栈不作为用户提示。 */
export function toPublicError(error: unknown): PublicError {
  if (error instanceof Error && Object.hasOwn(BUSINESS_ERRORS, error.message)) {
    return BUSINESS_ERRORS[error.message];
  }

  if (typeof error !== "object" || error === null) return publicError("INTERNAL_ERROR");

  if ("code" in error && typeof error.code === "string" && Object.hasOwn(INFRASTRUCTURE_ERRORS, error.code)) {
    return INFRASTRUCTURE_ERRORS[error.code];
  }

  // Prisma 初始化异常使用 errorCode，已知请求异常使用 code；两者来自不同的已确认类型。
  if (
    error instanceof Error &&
    error.name === "PrismaClientInitializationError" &&
    "errorCode" in error &&
    typeof error.errorCode === "string" &&
    Object.hasOwn(INFRASTRUCTURE_ERRORS, error.errorCode)
  ) {
    return INFRASTRUCTURE_ERRORS[error.errorCode];
  }

  return publicError("INTERNAL_ERROR");
}

export function normalizeError(error: unknown): string {
  return toPublicError(error).message;
}

/** Auth.js 把 authorize 的底层异常放在 cause.err，不能把整类 AuthError 当成密码错误。 */
export function resolveLoginError(error: Pick<AuthError, "type" | "cause">): PublicError {
  if (error.type === "CredentialsSignin") return publicError("INVALID_CREDENTIALS");
  if (error.type === "MissingCSRF") return publicError("LOGIN_EXPIRED");
  if (error.type === "AccessDenied") return publicError("FORBIDDEN");

  const failure = toPublicError(error.cause?.err);
  return failure.status >= 500 ? failure : publicError("INTERNAL_ERROR");
}

const LOGIN_ERROR_CODES = new Set<PublicErrorCode>([
  "INVALID_CREDENTIALS", "LOGIN_EXPIRED", "FORBIDDEN", "SERVICE_UNAVAILABLE", "TIMEOUT", "INTERNAL_ERROR",
]);

export function loginErrorMessage(value: string | undefined): string | null {
  if (!value) return null;
  const code = value === "1" ? "INVALID_CREDENTIALS" : value;
  if (code === "SERVICE_UNAVAILABLE") {
    return "登录服务暂时不可用，请稍后重试；此时无需修改账号或密码。";
  }
  return isPublicErrorCode(code) && LOGIN_ERROR_CODES.has(code)
    ? PUBLIC_ERRORS[code].message
    : PUBLIC_ERRORS.INTERNAL_ERROR.message;
}
