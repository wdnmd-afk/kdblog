import { PUBLIC_ERRORS } from "../errors";
import { readHttpError } from "../http-error";

type DownloadResult = { ok: true; msg: string } | { ok: false; msg: string };

export function markdownDownloadFilename(disposition: string | null, postId: number): string {
  const fallback = `post-${postId}.md`;
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (!encoded) return fallback;
  try {
    return decodeURIComponent(encoded) || fallback;
  } catch {
    return fallback;
  }
}

/** 两个导出入口共用：只有确认是成功的 Markdown 响应后才触发文件下载。 */
export async function downloadPostMarkdown(postId: number): Promise<DownloadResult> {
  let response: Response;
  try {
    response = await fetch(`/api/posts/${postId}/export`, { cache: "no-store" });
  } catch {
    return { ok: false, msg: PUBLIC_ERRORS.REQUEST_FAILED.message };
  }

  if (!response.ok) return { ok: false, msg: await readHttpError(response) };
  if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "text/markdown") {
    return { ok: false, msg: PUBLIC_ERRORS.INVALID_RESPONSE.message };
  }

  let blob: Blob;
  try {
    blob = await response.blob();
  } catch {
    return { ok: false, msg: PUBLIC_ERRORS.REQUEST_FAILED.message };
  }

  let objectUrl: string | undefined;
  let link: HTMLAnchorElement | undefined;
  try {
    objectUrl = URL.createObjectURL(blob);
    link = document.createElement("a");
    link.href = objectUrl;
    link.download = markdownDownloadFilename(response.headers.get("content-disposition"), postId);
    document.body.appendChild(link);
    link.click();
    return { ok: true, msg: "已开始下载，请在浏览器中查看进度。" };
  } catch {
    return { ok: false, msg: "浏览器未能开始下载，请稍后重试。" };
  } finally {
    link?.remove();
    if (objectUrl) {
      // 给浏览器留出接管下载的时间，再释放 Blob URL，避免连续导出时泄漏内存。
      const completedUrl = objectUrl;
      setTimeout(() => URL.revokeObjectURL(completedUrl), 1000);
    }
  }
}
