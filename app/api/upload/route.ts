import { NextResponse } from "next/server";
/**
 * Metadata 走具名类型导入。
 *
 * sharp 的类型是 `export = sharp` 加 `declare namespace sharp`，在
 * esModuleInterop 下默认导入只拿到**值**，`sharp` 这个名字不作为类型命名空间
 * 存在——写 `sharp.Metadata` 会报 TS2503「Cannot find namespace」。
 * 具名导入直接取到命名空间成员，不依赖 interop 的细节。
 */
import sharp, { type Metadata } from "sharp";

import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publicError, toPublicError } from "@/lib/errors";
import { errorResponse } from "@/lib/http-error";
import { logError } from "@/lib/logger";
import { getStorage } from "@/lib/storage";

/**
 * 图片上传。
 *
 * 处理链路：接收原图 -> sharp 读元信息 -> 保存原图 -> 转 WebP -> 生成三档缩略图。
 * 原图保留是为了将来换尺寸策略时可以重新生成，不必要求用户重新上传。
 *
 * 用 Route Handler 而非 Server Action：文件上传走 multipart/form-data，
 * Server Action 虽然也能收 FormData，但独立端点便于编辑器直接 XHR 上传并拿到进度。
 */

/** 缩略图宽度档位，前台 <Image> 用它们拼 srcset */
const THUMBNAIL_WIDTHS = [480, 960, 1440];

/** 单文件上限 10MB，超出直接拒绝而非静默压缩 */
const MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function POST(request: Request) {
  try {
    await requireAdmin();

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return errorResponse(publicError("VALIDATION_ERROR", "上传内容无法读取，请重新选择图片后重试。"));
    }
    const file = formData.get("file");

    if (!(file instanceof File) || file.size === 0) {
      return errorResponse(publicError("VALIDATION_ERROR", "请选择一张非空图片后上传。"));
    }
    if (file.size > MAX_BYTES) {
      return errorResponse(publicError("FILE_TOO_LARGE", "图片超过 10MB，请压缩或选择较小的图片。"));
    }
    if (!ALLOWED_MIME.has(file.type)) {
      return errorResponse(publicError("UNSUPPORTED_FILE_TYPE", "仅支持 JPEG、PNG、WebP 和 GIF 图片，请更换文件。"));
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let meta: Metadata;
    try {
      meta = await sharp(buffer).metadata();
    } catch {
      return errorResponse(publicError("INVALID_IMAGE"));
    }

    const storage = await getStorage();
    // 按年月分目录，避免单目录下文件过多影响文件系统性能
    const now = new Date();
    const dir = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
    const stem = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const ext = extensionFor(file.type);

    // 原图先落盘，后续派生失败也不至于丢原始文件
    const originalKey = `${dir}/${stem}.${ext}`;
    await storage.put({ key: originalKey, body: buffer, contentType: file.type });

    // GIF 不做 WebP 与缩略图转换：动图转静态会丢失动画，得不偿失
    const isAnimated = file.type === "image/gif";
    let webpVariant: { path: string; width: number; height: number } | null = null;
    const thumbnails: Array<{ width: number; path: string }> = [];

    if (!isAnimated) {
      const webpBuffer = await sharp(buffer).webp({ quality: 82 }).toBuffer();
      const webpKey = `${dir}/${stem}.webp`;
      await storage.put({ key: webpKey, body: webpBuffer, contentType: "image/webp" });
      webpVariant = {
        path: webpKey,
        width: meta.width ?? 0,
        height: meta.height ?? 0,
      };

      // 只生成比原图更小的档位，放大无意义且浪费空间
      for (const width of THUMBNAIL_WIDTHS) {
        if (meta.width && meta.width <= width) continue;
        const thumbBuffer = await sharp(buffer)
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: 78 })
          .toBuffer();
        const thumbKey = `${dir}/${stem}-${width}.webp`;
        await storage.put({ key: thumbKey, body: thumbBuffer, contentType: "image/webp" });
        thumbnails.push({ width, path: thumbKey });
      }
    }

    const media = await prisma.media.create({
      data: {
        path: originalKey,
        originalName: file.name,
        mimeType: file.type,
        size: file.size,
        width: meta.width ?? null,
        height: meta.height ?? null,
        variants: { webp: webpVariant, thumbnails },
      },
    });

    // 编辑器插图优先用 WebP，GIF 场景回退到原图
    const displayKey = webpVariant?.path ?? originalKey;
    return NextResponse.json({
      msg: "图片上传成功。",
      id: media.id,
      url: storage.getUrl(displayKey),
      width: meta.width ?? null,
      height: meta.height ?? null,
    });
  } catch (error) {
    logError(error, "uploadImage");
    return errorResponse(toPublicError(error));
  }
}

function extensionFor(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}
