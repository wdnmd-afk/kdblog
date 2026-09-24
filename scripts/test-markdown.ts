import "dotenv/config";
import type { JSONContent } from "@tiptap/core";

import { prisma } from "../lib/db";
import * as postService from "../server/services/post";
import { buildFrontmatter, splitFrontmatter } from "../lib/markdown";
import { contentJsonToMarkdown, parseMarkdownBody } from "../lib/markdown/server";
import { extractPlainText } from "../lib/tiptap/plain-text";

/**
 * Markdown 导入导出的往返回归测试。
 *
 * 覆盖的链路是用户的真实操作序列：
 *   发布文章 -> 导出 .md -> 在外部编辑器改动 -> 重新导入 -> 再次发布
 *
 * 为什么值得单独一个脚本：这条链路的失败几乎都是**静默的**——不抛异常、
 * 不报错，只是内容悄悄少一块。开发时实际踩到过三次：
 *
 * 1. h1 被 Tiptap schema 拒绝后降级成普通段落，整篇文档的标题层级消失
 * 2. 任务清单的 `<li>` 与 `<input>` 之间夹了 `<p>`（松散列表），
 *    还原正则匹配不到，勾选状态全部丢失
 * 3. Tiptap 表格带 <colgroup>，turndown-plugin-gfm 判定不出表头行，
 *    整张表原样输出成 HTML 源码
 *
 * 这类问题靠类型检查与 lint 都发现不了，只能靠跑一遍真实数据。
 *
 * 前置：数据库可连接（读 .env 的 DATABASE_URL），且已有至少一个管理员用户。
 * 执行：pnpm test:markdown
 *
 * 测试会真实写库（发布两篇文章），结束时无论成败都会清理掉自己创建的数据。
 */

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

/** 测试文章的 slug 带时间戳，避免与既有数据或并发运行撞唯一约束 */
const SLUG = `md-roundtrip-${Date.now().toString(36)}`;

/** 覆盖各类节点的源文档。刻意用 `#` 写主标题——那正是 h1 降级的触发点 */
const SOURCE_MD = `# 往返测试文章

这是一段正文，含 **粗体**、_斜体_ 与 \`行内代码\`。

## 二级标题

#### 四级标题

- [x] 已完成的任务
- [ ] 未完成的任务
- 普通列表项

| 列A | 列B |
| --- | --- |
| 值1 | 值2 |

\`\`\`javascript
const a = 1;
const b = 2;
console.log(a + b);
\`\`\`

> 这是一段引用。

[外部链接](https://example.com)
`;

/** 发布所需的 SEO 字段。长度需满足 seoPublishSchema 的下限，否则发布会被拒 */
function seoFor(title: string, description: string, keywords: string[]) {
  return {
    metaTitle: title,
    metaDescription: description,
    keywords,
    canonicalUrl: "",
    ogImage: "",
    ogTitle: "",
    ogDescription: "",
    robots: "index,follow" as const,
  };
}

