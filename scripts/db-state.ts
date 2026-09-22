import "dotenv/config";

/**
 * 打印当前库的关键状态。
 *
 * 排查「会话里的用户 id 是否还存在」「数据到底写没写进去」这类问题时用：
 * 例如发布后提示失败，先看 posts 是否为 0——为 0 说明事务整体回滚了，
 * 而非只是某个后置步骤出错。
 *
 * 执行：pnpm tsx scripts/db-state.ts
 */
async function main() {
  const { prisma } = await import("../lib/db");

  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  const [posts, tags, categories] = await Promise.all([
    prisma.post.count(),
    prisma.tag.count(),
    prisma.category.count(),
  ]);

  console.log("用户：");
  if (users.length === 0) console.log("  (无，需先执行 pnpm db:seed)");
  for (const u of users) console.log(`  id=${u.id}  email=${u.email}`);

  console.log(`文章 ${posts} / 标签 ${tags} / 分类 ${categories}`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
