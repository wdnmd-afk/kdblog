import { isPublicErrorCode, publicError, type PublicError, type PublicErrorCode } from "./errors";

export function errorResponse(error: PublicError): Response {
  return Response.json(
    { code: error.code, msg: error.message },
    { status: error.status, headers: { "Cache-Control": "no-store" } }
  );
}

const STATUS_CODES: Record<number, PublicErrorCode> = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "FILE_TOO_LARGE",
  415: "UNSUPPORTED_FILE_TYPE",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
  502: "SERVICE_UNAVAILABLE",
  503: "SERVICE_UNAVAILABLE",
  504: "TIMEOUT",
};

/** 代理或框架可能返回 HTML；解析失败时按 HTTP 状态提示，不把响应正文直接展示给用户。 */
export async function readHttpError(response: Response): Promise<string> {
  const fallback = publicError(STATUS_CODES[response.status] ?? "INTERNAL_ERROR").message;
  if (!response.headers.get("content-type")?.includes("application/json")) return fallback;

  try {
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null || !("code" in payload)) return fallback;
    if (!isPublicErrorCode(payload.code)) return fallback;

    const known = publicError(payload.code);
    if (known.status !== response.status) return fallback;
    // 服务端故障只显示公共文案，即使上游错误地返回了原始异常，也不透传细节。
    if (response.status >= 500) return known.message;
    return "msg" in payload && typeof payload.msg === "string" && payload.msg.trim()
      ? payload.msg
      : known.message;
  } catch {
    return fallback;
  }
}
