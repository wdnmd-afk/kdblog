import type { ComponentProps, ReactNode } from "react";
import { Search, X } from "lucide-react";

import { cx } from "./ui";

/**
 * 表格原子组件（shadcn 风格的结构 + 苹果 Finder 的视觉密度）。
 *
 * 为什么单独成文件而不塞进 components/ui.tsx：那个文件已经承担了按钮、表单、
 * 徽章三类原子，再加一套表格会变成"什么都有"的杂物抽屉。表格有自己的一套
 * 结构约定（thead/tbody/th/td 必须成对使用），分开更好找。
 *
 * ⚠ 与 ui.tsx 一样刻意不带 "use client"：列表页多为 Server Component，
 * 一旦这里引入客户端 API，所有引用方都会被迫降级成客户端渲染。
 *
 * 视觉基调参考苹果的列表控件：
 * - 行高 44px（h-11），正好是 iOS/macOS 的最小点击目标，也是舒适的阅读节奏
 * - 分隔线只用发丝线（1px ink-200），不给单元格画竖线——竖线会让表格显得像
 *   电子表格，而苹果的列表始终只有横向分隔
 * - 表头用极浅底 + 小字号大字距，弱化到几乎只是个标记，把注意力留给数据
 */

// ---------------------------------------------------------------------------
// 结构
// ---------------------------------------------------------------------------

/**
 * 表格外层。
 *
 * 套一层 overflow-x-auto：窄屏下表格靠横向滚动保全列结构，
 * 而不是把列挤成换行的豆腐块。min-w 保证滚动真的会触发。
 */
export function Table({ className, ...rest }: ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table
        className={cx("w-full min-w-[34rem] border-collapse text-left", className)}
        {...rest}
      />
    </div>
  );
}

/**
 * 表头。
 *
 * 底色用 ink-50/70 而非实色：叠在白色卡片上是一层几乎无感的浅灰，
 * 实色 ink-50 在大面积下会显得像另一个独立区块。
 */
export function TableHead({ className, ...rest }: ComponentProps<"thead">) {
  return (
    <thead
      className={cx("border-b border-ink-200 bg-ink-50/70", className)}
      {...rest}
    />
  );
}

export function TableBody({ className, ...rest }: ComponentProps<"tbody">) {
  return <tbody className={cx("divide-y divide-ink-100", className)} {...rest} />;
}

/**
 * 表头单元格。
 *
 * 11px + 大字距 + 中性灰：表头是「标签」不是「内容」，压到最小可读档，
 * 让每一行数据成为视觉主体。align 用于数字列右对齐。
 */
export function Th({
  align = "left",
  className,
  ...rest
}: ComponentProps<"th"> & { align?: "left" | "right" | "center" }) {
  return (
    <th
      scope="col"
      className={cx(
        "whitespace-nowrap px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.055em] text-ink-500",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className
      )}
      {...rest}
    />
  );
}

export function Td({
  align = "left",
  className,
  ...rest
}: ComponentProps<"td"> & { align?: "left" | "right" | "center" }) {
  return (
    <td
      className={cx(
        "px-4 py-2 align-middle text-[13px] text-ink-700",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className
      )}
      {...rest}
    />
  );
}

/**
 * 数据行。
 *
 * min-h 由单元格的 py 与内容共同决定，这里只给 hover 底色与过渡。
 * hover 用 ink-50/80：比 ink-50 略实一点，在白底上才有明确的"这一行被指向"感。
 */
export function Tr({ className, ...rest }: ComponentProps<"tr">) {
  return (
    <tr
      className={cx(
        "group/row transition-colors duration-150 hover:bg-ink-50/80",
        className
      )}
      {...rest}
    />
  );
}

/** 空状态行。撑满所有列，内容由调用方给（通常是 EmptyState） */
export function TableEmptyRow({
  colSpan,
  children,
}: {
  colSpan: number;
  children: ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        {children}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// 工具栏
// ---------------------------------------------------------------------------

/**
 * 表格上方的工具栏。
 *
 * 固定 min-h-12 而非由内容决定高度：搜索框、计数、按钮在不同页面数量不一，
 * 高度统一后几个列表页并排看过去不会参差。
 *
 * 下边框由工具栏自己画，而不是交给表头：两者都画会出现 2px 的双线。
 */
export function TableToolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex min-h-12 flex-wrap items-center gap-2 border-b border-ink-200 px-3 py-2",
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * 表格搜索框。
 *
 * 做成圆角全高的「胶囊」而非普通方框：这是苹果搜索控件的固定形态，
 * 与表单里的方形输入框区分开——搜索是筛选视图，不是在录入数据。
 *
 * type="search" 让浏览器提供原生的清除行为与输入法优化，但原生清除按钮各家
 * 样式不一，因此自己画一个 X：只在有内容时出现，避免空框里挂个无用图标。
 */
export function TableSearch({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  /** 无障碍名称。搜索框没有可见 label，漏了读屏软件只会念「搜索框」 */
  label: string;
}) {
  return (
    <div className="relative min-w-[10rem] flex-1 sm:max-w-xs">
      <Search
        size={14}
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className={cx(
          "h-8 w-full rounded-full border border-ink-300 bg-white pl-8 text-[13px] text-ink-900",
          // 右侧留出清除按钮的位置，没有内容时也留着，避免文字在出现按钮时重排
          value ? "pr-8" : "pr-3",
          "placeholder:text-ink-400 transition-colors duration-150",
          "hover:border-ink-400",
          "focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/25",
          // 隐藏 Chrome/Edge 的原生清除按钮，否则会与自绘的 X 并排出现两个
          "[&::-webkit-search-cancel-button]:appearance-none"
        )}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="清空搜索"
          className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-ink-400 transition-colors duration-150 hover:bg-ink-100 hover:text-ink-700"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

/**
 * 行内操作区。
 *
 * 按钮常驻可见而非 hover 才显形：触屏设备没有 hover 态，隐藏式操作在平板上
 * 等于功能消失。改为「常驻 + 低对比」，hover 时才加深——既不抢视觉，
 * 也保证任何设备、任何输入方式都能发现并点到。
 */
export function RowActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-0.5 text-ink-400">
      {children}
    </div>
  );
}
