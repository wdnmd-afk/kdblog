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
  | { ok: true; data: UploadedImage }
  | { ok: false; error: string };

/** 允许插入正文的图片类型，与 /api/upload 的白名单一致 */
export const ACCEPTED_IMAGE_TYPES =
  "image/jpeg,image/png,image/webp,image/gif";

export async function uploadImage(file: File): Promise<UploadResult> {
  // 前端先挡一道：拖入非图片文件时不发无谓的请求，用户也能立刻得到反馈
  if (!file.type.startsWith("image/")) {
    return { ok: false, error: "只能插入图片文件" };
  }

  try {
    const body = new FormData();
    body.append("file", file);

    const res = await fetch("/api/upload", { method: "POST", body });
    const data = (await res.json()) as {
      url?: string;
      width?: number | null;
      height?: number | null;
      error?: string;
    };

    if (!res.ok || !data.url) {
      return { ok: false, error: data.error ?? "上传失败" };
    }

    return {
      ok: true,
      data: {
        url: data.url,
        width: data.width ?? null,
        height: data.height ?? null,
      },
    };
  } catch {
    return { ok: false, error: "上传失败，请检查网络" };
  }
}
