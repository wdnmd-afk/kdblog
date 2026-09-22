import "dotenv/config";

/**
 * 发布链路冒烟测试。
 *
 * 直接调服务层验证「发布 → 预渲染 → 版本快照 → SEO 落库」这条主链路，
 * 绕过浏览器登录（CSRF 令牌在脚本里模拟成本高，登录本身另行手测）。
 *
 * 执行：pnpm tsx scripts/smoke-test.ts
 * 该脚本会写入真实数据，仅供本地开发环境使用。
 */

async function main() {
  const { prisma } = await import("../lib/db");
  const postService = await import("../server/services/post");
  const { buildPostPath } = await import("../lib/url");

  const admin = await prisma.user.findFirst();
  if (!admin) throw new Error("没有管理员账号，请先执行 pnpm db:seed");

  const category = await prisma.category.findFirst();

  const contentJson = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "这是冒烟测试文章的正文。" },
          { type: "text", marks: [{ type: "bold" }], text: "加粗文本" },
          { type: "text", text: "，以及下划线：" },
          { type: "text", marks: [{ type: "underline" }], text: "下划线文本" },
        ],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "二级标题" }],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "列表项一" }] }],
          },
        ],
      },
    ],
  };

  console.log("--- 1. 发布文章（含 SEO 强校验）---");
  const post = await postService.publishPost({
    title: "冒烟测试：验证发布链路",
    slug: "smoke-test-publish",
    contentJson,
    categoryId: category?.id ?? null,
    newTagNames: ["冒烟测试", "自动化"],
    authorId: admin.id,
    seo: {
      metaTitle: "冒烟测试：kdblog 发布链路验证",
      metaDescription:
        "验证 kdblog 的发布链路是否完整：SEO 强校验、正文预渲染、版本快照、标签自动创建与缓存失效。",
      keywords: ["kdblog", "发布链路", "冒烟测试"],
      canonicalUrl: "",
      ogImage: "",
      ogTitle: "",
      ogDescription: "",
      robots: "index,follow",
    },
  });
  console.log(`   已发布 id=${post.id} status=${post.status}`);
  console.log(`   前台地址: ${buildPostPath(post.slug, post.id)}`);

  console.log("--- 2. 校验 contentHtml 预渲染与 sanitize ---");
  const saved = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
  const html = saved.contentHtml ?? "";
  const checks: Array<[string, boolean]> = [
    ["含段落", html.includes("<p>")],
    ["含 h2", html.includes("<h2>")],
    ["含加粗", html.includes("<strong>")],
    ["含下划线（白名单修复验证）", html.includes("<u>")],
    ["含列表", html.includes("<ul>")],
    ["无 script 标签", !html.includes("<script")],
  ];
  for (const [name, ok] of checks) console.log(`   ${ok ? "✓" : "✗"} ${name}`);

  console.log("--- 3. 校验 SEO 落库 ---");
  const seo = await prisma.seoMeta.findUnique({ where: { postId: post.id } });
  console.log(`   metaTitle: ${seo?.metaTitle}`);
  console.log(`   keywords: ${seo?.keywords.join(" / ")}`);
  console.log(`   robots: ${seo?.robots}`);

  console.log("--- 4. 校验版本快照 ---");
  const revisions = await postService.listRevisions(post.id);
  console.log(`   快照数: ${revisions.length}，最新 v${revisions[0]?.version}`);

  console.log("--- 5. 校验标签自动创建（newTagNames 链路）---");
  const tags = await prisma.postTag.findMany({
    where: { postId: post.id },
    include: { tag: true },
  });
  console.log(`   关联标签: ${tags.map((t) => t.tag.name).join(" / ")}`);

  console.log("--- 6. 校验 SEO 不合规时阻止发布 ---");
  try {
    await postService.publishPost({
      title: "应当失败",
      slug: "should-fail",
      contentJson,
      seo: {
        metaTitle: "",
        metaDescription: "",
        keywords: [],
        canonicalUrl: "",
        ogImage: "",
        ogTitle: "",
        ogDescription: "",
        robots: "index,follow",
      },
    });
    console.log("   ✗ 未按预期阻止（SEO 校验失效）");
  } catch {
    console.log("   ✓ 已按预期阻止发布");
  }

  console.log("--- 7. 校验软删除后前台不可见 ---");
  await postService.trashPost(post.id);
  const afterTrash = await postService.getPublishedPost(post.id);
  console.log(`   ${afterTrash === null ? "✓" : "✗"} 软删后 getPublishedPost 返回 null`);
  await postService.restorePost(post.id);
  const afterRestore = await postService.getPublishedPost(post.id);
  console.log(`   ${afterRestore !== null ? "✓" : "✗"} 还原后重新可见`);

  await prisma.$disconnect();
  console.log("\n冒烟测试完成。");
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
