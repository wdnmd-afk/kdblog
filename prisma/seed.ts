import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import argon2 from "argon2";

/**
 * 初始化种子数据：创建管理员账号与一个默认分类。
 *
 * 管理员密码从环境变量读取，不写死在代码里；未设置时中止而非使用默认弱口令，
 * 避免生产环境残留可预测的凭据。
 *
 * Prisma 7 起客户端必须显式传 adapter，这里与 lib/db.ts 用同一套连接方式。
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME ?? "管理员";

  if (!email || !password) {
    throw new Error(
      "缺少 SEED_ADMIN_EMAIL 或 SEED_ADMIN_PASSWORD 环境变量，请先在 .env 中配置后再执行 seed"
    );
  }

  if (password.length < 6) {
    throw new Error("SEED_ADMIN_PASSWORD 至少 6 位");
  }

  // 弱密码不阻断本地开发，但必须显式告警——避免这套凭据被原样带到生产
  if (password.length < 12 || /^[0-9]+$/.test(password)) {
    console.warn(
      "⚠ 当前管理员密码强度过低（纯数字或长度不足 12 位）。仅可用于本地开发，" +
        "部署前请改用强密码并重新执行 seed。"
    );
  }

  const passwordHash = await argon2.hash(password);

  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name, passwordHash },
    // 重复执行时同步密码，便于忘记密码后通过 seed 重置
    update: { name, passwordHash },
  });

  console.log(`管理员就绪: ${user.email}`);

  const category = await prisma.category.upsert({
    where: { slug: "uncategorized" },
    create: { name: "未分类", slug: "uncategorized", description: "默认分类" },
    update: {},
  });

  console.log(`默认分类就绪: ${category.name}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
