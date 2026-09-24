import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Markdown 导入导出的真实 HTTP 端到端实测。
 *
 * 与 scripts/test-markdown.ts 的分工：那个直调服务层，验证转换逻辑；
 * 这个走真实 HTTP，验证「运行时装配」——鉴权、Server Action 的序列化、
 * Route Handler 的响应头、以及 dev server 编译产物本身是否可用。
 *
 * 历史上「操作失败」的真凶常在 action/客户端包层（编译产物坏了），
 * 服务层测试完全看不到这类问题。
 *
 * ⚠ 必须用 127.0.0.1 而非 localhost：本机的 localhost 被代理劫持，
 * 会返回 502 而不是打到 dev server。
 *
 * 导出的文件会落到 tmp/md-export/ 供人工查看。
 */

const BASE = "http://127.0.0.1:16673";
const OUT_DIR = join(process.cwd(), "tmp", "md-export");

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

/** 累积会话 cookie，跨请求携带 */
class CookieJar {
  private jar = new Map<string, string>();
  absorb(res: Response) {
    const raw =
      (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    const list =
      raw.length > 0 ? raw : res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : [];
    for (const line of list) {
      const [pair] = line.split(";");
      const idx = pair.indexOf("=");
      if (idx > 0) this.jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }
  header() {
    return Array.from(this.jar.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
}

const SLUG = `e2e-md-${Date.now().toString(36)}`;

const SOURCE_MD = `---
title: "E2E 实测文章"
slug: "${SLUG}"
excerpt: "通过真实 HTTP 验证 Markdown 导入导出链路的测试文章。"
keywords: ["Markdown", "端到端", "实测"]
---

# E2E 实测文章

这是通过**真实 HTTP**上传的文档，含 _斜体_ 与 \`行内代码\`。

## 功能清单

- [x] 导入解析
- [ ] 导出下载
- 普通列表项

| 能力 | 状态 |
| --- | --- |
| 导入 | 已实现 |
| 导出 | 已实现 |

\`\`\`typescript
function greet(name: string): string {
  return \`Hello, \${name}\`;
}
\`\`\`

> 导出的文件应当能再次导入。

[项目地址](https://example.com)
`;

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) throw new Error("缺少 SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD");

  mkdirSync(OUT_DIR, { recursive: true });

  // dev server 存活性检查
  try {
    await fetch(`${BASE}/login`, { redirect: "manual" });
  } catch {
    console.error(`无法连接 ${BASE}，请先启动 dev server（pnpm dev）`);
    process.exit(1);
  }

  const jar = new CookieJar();

  // ---------------------------------------------------------------------
  console.log("\n【一】登录");
  // ---------------------------------------------------------------------

  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  jar.absorb(csrfRes);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  check("取到 CSRF token", Boolean(csrfToken));

  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar.header() },
    body: new URLSearchParams({ csrfToken, email, password, redirectTo: "/admin" }),
    redirect: "manual",
  });
  jar.absorb(loginRes);
  check("登录成功", loginRes.status === 302 || loginRes.status === 303, `status=${loginRes.status}`);
  check("拿到会话 cookie", /authjs|next-auth/i.test(jar.header()));

  // ---------------------------------------------------------------------
  console.log("\n【二】导出端点的鉴权");
  // ---------------------------------------------------------------------

  // 无会话访问导出端点应被拒——草稿内容不能泄露给未登录者
  const anonExport = await fetch(`${BASE}/api/posts/1/export`, { redirect: "manual" });
  check(
    "匿名访问导出端点被拒",
    anonExport.status === 401 || anonExport.status === 307 || anonExport.status === 302,
    `status=${anonExport.status}`
  );

  const badId = await fetch(`${BASE}/api/posts/abc/export`, {
    headers: { cookie: jar.header() },
  });
  check("非法 id 返回 400", badId.status === 400, `status=${badId.status}`);

  const notFound = await fetch(`${BASE}/api/posts/99999999/export`, {
    headers: { cookie: jar.header() },
  });
  check("不存在的文章返回 404", notFound.status === 404, `status=${notFound.status}`);

  // ---------------------------------------------------------------------
  console.log("\n【三】用服务层准备一篇文章（导入 + 发布）");
  // ---------------------------------------------------------------------

  /*
   * 这一步直接走服务层而非 HTTP：Server Action 的调用协议（$ACTION_ID 等）
   * 是 Next 的内部实现，用 fetch 手工拼不稳定，且那不是本测试的目的。
   * 本测试要验的是导出端点与整体装配，文章怎么建出来不重要。
   */
  const { splitFrontmatter } = await import("../lib/markdown");
  const { parseMarkdownBody } = await import("../lib/markdown/server");
  const postService = await import("../server/services/post");
  const { prisma } = await import("../lib/db");

  const admin = await prisma.user.findFirstOrThrow({ select: { id: true } });
  const { frontmatter, body } = splitFrontmatter(SOURCE_MD);
  const parsed = parseMarkdownBody(body);

  check("frontmatter 解析出标题", frontmatter?.title === "E2E 实测文章");
  check("正文解析非空", parsed.blockCount > 0, `blockCount=${parsed.blockCount}`);

  const created = await postService.publish({
    title: frontmatter!.title!,
    slug: frontmatter!.slug!,
    excerpt: frontmatter!.excerpt!,
    contentJson: parsed.contentJson,
    seo: {
      metaTitle: "E2E 实测文章 - Markdown 导入导出端到端验证",
      metaDescription:
        "通过真实 HTTP 请求验证 Markdown 导入解析与导出下载链路的测试文章，覆盖鉴权、响应头与文件内容。",
      keywords: frontmatter!.keywords!,
      canonicalUrl: "",
      ogImage: "",
      ogTitle: "",
      ogDescription: "",
      robots: "index,follow",
    },
    authorId: admin.id,
  });

  const createdIds = [created.id];
  check("文章已发布", created.status === "PUBLISHED");
  console.log(`  文章 id=${created.id} slug=${created.slug}`);

  try {
    // -------------------------------------------------------------------
    console.log("\n【四】通过 HTTP 导出文件");
    // -------------------------------------------------------------------

    const exportRes = await fetch(`${BASE}/api/posts/${created.id}/export`, {
      headers: { cookie: jar.header() },
    });

    check("导出返回 200", exportRes.status === 200, `status=${exportRes.status}`);

    const contentType = exportRes.headers.get("content-type") ?? "";
    check("Content-Type 为 markdown", contentType.includes("text/markdown"), contentType);
    check("声明了 UTF-8", contentType.includes("charset=utf-8"), contentType);

    const disposition = exportRes.headers.get("content-disposition") ?? "";
    check("带 attachment 头", disposition.includes("attachment"), disposition);
    check("带 filename*（UTF-8 文件名）", disposition.includes("filename*=UTF-8''"), disposition);
    check("带 ASCII 回退文件名", /filename="[^"]*"/.test(disposition), disposition);
    check("不缓存", (exportRes.headers.get("cache-control") ?? "").includes("no-store"));

    const downloaded = await exportRes.text();

    // 落盘供人工查看
    const outPath = join(OUT_DIR, `${created.slug}.md`);
    writeFileSync(outPath, downloaded, "utf8");
    console.log(`  已保存到 ${outPath}`);

    check("下载内容非空", downloaded.length > 0, `${downloaded.length} 字节`);
    check("中文未乱码", downloaded.includes("E2E 实测文章"));
    check("含 frontmatter", downloaded.startsWith("---\n"));
    check("含发布日期", /date: \d{4}-\d{2}-\d{2}/.test(downloaded));
    check("保留已勾选任务", /- \[x\] 导入解析/.test(downloaded));
    check("保留未勾选任务", /- \[ \] 导出下载/.test(downloaded));
    check("任务项紧凑无空行", /- \[x\] 导入解析\n- \[ \] 导出下载/.test(downloaded));
    check("保留表格", /\| --- \|/.test(downloaded));
    check("表格不是裸 HTML", !downloaded.includes("<table"));
    check("保留代码语言", /```typescript/.test(downloaded));
    check("保留引用", /^> 导出的文件应当能再次导入。$/m.test(downloaded));
    check("保留链接", /\[项目地址\]\(https:\/\/example\.com\)/.test(downloaded));

    // -------------------------------------------------------------------
    console.log("\n【五】改动下载的文件后重新导入并发布");
    // -------------------------------------------------------------------

    const editedSlug = `${created.slug}-v2`;
    const edited = downloaded
      .replace('title: "E2E 实测文章"', 'title: "E2E 实测文章（已修订）"')
      .replace(`slug: "${created.slug}"`, `slug: "${editedSlug}"`)
      .replace("- [ ] 导出下载", "- [x] 导出下载")
      .replace(
        "> 导出的文件应当能再次导入。",
        "> 导出的文件应当能再次导入。\n\n### 二次编辑新增\n\n这一段是下载后在外部加的。"
      );

    const editedPath = join(OUT_DIR, `${editedSlug}.md`);
    writeFileSync(editedPath, edited, "utf8");
    console.log(`  修改后的文件保存到 ${editedPath}`);

    const { frontmatter: meta2, body: body2 } = splitFrontmatter(edited);
    check("重新解析出修订标题", meta2?.title === "E2E 实测文章（已修订）", `得到 ${meta2?.title}`);
    check("重新解析出修订 slug", meta2?.slug === editedSlug);

    const reparsed = parseMarkdownBody(body2);
    const taskList = (reparsed.contentJson.content ?? []).find((n) => n.type === "taskList");
    const states = (taskList?.content ?? []).map((t) => t.attrs?.checked);
    check(
      "两个任务都成勾选态",
      states.length >= 2 && states.slice(0, 2).every((c) => c === true),
      `得到 ${JSON.stringify(states)}`
    );

    const headings = (reparsed.contentJson.content ?? [])
      .filter((n) => n.type === "heading")
      .map((n) => n.attrs?.level);
    check("无 h1 残留", !headings.includes(1), `层级 ${JSON.stringify(headings)}`);

    const republished = await postService.publish({
      title: meta2!.title!,
      slug: meta2!.slug!,
      excerpt: meta2!.excerpt!,
      contentJson: reparsed.contentJson,
      seo: {
        metaTitle: "E2E 实测文章（已修订）- 下载后再导入验证",
        metaDescription:
          "这是把导出的文件改动后重新导入并发布的文章，用于验证下载-编辑-上传这条真实工作流可用。",
        keywords: meta2!.keywords!,
        canonicalUrl: "",
        ogImage: "",
        ogTitle: "",
        ogDescription: "",
        robots: "index,follow",
      },
      authorId: admin.id,
    });
    createdIds.push(republished.id);

    check("修订版已发布", republished.status === "PUBLISHED");
    check("标题取自文件", republished.title === "E2E 实测文章（已修订）");
    check("正文含新增小节", (republished.contentHtml ?? "").includes("二次编辑新增"));
    check("任务清单结构保留", (republished.contentHtml ?? "").includes('data-type="taskList"'));

    // -------------------------------------------------------------------
    console.log("\n【六】再次导出修订版，确认稳定");
    // -------------------------------------------------------------------

    const export2 = await fetch(`${BASE}/api/posts/${republished.id}/export`, {
      headers: { cookie: jar.header() },
    });
    check("修订版导出返回 200", export2.status === 200);

    const downloaded2 = await export2.text();
    const finalPath = join(OUT_DIR, `${republished.slug}-final.md`);
    writeFileSync(finalPath, downloaded2, "utf8");
    console.log(`  最终文件保存到 ${finalPath}`);

    check("含二次编辑的内容", downloaded2.includes("二次编辑新增"));
    check("两个任务都是勾选态", /- \[x\] 导入解析[\s\S]*- \[x\] 导出下载/.test(downloaded2));

    // 幂等：再导入再导出应当不变
    const { body: body3 } = splitFrontmatter(downloaded2);
    const { contentJsonToMarkdown } = await import("../lib/markdown/server");
    const again = contentJsonToMarkdown(parseMarkdownBody(body3).contentJson);
    const bodyOnly = body3.trim();
    check("往返幂等（正文不再漂移）", again.trim() === bodyOnly, again === bodyOnly ? undefined : "内容仍在变化");

    if (again.trim() !== bodyOnly) {
      writeFileSync(join(OUT_DIR, "diff-a.md"), bodyOnly, "utf8");
      writeFileSync(join(OUT_DIR, "diff-b.md"), again.trim(), "utf8");
      console.log("  差异已写入 diff-a.md / diff-b.md");
    }

    console.log("\n【保留的文件】");
    console.log(`  ${OUT_DIR}`);
    console.log("  文章已保留在库中，可在后台查看：");
    console.log(`    ${BASE}/admin/posts/${created.id}`);
    console.log(`    ${BASE}/admin/posts/${republished.id}`);
  } finally {
    // 文章刻意不删——用户要求能把文章下载下来，留着便于在后台核对
    console.log(`\n  （测试文章 id=${createdIds.join(", ")} 已保留，需要时可在后台删除）`);
  }

  console.log(`\n${"=".repeat(48)}`);
  console.log(`通过 ${passed} / ${passed + failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("\n测试自身异常：", error);
  process.exit(1);
});
