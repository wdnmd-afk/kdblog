import { ContentStatus } from "@prisma/client";
import { connection } from "next/server";

import { prisma } from "@/lib/db";
import { countRecentErrors } from "./system-log";

/**
 * 仪表盘聚合服务。
 *
 * 仪表盘需要十几项互不相关的统计，若在页面里逐个 prisma.count，既违反
 * 「组件不直连 prisma」的约定，也会让取数与呈现混在一处。这里一次性并发取回，
 * 页面只负责画。
 *
 * ⚠ 刻意不统计阅读量：schema 里虽有 Post.viewCount，但全仓库没有任何递增逻辑
 * （前台详情页也没写入），该字段恒为 0。做成「阅读排行」只会显示一列 0，
 * 比不做更糟。等埋点补齐后再接入。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** 柱状趋势图的窗口，30 天在一屏宽度里每根柱子仍有 ~8px，再长就糊成一片 */
const TREND_DAYS = 30;

/** 草稿超过这个天数未更新就算「搁置」，提示到待处理里 */
const STALE_DRAFT_DAYS = 30;

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 趋势图的一个数据点 */
export interface TrendPoint {
  /** YYYY-MM-DD，作为 React key */
  key: string;
  /** 轴标签，如 9/22 */
  label: string;
  /** 无障碍用的完整描述 */
  title: string;
  value: number;
}

export interface DistributionItem {
  key: string;
  label: string;
  value: number;
  href?: string;
}

export interface RecentPostItem {
  id: number;
  title: string;
  status: ContentStatus;
  /** 已在服务端格式化的相对时间，避免客户端时区导致 hydration 不匹配 */
  updatedLabel: string;
  published: boolean;
}

export interface DashboardOverview {
  /**
   * 本次聚合的参考时刻，由服务层统一取一次。
   *
   * 页面里的「今天」「上午/下午」都要以它为基准：让页面自己再调一次 new Date()
   * 既会有跨秒漂移，也会把「必须在 connection() 之后取时」这条约束
   * 变成靠语句顺序维持的隐式依赖。
   */
  now: Date;
  counts: {
    publishedPosts: number;
    draftPosts: number;
    mediaCount: number;
    /** 已格式化的媒体总体积，如 12.4 MB */
    mediaSizeLabel: string;
  };
  /** 近 7 天与前 7 天的发布量对比，用于 KPI 卡的趋势提示 */
  deltas: {
    publishedThisWeek: number;
    publishedLastWeek: number;
  };
  /** 近 30 天每日发布量 */
  publishTrend: TrendPoint[];
  /** 分类分布（含「未分类」），倒序。取 5 项是因为它固定放在半宽卡片里，
   *  再多就会把卡片撑高、逼出整页滚动条 */
  categoryDistribution: DistributionItem[];
  /** 最近编辑过的内容 */
  recentPosts: RecentPostItem[];
  /** 需要处理的事项 */
  health: {
    /** 已发布但 SEO 字段不完整的文章数 */
    seoIncomplete: number;
    /** 搁置超过 30 天的草稿数 */
    staleDrafts: number;
    /** 回收站条目总数 */
    trashedTotal: number;
    /** 近 24 小时的错误日志条数 */
    recentErrors: number;
  };
}

// ---------------------------------------------------------------------------
// 时间工具
// ---------------------------------------------------------------------------

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

/** YYYY-MM-DD。用本地日期而非 toISOString：后者按 UTC 切分，东八区会把当天算成前一天 */
function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * 相对时间。
 *
 * 在服务端算好再传给组件：列表里「3 小时前」比「2026/9/22 14:03:11」更好扫视，
 * 但客户端算会因时区与时钟差产生 hydration 警告。
 */
function formatRelative(date: Date, now: Date): string {
  const diff = now.getTime() - date.getTime();
  if (diff < 60_000) return "刚刚";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
}

/** 字节数转可读体积。上限到 GB 就够——本地存储的博客图片不会到 TB */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  // 1 位小数：整数太粗（1MB 与 1.9MB 都显示 1MB），2 位小数在卡片里显得啰嗦
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

// ---------------------------------------------------------------------------
// 主查询
// ---------------------------------------------------------------------------

