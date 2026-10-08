import assert from "node:assert/strict";

import {
  PUBLIC_ERRORS,
  isPublicErrorCode,
  loginErrorMessage,
  normalizeError,
  publicError,
  resolveLoginError,
  toPublicError,
} from "../lib/errors";
import { errorResponse, readHttpError } from "../lib/http-error";
import { downloadPostMarkdown, markdownDownloadFilename } from "../lib/markdown/download";
import { uploadImage } from "../lib/upload-image";

let passed = 0;

async function check(name: string, verify: () => void | Promise<void>) {
  await verify();
  passed += 1;
  console.log(`通过：${name}`);
}

// 所有 fetch 都在用例内替换并恢复，不连接运行中的网站或数据库。
async function withMockFetch(fetcher: typeof fetch, verify: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = fetcher;
    await verify();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function main() {
  const fallback = PUBLIC_ERRORS.INTERNAL_ERROR.message;
  const privateMessage = "SQL and connection details must stay private";
  const databaseError = Object.assign(new Error(privateMessage), { code: "P1001" });

  for (const code of [
    "UNAUTHORIZED", "SLUG_TAKEN", "POST_NOT_FOUND", "PAGE_NOT_FOUND", "REVISION_NOT_FOUND",
    "CATEGORY_NOT_FOUND", "CATEGORY_HAS_CHILDREN", "CATEGORY_CYCLE", "CATEGORY_SELF_PARENT",
    "TAG_NOT_FOUND", "TAG_NAME_TAKEN", "TAG_SLUG_TAKEN", "RESERVED_SLUG",
  ]) {
    await check(`业务错误 ${code} 保留具体提示`, () => {
      assert.notEqual(normalizeError(new Error(code)), fallback);
    });
  }

  for (const [code, expected] of [
    ["P1000", "SERVICE_UNAVAILABLE"], ["P1001", "SERVICE_UNAVAILABLE"],
    ["P1002", "TIMEOUT"], ["P1003", "SERVICE_UNAVAILABLE"], ["P1008", "TIMEOUT"],
    ["P1010", "SERVICE_UNAVAILABLE"], ["P1011", "SERVICE_UNAVAILABLE"],
    ["P1017", "SERVICE_UNAVAILABLE"], ["P2000", "VALIDATION_ERROR"],
    ["P2002", "CONFLICT"], ["P2003", "CONFLICT"], ["P2024", "TIMEOUT"],
    ["P2025", "NOT_FOUND"], ["P2034", "CONFLICT"],
    ["ECONNREFUSED", "SERVICE_UNAVAILABLE"], ["ECONNRESET", "SERVICE_UNAVAILABLE"],
    ["ETIMEDOUT", "TIMEOUT"], ["ENOSPC", "SERVICE_UNAVAILABLE"],
  ] as const) {
    await check(`底层错误 ${code} 正确分类并隐藏详情`, () => {
      const failure = toPublicError(Object.assign(new Error(privateMessage), { code }));
      assert.equal(failure.code, expected);
      assert.ok(!failure.message.includes(privateMessage));
    });
  }

  await check("Prisma 初始化异常使用 errorCode", () => {
    const error = Object.assign(new Error(privateMessage), {
      name: "PrismaClientInitializationError", errorCode: "P1001",
    });
    assert.equal(toPublicError(error).code, "SERVICE_UNAVAILABLE");
  });
  await check("未知异常和原型属性名不会泄露详情", () => {
    for (const error of [new Error(privateMessage), privateMessage, null, new Error("__proto__"), new Error("constructor")]) {
      assert.equal(normalizeError(error), fallback);
    }
    assert.equal(isPublicErrorCode("__proto__"), false);
    assert.equal(isPublicErrorCode("constructor"), false);
  });
  await check("密码错误与数据库故障使用不同的登录提示", () => {
    assert.equal(resolveLoginError({ type: "CredentialsSignin" }).code, "INVALID_CREDENTIALS");
    const failure = resolveLoginError({ type: "CallbackRouteError", cause: { err: databaseError } });
    assert.equal(failure.code, "SERVICE_UNAVAILABLE");
    assert.equal(failure.status, 503);
    assert.notEqual(loginErrorMessage(failure.code), loginErrorMessage("INVALID_CREDENTIALS"));
  });
  await check("登录页面过期和未知认证异常不冒充密码错误", () => {
    assert.equal(resolveLoginError({ type: "MissingCSRF" }).code, "LOGIN_EXPIRED");
    assert.equal(resolveLoginError({ type: "AccessDenied" }).code, "FORBIDDEN");
    assert.equal(resolveLoginError({ type: "CallbackRouteError" }).code, "INTERNAL_ERROR");
    assert.equal(loginErrorMessage("1"), PUBLIC_ERRORS.INVALID_CREDENTIALS.message);
    assert.equal(loginErrorMessage(privateMessage), fallback);
    assert.equal(loginErrorMessage(undefined), null);
  });
  await check("HTTP 失败只返回 code/msg，状态和禁止缓存约定不变", async () => {
    const response = errorResponse(toPublicError(databaseError));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      code: "SERVICE_UNAVAILABLE", msg: PUBLIC_ERRORS.SERVICE_UNAVAILABLE.message,
    });
  });
  await check("4xx 保留具体指导，5xx 不透传上游原始信息", async () => {
    const message = "图片超过 10MB，请压缩后重试。";
    assert.equal(await readHttpError(errorResponse(publicError("FILE_TOO_LARGE", message))), message);
    const response = Response.json({ code: "INTERNAL_ERROR", msg: privateMessage }, { status: 500 });
    assert.equal(await readHttpError(response), fallback);
  });
  await check("HTTP 提示只读取 msg，不兼容旧 error/message 字段", async () => {
    const legacy = { code: "CONFLICT", error: "旧 error 提示", message: "旧 message 提示" };
    assert.equal(
      await readHttpError(Response.json(legacy, { status: 409 })),
      PUBLIC_ERRORS.CONFLICT.message
    );
    const msg = "地址标识已被占用，请更换后重试。";
    assert.equal(await readHttpError(Response.json({ ...legacy, msg }, { status: 409 })), msg);
  });
  await check("缺失、空白或非字符串 msg 按已知错误码安全回退", async () => {
    for (const msg of [undefined, null, "", " \n ", 123, {}, []]) {
      const response = Response.json({ code: "VALIDATION_ERROR", msg }, { status: 400 });
      assert.equal(await readHttpError(response), PUBLIC_ERRORS.VALIDATION_ERROR.message);
    }
  });
  for (const [status, code] of [
    [400, "VALIDATION_ERROR"], [401, "UNAUTHORIZED"], [403, "FORBIDDEN"], [404, "NOT_FOUND"],
    [409, "CONFLICT"], [413, "FILE_TOO_LARGE"], [415, "UNSUPPORTED_FILE_TYPE"],
    [429, "RATE_LIMITED"], [500, "INTERNAL_ERROR"], [502, "SERVICE_UNAVAILABLE"],
    [503, "SERVICE_UNAVAILABLE"], [504, "TIMEOUT"],
  ] as const) {
    await check(`非 JSON 响应 ${status} 按状态提示`, async () => {
      const response = new Response(`<html>${privateMessage}</html>`, { status });
      assert.equal(await readHttpError(response), PUBLIC_ERRORS[code].message);
    });
  }
  await check("损坏 JSON、未知错误码和状态不匹配时安全回退", async () => {
    const malformed = new Response("not-json", { status: 503, headers: { "Content-Type": "application/json" } });
    assert.equal(await readHttpError(malformed), PUBLIC_ERRORS.SERVICE_UNAVAILABLE.message);
    for (const code of ["__proto__", "UNRECOGNIZED", "INVALID_CREDENTIALS"]) {
      const response = Response.json({ code, msg: privateMessage }, { status: 503 });
      assert.equal(await readHttpError(response), PUBLIC_ERRORS.SERVICE_UNAVAILABLE.message);
    }
  });
  await check("中文下载文件名与无效编码回退", () => {
    const title = "我的文章.md";
    assert.equal(markdownDownloadFilename(`attachment; filename*=UTF-8''${encodeURIComponent(title)}`, 7), title);
    assert.equal(markdownDownloadFilename("attachment; filename*=UTF-8''%ZZ", 7), "post-7.md");
    assert.equal(markdownDownloadFilename(null, 7), "post-7.md");
  });

  const image = new File(["fixture"], "image.png", { type: "image/png" });
  await check("上传和下载请求失败时返回提示而非抛出异常", async () => {
    await withMockFetch(async () => { throw new TypeError("Failed to fetch"); }, async () => {
      const failure = { ok: false, msg: PUBLIC_ERRORS.REQUEST_FAILED.message };
      assert.deepEqual(await uploadImage(image), failure);
      assert.deepEqual(await downloadPostMarkdown(7), failure);
    });
  });
  await check("上传和下载的登录失效不误报网络错误", async () => {
    await withMockFetch(async () => errorResponse(publicError("UNAUTHORIZED")), async () => {
      const failure = { ok: false, msg: PUBLIC_ERRORS.UNAUTHORIZED.message };
      assert.deepEqual(await uploadImage(image), failure);
      assert.deepEqual(await downloadPostMarkdown(7), failure);
    });
  });
  await check("200 HTML 不当作上传成功或 Markdown 下载", async () => {
    await withMockFetch(async () => new Response("<html>unexpected</html>", {
      headers: { "Content-Type": "text/html" },
    }), async () => {
      const failure = { ok: false, msg: PUBLIC_ERRORS.INVALID_RESPONSE.message };
      assert.deepEqual(await uploadImage(image), failure);
      assert.deepEqual(await downloadPostMarkdown(7), failure);
    });
  });
  await check("上传成功保留 msg 和既有的 url/width/height", async () => {
    const msg = "图片上传成功。";
    for (const data of [
      { url: "/uploads/fixture.webp", width: 120, height: 80 },
      { url: "/uploads/fixture.gif", width: null, height: null },
    ]) {
      await withMockFetch(async () => Response.json({ id: 7, msg, ...data }), async () => {
        assert.deepEqual(await uploadImage(image), { ok: true, msg, data });
      });
    }
  });
  await check("上传成功响应缺失或携带无效 msg 时不当作成功", async () => {
    for (const msg of [undefined, null, "", "   ", 123]) {
      await withMockFetch(async () => Response.json({
        id: 7, msg, url: "/uploads/fixture.webp", width: 120, height: 80,
      }), async () => {
        assert.deepEqual(await uploadImage(image), { ok: false, msg: PUBLIC_ERRORS.INVALID_RESPONSE.message });
      });
    }
  });

  console.log(`\n错误处理回归通过：${passed}/${passed}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
