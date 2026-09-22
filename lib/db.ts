import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

/**
 * Prisma 单例。
 *
 * Prisma 7 起 datasource 不再从 schema 读取 url，运行时连接必须显式传入 driver adapter，
 * 因此这里用 PrismaPg 包装 DATABASE_URL。迁移用的连接串单独配在 prisma.config.ts。
 *
 * 开发环境下 Next.js 的热更新会反复执行模块顶层代码，若每次都 new PrismaClient()
 * 会迅速耗尽数据库连接数，因此把实例挂到 globalThis 上复用；生产环境不需要这层处理。
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("缺少环境变量 DATABASE_URL，请参考 .env.example 配置");
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
