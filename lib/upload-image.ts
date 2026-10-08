import { PUBLIC_ERRORS } from "./errors";
import { readHttpError } from "./http-error";

/**
 * 编辑器图片上传。
 *
 * 工具栏的「插入图片」与正文的粘贴/拖入共用这一份实现：
 * 三处各自写一遍 fetch 迟早会分叉（如某一处忘了带错误处理），
 * 而它们打的是同一个接口，本就该只有一种行为。
 *
 * 走 /api/upload 而非 base64 内联：Image 扩展配置了 allowBase64: false，
 * 内联会让正文体积失控，也无法复用 sharp 生成的多尺寸。
 */

export interface UploadedImage {
  url: string;
  width: number | null;
  height: number | null;
}

export type UploadResult =
  | { ok: true; msg: string; data: UploadedImage }
  | { ok: false; msg: string };

/** 允许插入正文的图片类型，与 /api/upload 的白名单一致 */
export const ACCEPTED_IMAGE_TYPES =
  "image/jpeg,image/png,image/webp,image/gif";

export async function uploadImage(file: File): Promise<UploadResult> {
  // 前端先挡一道：拖入非图片文件时不发无谓的请求，用户也能立刻得到反馈
  if (!ACCEPTED_IMAGE_TYPES.split(",").includes(file.type)) {
    return { ok: false, msg: "仅支持 JPEG、PNG、WebP 和 GIF 图片，请更换文件。" };
  }
  if (file.size === 0) {
    return { ok: false, msg: "图片内容为空，请重新选择图片。" };
  }
  if (file.size > 10 * 1024 * 1024) {
    return { ok: false, msg: "图片超过 10MB，请压缩或选择较小的图片。" };
  }

  const body = new FormData();
  body.append("file", file);
  let response: Response;
  try {
    response = await fetch("/api/upload", { method: "POST", body });
  } catch {
    return { ok: false, msg: PUBLIC_ERRORS.REQUEST_FAILED.message };
  }

  if (!response.ok) return { ok: false, msg: await readHttpError(response) };

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { ok: false, msg: PUBLIC_ERRORS.INVALID_RESPONSE.message };
  }
  if (!isUploadResponse(data)) {
    return { ok: false, msg: PUBLIC_ERRORS.INVALID_RESPONSE.message };
  }

  return { ok: true, msg: data.msg, data: { url: data.url, width: data.width, height: data.height } };
}

export function isUploadResponse(value: unknown): value is UploadedImage & { msg: string } {
  return (
    typeof value === "object" && value !== null &&
    "msg" in value && typeof value.msg === "string" && value.msg.trim().length > 0 &&
    "url" in value && typeof value.url === "string" && value.url.length > 0 &&
    "width" in value && (value.width === null || typeof value.width === "number") &&
    "height" in value && (value.height === null || typeof value.height === "number")
  );
}