export async function getDashboardOverview(): Promise<DashboardOverview> {
  // 先等一次真实请求：cacheComponents 下预渲染阶段碰 new Date() 会被判为
  // 「不稳定值」（每次渲染结果不同，进不了静态外壳）而直接报错。
  // 异步查询本来就会推迟到请求时执行，只有这里的同步取时会被抓到，
  // 因此在这一处挡住，整个仪表盘就不再进入静态外壳。
  // 语义上也正确：仪表盘每次进入都该看到当前时刻的统计，不做缓存。
  await connection();

  const now = new Date();
  const today = startOfDay(now);

  const weekStart = new Date(today.getTime() - 6 * DAY_MS);
  const staleBefore = new Date(today.getTime() - STALE_DRAFT_DAYS * DAY_MS);
  // 时间线一次拉够 30 天：趋势图要满 30 天，「本周 vs 上周」只要 14 天，
  // 后者是前者的子集，因此共用同一次查询，不为 KPI 卡里的一句话再发一条 SQL
  const timelineStart = new Date(today.getTime() - (TREND_DAYS - 1) * DAY_MS);

  const [
    postStatusGroups,
    categories,
    categoryGroups,
    trashedPosts,
    mediaAgg,
    publishedTimeline,
    seoIncomplete,
    staleDrafts,
    recentErrors,
    recentPostRows,
  ] = await Promise.all([
    prisma.post.groupBy({
      by: ["status"],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    prisma.category.findMany({ select: { id: true, name: true } }),
    prisma.post.groupBy({
      by: ["categoryId"],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    prisma.post.count({ where: { deletedAt: { not: null } } }),
    prisma.media.aggregate({ _count: { _all: true }, _sum: { size: true } }),
    // 只取已发布且有 publishedAt 的：取消发布后 publishedAt 会保留（见 post.ts 的 unpublish），
    // 不加 status 条件会把已下架的文章算进发布趋势
    prisma.post.findMany({
      where: {
        deletedAt: null,
        status: ContentStatus.PUBLISHED,
        publishedAt: { gte: timelineStart },
      },
      select: { publishedAt: true },
      orderBy: { publishedAt: "asc" },
    }),
    // SEO 不完整的判定与 seoPublishSchema 的必填项对齐：标题、描述、关键词三者缺一即算不完整。
    // 空串在写入时已由 toSeoMetaData 转成 null，因此只判 null 与 isEmpty
    prisma.post.count({
      where: {
        deletedAt: null,
        status: ContentStatus.PUBLISHED,
        OR: [
          { seo: null },
          { seo: { metaTitle: null } },
          { seo: { metaDescription: null } },
          { seo: { keywords: { isEmpty: true } } },
        ],
      },
    }),
    prisma.post.count({
      where: { deletedAt: null, status: ContentStatus.DRAFT, updatedAt: { lt: staleBefore } },
    }),
    countRecentErrors(24),
    prisma.post.findMany({
      where: { deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: { id: true, title: true, status: true, updatedAt: true },
    }),
  ]);

  // --- 计数 -----------------------------------------------------------------

  const postCountByStatus = new Map(postStatusGroups.map((g) => [g.status, g._count._all]));

  const publishedPosts = postCountByStatus.get(ContentStatus.PUBLISHED) ?? 0;
  const draftPosts = postCountByStatus.get(ContentStatus.DRAFT) ?? 0;

  // --- 发布时间线分桶 -------------------------------------------------------

  const publishedDays = new Map<string, number>();
  for (const row of publishedTimeline) {
    if (!row.publishedAt) continue;
    const key = dayKey(row.publishedAt);
    publishedDays.set(key, (publishedDays.get(key) ?? 0) + 1);
  }

  const publishTrend: TrendPoint[] = Array.from({ length: TREND_DAYS }, (_, index) => {
    const date = new Date(today.getTime() - (TREND_DAYS - 1 - index) * DAY_MS);
    const key = dayKey(date);
    const value = publishedDays.get(key) ?? 0;
    return {
      key,
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      title: `${date.toLocaleDateString("zh-CN", { month: "long", day: "numeric" })} 发布 ${value} 篇`,
      value,
    };
  });

  const publishedThisWeek = countPublishedBetween(publishedTimeline, weekStart, now);
  const publishedLastWeek = countPublishedBetween(
    publishedTimeline,
    new Date(weekStart.getTime() - 7 * DAY_MS),
    weekStart
  );

  // --- 分类分布 -------------------------------------------------------------

  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const categoryDistribution: DistributionItem[] = categoryGroups
    .map((group) => {
      const id = group.categoryId;
      return id === null
        ? {
            key: "uncategorized",
            label: "未分类",
            value: group._count._all,
            // 分类筛选只接受数字 id，「未分类」无法用同一个 query 表达，因此不给链接
          }
        : {
            key: String(id),
            label: categoryNames.get(id) ?? `#${id}`,
            value: group._count._all,
            href: `/admin/posts?categoryId=${id}`,
          };
    })
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  return {
    now,
    counts: {
      publishedPosts,
      draftPosts,
      mediaCount: mediaAgg._count._all,
      mediaSizeLabel: formatBytes(mediaAgg._sum.size ?? 0),
    },
    deltas: {
      publishedThisWeek,
      publishedLastWeek,
    },
    publishTrend,
    categoryDistribution,
    recentPosts: recentPostRows.map((post) => ({
      id: post.id,
      title: post.title,
      status: post.status,
      updatedLabel: formatRelative(post.updatedAt, now),
      published: post.status === ContentStatus.PUBLISHED,
    })),
    health: {
      seoIncomplete,
      staleDrafts,
      trashedTotal: trashedPosts,
      recentErrors,
    },
  };
}

/** 左闭右开区间内的发布数 */
function countPublishedBetween(
  rows: Array<{ publishedAt: Date | null }>,
  from: Date,
  to: Date
): number {
  return rows.filter(
    (row) =>
      row.publishedAt !== null &&
      row.publishedAt.getTime() >= from.getTime() &&
      row.publishedAt.getTime() < to.getTime()
  ).length;
}
