import type { ReactNode } from "react";
import Link from "next/link";

import { cx } from "./ui";
import type { DistributionItem, TrendPoint } from "@/server/services/dashboard";

/**
 * 仪表盘图表原子。
 *
 * 为什么手写而不用图表库：
 *
 * 1. 仪表盘是 Server Component。recharts / chart.js 都必须跑在客户端，
 *    引入后要么整页降级为客户端渲染，要么把图表拆成客户端孤岛——一个纯只读的
 *    统计页面为此多背 100KB 以上的 JS 不划算。
 * 2. 这里只需要柱状与横向分布条两种形状，用 div 的比例尺寸就能覆盖，
 *    不需要坐标系、缩放、动画这些库才有的能力。
 * 3. 颜色可以直接取设计系统的 token（ink-* / accent-*），与全站配色天然一致，
 *    不必再维护一份图表主题映射。
 *
 * ⚠ 与 ui.tsx / table.tsx 一样刻意不带 "use client"：一旦引入客户端 API，
 * 所有引用它的服务端组件都会被迫降级。
 *
 * 无障碍约定：图表不是唯一的信息载体。数值一律以文字并排给出（分布条的名称+数字、
 * 柱状图的峰值与首尾日期），颜色与长度只是加速识别的辅助。
 */

// ---------------------------------------------------------------------------
// 纵向柱状图
// ---------------------------------------------------------------------------

/**
 * 按时间排列的柱状图。
 *
 * 高度由父容器决定：柱区用 absolute 铺在 flex-1 的盒子里，而不是写死 h-40。
 * 仪表盘要让整页正好占满一屏、不出滚动条，图表就得吃掉卡片里的剩余高度——
 * 写死高度的话，内容区一高一矮，剩下的空间要么空着要么溢出。
 *
 * 柱子悬停用原生 title 而非自绘 tooltip：后者需要客户端状态，
 * 而这里每根柱要传达的信息只有「某天几篇」一句话。
 */
export function BarTrend({
  points,
  emptyHint,
  className,
}: {
  points: TrendPoint[];
  /** 全部为 0 时显示的说明。渲染一条贴底的平线会被误读成「数据为 0」，不如直接说清 */
  emptyHint: string;
  className?: string;
}) {
  const max = Math.max(...points.map((p) => p.value));
  const isEmpty = max === 0;

  return (
    <div className={cx("flex flex-col", className)}>
      {/* 轴标签固定高度，柱区吃掉剩下的：标签在下方，先声明它才能让柱区算出真实可用高度 */}
      <div className="relative min-h-16 flex-1">
        {/* 基线：没有它，全为 0 时整块区域看起来像没渲染出来 */}
        <div className="absolute inset-x-0 bottom-0 h-px bg-ink-200" aria-hidden="true" />

        <div className="absolute inset-0 flex items-end gap-px">
          {points.map((point) => (
            <div
              key={point.key}
              title={point.title}
              className="group/bar relative flex h-full flex-1 items-end"
            >
              <div
                // 最小 2% 高度：值为 0 的日子仍留一道浅痕，读者能看出这天是被统计过的
                style={{ height: `${isEmpty ? 0 : Math.max(2, (point.value / max) * 100)}%` }}
                className={cx(
                  "w-full rounded-t-[2px] transition-colors duration-150",
                  point.value > 0
                    ? "bg-ink-300 group-hover/bar:bg-accent-500"
                    : "bg-ink-100"
                )}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2 flex flex-none items-center justify-between text-[11px] tabular-nums text-ink-400">
        <span>{points[0]?.label}</span>
        {isEmpty ? (
          <span className="text-ink-400">{emptyHint}</span>
        ) : (
          <span>峰值 {max} 篇</span>
        )}
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 横向分布条
// ---------------------------------------------------------------------------

/**
 * 分类/标签的横向分布。
 *
 * 用横向条而非饼图：状态只有几类时饼图尚可，但分类数会增长，
 * 超过 5 片就无法靠颜色区分，对色觉障碍用户更是完全失效。
 * 横条把「名称 + 数值 + 长度」并排放，不依赖颜色也能读。
 *
 * 长度以最大值归一化而非以总数：读者关心的是「哪个多」，
 * 以总数为分母时各类占比都很小，条子全都很短，反而看不出差异。
 */
export function DistributionBar({
  items,
  emptyHint,
}: {
  items: DistributionItem[];
  emptyHint: string;
}) {
  if (items.length === 0) {
    return <p className="text-[13px] text-ink-500">{emptyHint}</p>;
  }

  const max = Math.max(...items.map((item) => item.value));

  return (
    <ul className="space-y-3">
      {items.map((item) => {
        const content = (
          <>
            <span className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="truncate text-ink-700">{item.label}</span>
              <span className="tabular-nums text-ink-500">{item.value}</span>
            </span>
            <span
              style={{ width: `${Math.max(3, (item.value / max) * 100)}%` }}
              className={cx(
                "mt-1.5 block h-1.5 rounded-full",
                item.href
                  ? "bg-ink-300 transition-colors duration-150 group-hover/dist:bg-accent-500"
                  : "bg-ink-200"
              )}
            />
          </>
        );

        // 有条目的才给链接。用 flex/span 而非 div：<a> 里不能嵌块级元素时
        // 部分浏览器会把 DOM 拆开，span + block 是安全的写法
        return item.href ? (
          <li key={item.key}>
            <Link href={item.href} className="group/dist block">
              {content}
            </Link>
          </li>
        ) : (
          <li key={item.key}>{content}</li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// 卡片内滚动区
// ---------------------------------------------------------------------------

/**
 * 卡片正文容器。
 *
 * 抽出来是因为卡片用了 CardHeader（自带下边框与外边距），
 * 正文区若各页自己写 padding，几个卡片的文字左边界就对不齐。
 *
 * 传 scroll 时正文区自身可滚动：仪表盘整体定高不滚，超出部分必须在卡内消化，
 * 否则内容会把整页顶出滚动条——那正是这个页面要避免的。
 */
export function ChartBody({
  children,
  className,
  scroll = false,
}: {
  children: ReactNode;
  className?: string;
  scroll?: boolean;
}) {
  return (
    <div
      className={cx(
        "px-4 py-4",
        scroll && "min-h-0 flex-1 overflow-y-auto",
        className
      )}
    >
      {children}
    </div>
  );
}
