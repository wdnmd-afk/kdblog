# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# 依赖层：只装依赖，利用 Docker 层缓存——lock 文件不变时跳过重装
# ---------------------------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app

# argon2 与 sharp 是原生模块，Alpine 下编译需要这些工具
RUN apk add --no-cache libc6-compat python3 make g++

RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# 构建层
#
# 注意：构建期不连数据库。sitemap 用 connection()、文章页用 instant = false，
# 都推迟到请求时才查库，因此构建机不需要访问生产库。
# DATABASE_URL 仅为满足 prisma.config.ts 的环境变量校验而给占位值。
# ---------------------------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app

RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm prisma generate
RUN pnpm build

# ---------------------------------------------------------------------------
# 运行层：只带 standalone 产物，不含构建工具与开发依赖
# ---------------------------------------------------------------------------
FROM node:24-alpine AS runner
WORKDIR /app

RUN apk add --no-cache libc6-compat

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# 上传目录由 volume 挂载，容器重建后文件不丢
ENV UPLOAD_DIR=/app/uploads

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 迁移与种子在容器内执行需要 schema、prisma 配置与 CLI
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

RUN mkdir -p /app/uploads && chown -R nextjs:nodejs /app/uploads

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
