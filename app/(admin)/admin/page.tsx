import Link from "next/link";
import { ContentStatus } from "@prisma/client";
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  CircleCheck,
  Clock,
  SquarePen,
  Trash,
  TriangleAlert,
} from "lucide-react";

import { getDashboardOverview } from "@/server/services/dashboard";
import {
  Badge,
  Card,
  CardHeader,
  buttonClass,
  cx,
  type BadgeTone,
} from "@/components/ui";
import { BarTrend, ChartBody, DistributionBar } from "@/components/charts";

export const metadata = { title: "仪表盘" };

/**
 * 后台仪表盘。
 *
 * 版面要求：正好占满一屏，不产生整页滚动条。因此整个页面是一列 flex：
 * 页头与 KPI 行定高，下面两行图表用 flex-1 吃掉剩余高度，卡内超出的内容
 * 由 ChartBody 的 scroll 在卡片内部消化。
 *
 * 这个约束直接决定了取舍：快速入口（侧栏导航已有）、内容构成（与 KPI 的
 * 已发布/草稿数字重复）、常用标签（标签页自己就是个带计数的列表）三块都去掉了，
 * 留下的每一块都回答一个 KPI 数字答不了的问题——趋势、构成、动向、待办。
 *
 * 取数全部经 server/services/dashboard.ts，页面不直连 prisma。
 *
 * 明确不含阅读量统计——Post.viewCount 字段虽在 schema 里，但全仓库没有
 * 任何递增逻辑，恒为 0。详见该服务文件的说明。
 */

/** 状态文案与色调，与文章列表页保持同一套映射 */
const STATUS_LABELS: Record<ContentStatus, string> = {
  DRAFT: "草稿",
  PUBLISHED: "已发布",
  SCHEDULED: "定时发布",
  ARCHIVED: "已归档",
};

const STATUS_TONES: Record<ContentStatus, BadgeTone> = {
  DRAFT: "neutral",
  PUBLISHED: "success",
  SCHEDULED: "warning",
  ARCHIVED: "outline",
};

/**
 * 按时段问候。
 *
 * 只在服务端算：客户端算会在水合阶段因时区差产生不一致的文案。
 * 不带用户名——侧栏已经在底部常驻显示了，页头再写一遍是冗余。
 */
