import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { UPLOAD_DIR } from "@/lib/storage/local";

/**
 * 上传文件的读取端点。
 *
 * 为什么不直接放 public/：上传目录在生产环境由 Docker volume 挂载，必须位于代码目录之外
 * 才能在容器重建后保留文件。因此用一个显式路由从 UPLOAD_DIR 读取，
 * 与部署形态解耦（反向代理若配置了 /uploads 直出，则不会走到这里）。
 */

/** 按扩展名推断 Content-Type，仅覆盖上传接口允许的图片类型 */
const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;

  // 防路径穿越：拼接后必须仍在 UPLOAD_DIR 内。
  // 单独校验每段可以拦住编码后的 ../，比只检查最终路径更早失败。
  if (segments.some((segment) => segment === ".." || segment.includes("\0"))) {
    return new Response("Bad Request", { status: 400 });
  }

  const target = path.join(UPLOAD_DIR, ...segments);
  if (!target.startsWith(UPLOAD_DIR)) {
    return new Response("Bad Request", { status: 400 });
  }

  const ext = path.extname(target).toLowerCase();
  const contentType = MIME_BY_EXT[ext];
  if (!contentType) {
    // 只吐图片，避免这个端点变成任意文件读取通道
    return new Response("Not Found", { status: 404 });
  }

  let fileStat;
  try {
    fileStat = await stat(target);
  } catch {
    return new Response("Not Found", { status: 404 });
  }

  if (!fileStat.isFile()) {
    return new Response("Not Found", { status: 404 });
  }

  const stream = Readable.toWeb(createReadStream(target)) as ReadableStream;

  return new Response(stream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(fileStat.size),
      // 文件名含随机串，内容不会变，可长期缓存
      "Cache-Control": "public, max-age=31536000, immutable",
      "Last-Modified": fileStat.mtime.toUTCString(),
    },
  });
}
