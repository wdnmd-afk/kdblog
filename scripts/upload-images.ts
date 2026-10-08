import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PUBLIC_ERRORS } from "../lib/errors";
import { readHttpError } from "../lib/http-error";
import { isUploadResponse } from "../lib/upload-image";

/**
 * 把某个目录下的图片经 /api/upload 批量上传，输出可用的 URL 列表。
 *
 * 走真实上传接口而非直接调 storage：这样 sharp 转 WebP、生成多尺寸、
 * 落 Media 记录这些步骤与编辑器里插图完全一致，产出的 URL 也就是
 * 正文里应当引用的那一种。
 *
 * 用法：pnpm tsx scripts/upload-images.ts <目录>
 * 目录从命令行传入而不写死在代码里——个人机器上的路径不该进仓库。
 */

const BASE = "http://localhost:16673";

const DIR = process.argv[2];
if (!DIR) {
  console.error("用法：pnpm tsx scripts/upload-images.ts <图片目录>");
  process.exit(1);
}

async function login() {
  const jar = new Map<string, string>();
  const absorb = (res: Response) => {
    const raw =
      (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    const list = raw.length ? raw : res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : [];
    for (const line of list) {
      const [pair] = line.split(";");
      const i = pair.indexOf("=");
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  };
  const cookie = () => Array.from(jar).map(([k, v]) => `${k}=${v}`).join("; ");

  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  absorb(csrfRes);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie() },
    body: new URLSearchParams({
      csrfToken,
      email: process.env.SEED_ADMIN_EMAIL ?? "",
      password: process.env.SEED_ADMIN_PASSWORD ?? "",
    }),
    redirect: "manual",
  });
  absorb(res);
  return cookie();
}

async function main() {
  const cookie = await login();
  const files = readdirSync(DIR).filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f));
  console.log(`找到 ${files.length} 张图片\n`);

  const results: Array<{ name: string; url: string }> = [];

  for (const name of files) {
    const buffer = readFileSync(join(DIR, name));
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)], { type: "image/png" }), name);

    const res = await fetch(`${BASE}/api/upload`, {
      method: "POST",
      headers: { cookie },
      body: form,
    });
    if (!res.ok) {
      console.log(`  ✗ ${name}: ${await readHttpError(res)}`);
      continue;
    }

    const data: unknown = await res.json().catch(() => null);
    if (!isUploadResponse(data)) {
      console.log(`  ✗ ${name}: ${PUBLIC_ERRORS.INVALID_RESPONSE.message}`);
      continue;
    }
    results.push({ name, url: data.url });
    console.log(`  ✓ ${name}: ${data.msg} -> ${data.url}  (${data.width}x${data.height})`);
  }

  console.log(`\n成功 ${results.length} / ${files.length}`);
  console.log("\nURL 列表：");
  for (const r of results) console.log(`  ${r.url}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