function greeting(hour: number): string {
  if (hour < 6) return "夜深了";
  if (hour < 12) return "早上好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

export default async function DashboardPage() {
  const overview = await getDashboardOverview();
  const { counts, deltas, health } = overview;

  const today = new Date();
  const dateLabel = today.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  // 本周与前一周的发布量对比。前一周为 0 时不给百分比——「+∞%」没有意义，
  // 此时「本周 N 篇」本身就是最好的说明
  const publishDelta = deltas.publishedThisWeek - deltas.publishedLastWeek;
  const publishTrendText =
    deltas.publishedLastWeek > 0
      ? `本周 ${deltas.publishedThisWeek} 篇 · 较上周 ${
          publishDelta > 0 ? "+" : ""
        }${publishDelta}`
      : `本周发布 ${deltas.publishedThisWeek} 篇`;

  // SEO 缺口直接写在「已发布」这张卡上：它正是这些文章的明细入口，
  // 放到待处理里会变成同一件事说两遍
  const publishedHint =
    health.seoIncomplete > 0
      ? `${publishTrendText} · ${health.seoIncomplete} 篇 SEO 待补`
      : publishTrendText;

  // KPI 卡的主体已经是文件数，副行只说体积，不再重复一遍数量
  const mediaUsageLabel =
    counts.mediaCount === 0 ? "还没有上传过图片" : `占用 ${counts.mediaSizeLabel}`;

  return (
    // min-h-0 是两行图表能用 flex-1 分配高度的前提；缺了它子项会按内容撑开，
    // 整页重新出现滚动条。外层 main 已经是 flex 列且带 min-h-0（见 admin/layout.tsx）
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* ------------------------------- 页头 ------------------------------- */}
      <div className="flex flex-none flex-wrap items-end justify-between gap-3">
        <div className="space-y-0.5">
          <h1 className="text-lg font-semibold tracking-tight text-ink-900">
            {greeting(today.getHours())}
          </h1>
          <p className="text-[13px] text-ink-500">{dateLabel}</p>
        </div>
        <Link href="/admin/posts/new" className={buttonClass("primary", "md")}>
          <SquarePen size={16} />
          写文章
        </Link>
      </div>

      {/* ------------------------------- 概览 ------------------------------- */}
      <div className="grid flex-none gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {/* 数字用等宽字形（tabular-nums）：多张卡并排时，位数不同的数字也能对齐 */}
        <StatCard
          label="已发布"
          value={counts.publishedPosts}
          unit="篇文章"
          href="/admin/posts?status=PUBLISHED"
          trend={
            // 有 SEO 缺口时切到 warning 色并去掉箭头：增长的好消息与「有待补的活」
            // 混成一句话时，颜色只该指向后者，否则两头都不明确
            health.seoIncomplete > 0 ? (
              <TrendHint direction="flat" tone="warning" text={publishedHint} />
            ) : (
              <TrendHint
                direction={publishDelta > 0 ? "up" : publishDelta < 0 ? "down" : "flat"}
                text={publishedHint}
              />
            )
          }
        />
        <StatCard
          label="草稿"
          value={counts.draftPosts}
          unit="篇文章"
          href="/admin/posts?status=DRAFT"
          trend={
            health.staleDrafts > 0 ? (
              <TrendHint
                direction="flat"
                tone="warning"
                text={`${health.staleDrafts} 篇超过 30 天未更新`}
              />
            ) : (
              <TrendHint direction="flat" text="暂无搁置的草稿" />
            )
          }
        />
        <StatCard
          label="页面"
          value={counts.publishedPages + counts.draftPages}
          unit="个页面"
          href="/admin/pages"
          trend={
            <TrendHint
              direction="flat"
              text={`${counts.publishedPages} 已发布 · ${counts.draftPages} 草稿`}
            />
          }
        />
        <StatCard
          label="媒体文件"
          value={counts.mediaCount}
          unit="个文件"
          trend={<TrendHint direction="flat" text={mediaUsageLabel} />}
        />
      </div>

      {/* --------------------------- 趋势 + 最近编辑 --------------------------- */}
      {/* 两行等分剩余高度。lg 以下退回按内容排布（此时页面本来就会滚，
          窄屏挤在一屏内反而每块都读不清） */}
      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-3">
        <Card className="flex flex-col lg:col-span-2 lg:min-h-0">
          <CardHeader title="发布趋势" description="近 30 天每天发布的文章数" />
          <ChartBody className="flex min-h-0 flex-1 flex-col">
            <BarTrend
              points={overview.publishTrend}
              emptyHint="近 30 天没有发布"
              className="min-h-0 flex-1"
            />
          </ChartBody>
        </Card>

        <Card className="flex flex-col lg:min-h-0">
          <CardHeader
            title="最近编辑"
            actions={
              <Link
                href="/admin/posts?sort=updated_desc"
                className="rounded-panel text-xs text-ink-500 transition-colors hover:text-accent-600"
              >
                全部
              </Link>
            }
          />
          {overview.recentPosts.length === 0 ? (
            <ChartBody>
              <p className="text-[13px] text-ink-500">还没有任何文章。</p>
            </ChartBody>
          ) : (
            // 列表在卡内滚动而非顶出整页滚动条
            <ul className="min-h-0 flex-1 divide-y divide-ink-100 overflow-y-auto">
              {overview.recentPosts.map((post) => (
                <li key={post.id}>
                  <Link
                    href={`/admin/posts/${post.id}`}
                    className="group flex items-center gap-2.5 px-4 py-2.5 transition-colors duration-150 hover:bg-ink-50/80"
                  >
                    <span className="flex-1 truncate text-[13px] text-ink-800 group-hover:text-ink-900">
                      {post.title}
                    </span>
                    <Badge tone={STATUS_TONES[post.status]}>
                      {STATUS_LABELS[post.status]}
                    </Badge>
                    <span className="w-16 shrink-0 text-right text-[11px] text-ink-400">
                      {post.updatedLabel}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* --------------------------- 分布 + 待处理 --------------------------- */}
      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-3">
        <Card className="flex flex-col lg:min-h-0">
          <CardHeader
            title="分类分布"
            description="按文章数排序"
            actions={
              <Link
                href="/admin/categories"
                className="rounded-panel text-xs text-ink-500 transition-colors hover:text-accent-600"
              >
                管理
              </Link>
            }
          />
          <ChartBody scroll className="min-h-0 flex-1">
            <DistributionBar
              items={overview.categoryDistribution}
              emptyHint="还没有分类。给文章归类之后这里会显示分布。"
            />
          </ChartBody>
        </Card>

        <Card className="flex flex-col lg:col-span-2 lg:min-h-0">
          <CardHeader title="待处理" description="需要关注但不会主动报警的事项" />
          <ChartBody scroll className="min-h-0 flex-1 space-y-2">
            <PendingRow
              icon={<Clock size={15} />}
              tone={health.staleDrafts > 0 ? "warning" : "ok"}
              label="搁置超过 30 天的草稿"
              detail="可以补完发布，或移入回收站"
              count={health.staleDrafts}
              href="/admin/posts?status=DRAFT&sort=updated_desc"
            />
            <PendingRow
              icon={<TriangleAlert size={15} />}
              tone={health.recentErrors > 0 ? "danger" : "ok"}
              label="近 24 小时的服务端错误"
              detail="可在系统日志里查看完整堆栈"
              count={health.recentErrors}
              href="/admin/logs"
            />
            <PendingRow
              icon={<Trash size={15} />}
              tone={health.trashedTotal > 0 ? "warning" : "ok"}
              label="回收站中的内容"
              detail="彻底删除后不可恢复"
              count={health.trashedTotal}
              href="/admin/trash"
            />
          </ChartBody>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 局部子组件
// ---------------------------------------------------------------------------

/**
 * 指标卡。
 *
 * 给了 href 就整张卡可点——卡片本身就是「点进这个数字的明细」的可点区域，
 * 比在角落里放一个「查看」小链接好按得多。没有对应明细页的指标（如媒体文件，
 * 当前还没有独立的媒体管理页）不传 href，渲染成静态卡而不是指向一个无关页面。
 */
function StatCard({
  label,
  value,
  unit,
  href,
  trend,
}: {
  label: string;
  value: number;
  unit: string;
  href?: string;
  trend: React.ReactNode;
}) {
  const body = (
    <>
      {/* 数字与单位同行基线对齐：单位单独占一行会让每张卡多吃 ~18px，
          四张卡就是白丢一行图表高度 */}
      <p className="text-[13px] text-ink-500">{label}</p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="text-[1.75rem] font-semibold leading-none tabular-nums tracking-tight text-ink-900">
          {value}
        </span>
        <span className="text-[11px] text-ink-400">{unit}</span>
      </p>
      <div className="mt-2.5 border-t border-ink-100 pt-2">{trend}</div>
    </>
  );

  const shell = "block rounded-card border border-ink-200 bg-white px-4 py-3 shadow-panel";

  return href ? (
    <Link href={href} className={cx(shell, "transition-colors duration-150 hover:border-ink-400")}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}

/**
 * 趋势提示。
 *
 * 箭头只是加速识别，文案里始终带着真实数字——只给一个箭头或只给颜色的话，
 * 色觉障碍用户与读屏用户都拿不到信息。
 */
function TrendHint({
  direction,
  text,
  tone = "neutral",
}: {
  direction: "up" | "down" | "flat";
  text: string;
  tone?: "neutral" | "warning";
}) {
  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : null;
  const color =
    tone === "warning"
      ? "text-warning-600"
      : direction === "up"
        ? "text-success-600"
        : direction === "down"
          ? "text-danger-600"
          : "text-ink-500";

  return (
    <p className={cx("flex items-center gap-1 truncate text-[11px]", color)}>
      {Icon && <Icon size={12} aria-hidden="true" className="shrink-0" />}
      {text}
    </p>
  );
}

/** 待处理事项的一行。count 为 0 时降到灰色，避免「零问题」也在抢注意力 */
function PendingRow({
  icon,
  tone,
  label,
  detail,
  count,
  href,
}: {
  icon: React.ReactNode;
  tone: "ok" | "warning" | "danger";
  label: string;
  detail: string;
  count: number;
  href: string;
}) {
  const hasWork = count > 0;
  const toneClass = !hasWork
    ? "text-ink-400"
    : tone === "danger"
      ? "text-danger-600"
      : "text-warning-600";

  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-panel border border-ink-200 px-3 py-2.5 transition-colors duration-150 hover:border-ink-300 hover:bg-ink-50/70"
    >
      <span className={cx("shrink-0", toneClass)}>
        {hasWork ? icon : <CircleCheck size={15} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-ink-800">{label}</span>
        <span className="block truncate text-[11px] text-ink-400">{detail}</span>
      </span>
      <span
        className={cx(
          "shrink-0 text-sm font-semibold tabular-nums",
          hasWork ? "text-ink-900" : "text-ink-300"
        )}
      >
        {count}
      </span>
      <ChevronRight
        size={14}
        aria-hidden="true"
        className="shrink-0 text-ink-300 transition-colors group-hover:text-ink-500"
      />
    </Link>
  );
}
