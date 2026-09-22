import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * 草稿预览令牌。
 *
 * 不建表：令牌是「文章 id + 过期时间」的 HMAC 签名串，服务端只需用密钥重算即可验证。
 * 相比存库的一次性 token，省掉一张表和清理任务，代价是签发后无法主动吊销
 * （通过较短的有效期约束风险，默认 30 分钟）。
 */

const DEFAULT_TTL_MS = 30 * 60 * 1000;

function getSecret(): string {
  const secret = process.env.PREVIEW_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("缺少 PREVIEW_SECRET 环境变量，无法签发预览链接");
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

/** 签发预览令牌，格式为 {postId}.{过期时间戳}.{签名} */
export function createPreviewToken(postId: number, ttlMs: number = DEFAULT_TTL_MS): string {
  const expiresAt = Date.now() + ttlMs;
  const payload = `${postId}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

/** 校验令牌并返回文章 id；签名不符或已过期返回 null */
export function verifyPreviewToken(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [rawId, rawExpires, signature] = parts;
  const payload = `${rawId}.${rawExpires}`;
  const expected = sign(payload);

  // 定长比较，避免通过响应时间差反推签名
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const expiresAt = Number(rawExpires);
  if (!Number.isSafeInteger(expiresAt) || expiresAt < Date.now()) return null;

  const postId = Number(rawId);
  if (!Number.isSafeInteger(postId) || postId <= 0) return null;

  return postId;
}

/** 拼出可直接分享的预览地址 */
export function buildPreviewUrl(postId: number, ttlMs?: number): string {
  const token = createPreviewToken(postId, ttlMs);
  return `/api/preview?token=${encodeURIComponent(token)}`;
}
