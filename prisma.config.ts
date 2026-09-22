import "dotenv/config";
import path from "node:path";
import { defineConfig, env } from "prisma/config";

/**
 * Prisma CLI 配置。
 *
 * Prisma 7 起 schema.prisma 的 datasource 不再接受 url，迁移工具的连接串移到这里；
 * 运行时连接则由 PrismaClient 的 adapter 提供（见 lib/db.ts），两者读同一个环境变量。
 */
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    // 种子数据：pnpm prisma db seed 时执行
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