async function main() {
  const admin = await prisma.user.findFirst({ select: { id: true } });
  if (!admin) {
    console.error("没有管理员用户，请先跑 pnpm db:seed");
    process.exit(1);
  }

  const createdIds: number[] = [];

  try {
    // -------------------------------------------------------------------
    console.log("\n【一】导入源文档并发布");
    // -------------------------------------------------------------------

    const imported = parseMarkdownBody(SOURCE_MD);
    check("MD 解析出正文", imported.blockCount > 0, `blockCount=${imported.blockCount}`);
    check("预览 HTML 非空", imported.previewHtml.length > 0);

    const published = await postService.publish({
      title: "往返测试文章",
      slug: SLUG,
      excerpt: "用于验证 Markdown 导入导出往返的测试文章。",
      contentJson: imported.contentJson,
      seo: seoFor(
        "往返测试文章 - Markdown 导入导出验证",
        "这是一篇用于验证 Markdown 导入导出往返链路是否正确的测试文章，覆盖标题、列表、表格、代码块等节点。",
        ["Markdown", "导入导出", "往返测试"]
      ),
      authorId: admin.id,
    });
    createdIds.push(published.id);

    check("文章已发布", published.status === "PUBLISHED", `status=${published.status}`);
    check("contentHtml 已预渲染", Boolean(published.contentHtml));
    check("publishedAt 已写入", published.publishedAt !== null);

    // -------------------------------------------------------------------
    console.log("\n【二】导出为 Markdown");
    // -------------------------------------------------------------------

    const stored = await postService.getPostForEdit(published.id);
    if (!stored) throw new Error("读不回刚发布的文章");

    const exportedBody = contentJsonToMarkdown(stored.contentJson as JSONContent);
    const exportedFile = `${buildFrontmatter({
      title: stored.title,
      slug: stored.slug,
      excerpt: stored.excerpt,
      keywords: stored.seo?.keywords ?? [],
      date: stored.publishedAt?.toISOString().slice(0, 10),
    })}\n\n${exportedBody}\n`;

    check("导出含 frontmatter", exportedFile.startsWith("---\n"));
    check("frontmatter 带标题", /title: "往返测试文章"/.test(exportedFile));
    check("frontmatter 带 slug", exportedFile.includes(`slug: "${SLUG}"`));
    check("frontmatter 带关键词", /keywords: \[/.test(exportedFile));

    check("保留二级标题", /^## 二级标题$/m.test(exportedBody));
    check("保留粗体", /\*\*粗体\*\*/.test(exportedBody));
    check("保留已勾选任务", /- \[x\] 已完成的任务/.test(exportedBody));
    check("保留未勾选任务", /- \[ \] 未完成的任务/.test(exportedBody));
    check("保留表格分隔行", /\| --- \|/.test(exportedBody));
    check("保留代码语言标记", /```javascript/.test(exportedBody));
    check(
      "代码块保持 3 行",
      (/```javascript\n([\s\S]*?)\n```/.exec(exportedBody)?.[1] ?? "").split("\n").length === 3
    );
    check("保留引用", /^> 这是一段引用。$/m.test(exportedBody));
    check("保留链接", /\[外部链接\]\(https:\/\/example\.com\)/.test(exportedBody));

    // 回归点 3：表格曾原样输出成 HTML 源码
    check("表格不是裸 HTML", !exportedBody.includes("<table"));

    /*
     * 回归点 2：任务项之间不能有空行。
     *
     * 有空行就成了「松散列表」，marked 会把每项内容包进 <p>，
     * 再导入时任务清单会静默退化成普通列表。
     */
    check(
      "任务项之间无空行（紧凑列表）",
      /- \[x\] 已完成的任务\n- \[ \] 未完成的任务/.test(exportedBody)
    );

    // -------------------------------------------------------------------
    console.log("\n【三】在外部改动文件后重新导入");
    // -------------------------------------------------------------------

    const editedSlug = `${SLUG}-v2`;
    const editedFile = exportedFile
      .replace(/title: "往返测试文章"/, 'title: "往返测试文章（已修订）"')
      .replace(`slug: "${SLUG}"`, `slug: "${editedSlug}"`)
      .replace("- [ ] 未完成的任务", "- [x] 未完成的任务")
      .replace(
        "> 这是一段引用。",
        "> 这是一段引用。\n\n### 外部新增的小节\n\n这一段是在外部编辑器里加的。"
      );

    const { frontmatter: reMeta, body: reBody } = splitFrontmatter(editedFile);

    check("frontmatter 被解析出来", reMeta !== null);
    check("解析出修订后的标题", reMeta?.title === "往返测试文章（已修订）", `得到 ${reMeta?.title}`);
    check("解析出修订后的 slug", reMeta?.slug === editedSlug, `得到 ${reMeta?.slug}`);
    check("解析出摘要", Boolean(reMeta?.excerpt));
    check("解析出关键词", (reMeta?.keywords?.length ?? 0) === 3, `得到 ${reMeta?.keywords?.length} 个`);

    const reImported = parseMarkdownBody(reBody);
    const rePlain = extractPlainText(reImported.contentJson);

    check("重新导入的正文非空", reImported.blockCount > 0);
    check("外部新增的小节被带进来", rePlain.includes("外部新增的小节"));
    check("外部新增的段落被带进来", rePlain.includes("这一段是在外部编辑器里加的"));
    check("原有表格内容仍在", rePlain.includes("值1"));
    check("原有代码仍在", rePlain.includes("console.log(a + b)"));

    // 回归点 2：两个任务项都应是勾选态且仍为 taskItem
    const taskList = (reImported.contentJson.content ?? []).find((n) => n.type === "taskList");
    const taskStates = (taskList?.content ?? []).map((t) => t.attrs?.checked);
    check(
      "任务清单未退化，两项均为勾选态",
      taskStates.length >= 2 && taskStates.slice(0, 2).every((c) => c === true),
      `得到 ${JSON.stringify(taskStates)}`
    );

    // 回归点 1：h1 必须被钳到 h2，不能掉成段落
    const headings = (reImported.contentJson.content ?? [])
      .filter((n) => n.type === "heading")
      .map((n) => n.attrs?.level);
    check("无 h1 残留", !headings.includes(1), `层级序列 ${JSON.stringify(headings)}`);
    check(
      "标题层级都在 2~4",
      headings.every((l) => typeof l === "number" && l >= 2 && l <= 4),
      `层级序列 ${JSON.stringify(headings)}`
    );

    // -------------------------------------------------------------------
    console.log("\n【四】把修改后的内容发布为新文章");
    // -------------------------------------------------------------------

    const republished = await postService.publish({
      title: reMeta?.title ?? "未命名",
      slug: reMeta?.slug ?? `${SLUG}-fallback`,
      excerpt: reMeta?.excerpt ?? "",
      contentJson: reImported.contentJson,
      seo: seoFor(
        "往返测试文章（已修订）- Markdown 往返验证",
        "这是从导出文件修改后重新导入并发布的文章，用于验证整条往返链路在真实发布路径上可用。",
        reMeta?.keywords ?? ["Markdown", "导入导出", "往返测试"]
      ),
      authorId: admin.id,
    });
    createdIds.push(republished.id);

    check("新文章已发布", republished.status === "PUBLISHED");
    check("标题取自 frontmatter", republished.title === "往返测试文章（已修订）");
    check("slug 取自 frontmatter", republished.slug === editedSlug);
    check("contentHtml 已渲染", Boolean(republished.contentHtml));
    check("正文含外部新增内容", (republished.contentHtml ?? "").includes("外部新增的小节"));
    check(
      "HTML 保留任务清单结构",
      (republished.contentHtml ?? "").includes('data-type="taskList"')
    );
    check("HTML 保留表格", (republished.contentHtml ?? "").includes("<table"));

    const revisions = await prisma.postRevision.count({ where: { postId: republished.id } });
    check("发布生成了版本快照", revisions === 1, `得到 ${revisions} 条`);

    // -------------------------------------------------------------------
    console.log("\n【五】导出幂等性");
    // -------------------------------------------------------------------

    const stored2 = await postService.getPostForEdit(republished.id);
    const exported2 = contentJsonToMarkdown(stored2!.contentJson as JSONContent);
    const exported3 = contentJsonToMarkdown(parseMarkdownBody(exported2).contentJson);

    /*
     * 第二次与第三次导出必须完全一致。
     *
     * 第一次导出（从原始 MD 来）可以与之后不同——MD 有多种等价写法，
     * 经一轮 MD -> Tiptap -> MD 会收敛到本转换器的规范形式。
     * 但收敛之后就该稳定；若这里不等，说明每轮往返都在丢东西，
     * 反复导入导出会让文档持续劣化。
     */
    check("导出稳定（二次与三次一致）", exported2 === exported3);
    if (exported2 !== exported3) {
      console.log("--- 二次导出 ---\n" + exported2);
      console.log("--- 三次导出 ---\n" + exported3);
    }
  } finally {
    // 无论成败都清理，避免失败的运行在库里留下垃圾数据
    for (const id of createdIds) {
      await postService.deletePostPermanently(id).catch(() => {});
    }
    console.log(`\n【清理】已删除 ${createdIds.length} 篇测试文章`);
  }

  console.log(`\n${"=".repeat(48)}`);
  console.log(`通过 ${passed} / ${passed + failed}`);
  console.log(
    "\n未覆盖（需另行验证）：导入弹窗的交互与预览渲染、导出的浏览器下载行为，两者都是客户端行为，需人工或 E2E。"
  );

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("\n测试自身异常：", error);
  process.exit(1);
});
