import "dotenv/config";

/**
 * HTTP 端到端冒烟：覆盖 service 层测不到的 action / 页面运行时。
 *
 * scripts/test-features.ts 直调服务层，验证的是业务逻辑；但历史上「操作失败」
 * 的真凶在 action / 客户端包层（一个坏版本被编译进 bundle）。这个脚本走真实
 * HTTP：登录拿会话 → 打开三个管理页 → 断言 200 且 HTML 里没有崩溃标记，
 * 从而在「dev server 编译产物」这一层兜住那类问题。
 *
 * 前置：dev server 必须在 http://localhost:3000 运行。
 * 执行：pnpm test:http
 */

const BASE = "http://localhost:3000";

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** 从 Set-Cookie 累积会话 cookie，跨请求携带 */
class CookieJar {
  private jar = new Map<string, string>();
  absorb(res: Response) {
    // undici 用 getSetCookie 返回数组；退回单值 header
    const raw = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    const list = raw.length > 0 ? raw : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : []);
    for (const line of list) {
      const [pair] = line.split(";");
      const idx = pair.indexOf("=");
      if (idx > 0) this.jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }
  header() {
    return Array.from(this.jar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) throw new Error("缺少 SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD");

  // dev server 存活性检查——不在则直接给出可操作的提示，而非一堆 fetch 报错
  try {
    await fetch(`${BASE}/login`, { redirect: "manual" });
  } catch {
    console.error(`无法连接 ${BASE}，请先启动 dev server（pnpm dev）后重试。`);
    process.exit(1);
  }

  const jar = new CookieJar();

  console.log("\n【登录】");
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  jar.absorb(csrfRes);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  check("取到 CSRF token", Boolean(csrfToken));

  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar.header() },
    body: new URLSearchParams({ csrfToken, email, password, redirectTo: "/admin/posts" }),
    redirect: "manual",
  });
  jar.absorb(loginRes);
  // 成功登录返回 302 到目标，且下发会话 cookie
  check("登录返回重定向", loginRes.status === 302 || loginRes.status === 303);
  check("拿到会话 cookie", /authjs|next-auth/i.test(jar.header()));

  console.log("\n【带会话访问管理页】");
  const pages = [
    ["/admin/posts", "文章列表"],
    ["/admin/posts/new", "写文章"],
    ["/admin/categories", "分类"],
    ["/admin/tags", "标签"],
    ["/admin", "仪表盘"],
    ["/admin/logs", "系统日志"],
  ] as const;

  // 崩溃标记：Next 的运行时错误覆盖层与常见异常关键字
  const crashMarkers = [
    "Application error",
    "is not defined",
    "Internal Server Error",
    "call of overloaded",
    "Unhandled Runtime Error",
  ];

  for (const [path, label] of pages) {
    const res = await fetch(`${BASE}${path}`, { headers: { cookie: jar.header() } });
    const html = await res.text();
    const hit = crashMarkers.find((m) => html.includes(m));
    check(`${label} (${path}) 返回 200`, res.status === 200, `status=${res.status}`);
    check(`${label} 无运行时崩溃标记`, !hit, hit ? `命中「${hit}」` : undefined);
    // 未登录会被重定向到 /login，用页面里是否含后台外壳判断会话确实生效
    if (path === "/admin/posts") {
      check("会话生效（未被踢回登录页）", html.includes("写文章") || html.includes("kdblog"));
    }
  }

  /**
   * 前台不得把读者引向管理后台。
   *
   * 文章详情等页面会被分享出去、被外部站点引用，读者顺着链接不该走进后台。
   * 这里以匿名访客身份（不带会话 cookie）抓取前台页面，断言 HTML 里没有
   * 任何指向 /admin 或 /login 的链接——包括序列化进 RSC 载荷的错误/404 边界。
   *
   * 用无会话请求：带上管理员会话反而可能让某些「仅登录可见」的入口出现，
   * 掩盖真实的对外表现。
   */
  console.log("\n【前台不得出现后台入口】");
  const publicPages = ["/", "/preview-error"] as const;
  // href 到 /admin 或 /login 的两种形态：普通 HTML 与 RSC 载荷里的转义写法
  const adminLinkRe = /href=\\?"\/(admin|login)/;

  for (const path of publicPages) {
    const res = await fetch(`${BASE}${path}`);
    const html = await res.text();
    check(`${path} 可匿名访问`, res.status === 200, `status=${res.status}`);
    check(`${path} 不含通往后台的链接`, !adminLinkRe.test(html));
  }

  console.log(`\n${"=".repeat(48)}`);
  console.log(`通过 ${passed} / ${passed + failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("\nHTTP 测试自身异常：", error);
  process.exit(1);
});
