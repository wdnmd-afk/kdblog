import type { ComponentProps, ReactNode } from "react";

/**
 * UI 原子组件。
 *
 * 存在的意义是收敛样式：若每个页面各写一套 class 串，改一次配色要翻遍所有文件，
 * 且不同页面的按钮高度、圆角迟早会不一致。这里只放高频、无状态的展示型组件，
 * 带交互逻辑的（如确认弹窗、浮层）留在 components/overlay.tsx 与各自的业务组件里。
 *
 * ⚠ 本文件刻意不带 "use client"：文章列表等 Server Component 会直接 import
 * Button / Badge。一旦引入 useState 之类的客户端 API，整个文件成为客户端边界，
 * 所有引用它的服务端组件都会被迫降级。
 *
 * 密度基调为「紧凑」：控件高度只用 28 / 32 / 36 三档，间距只取 4 的倍数。
 * 这是工具型后台的通行做法——一屏能看到更多内容，比留白优先更重要。
 */

/** 合并 class，过滤掉 false / undefined，省掉 clsx 依赖 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// 焦点环
// ---------------------------------------------------------------------------

/**
 * 统一的键盘焦点环。
 *
 * 用 focus-visible 而非 focus：鼠标点击也会触发 focus，
 * 那会让每次点按都留下一圈蓝环，看起来像是出了错。
 *
 * 全站共用这一个常量，而不是各处手写 ring 类：焦点可见性属于无障碍底线，
 * 分散写必然有地方漏掉。
 */
const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-accent-500/45 focus-visible:ring-offset-1 focus-visible:ring-offset-white";

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "xs" | "sm" | "md";

const BUTTON_BASE = cx(
  "inline-flex cursor-pointer select-none items-center justify-center gap-1.5 rounded-panel",
  "font-medium whitespace-nowrap transition-colors duration-150",
  "disabled:pointer-events-none disabled:opacity-45",
  FOCUS_RING
);

/**
 * 四档语义，层级靠「填充 → 描边 → 无边框」递减：
 *
 * - primary   强调蓝实心，一屏最多一个（新建、发布这类主动作）
 * - secondary 白底描边，常规操作
 * - ghost     无边框，工具栏图标与低频操作
 * - danger    红色文字 + 红色悬停底，删除类操作
 *
 * 危险操作刻意不做实心红：实心红按钮在列表里过于抢眼，
 * 会盖过主操作。真正不可逆的动作靠确认弹窗把关，而非靠按钮颜色吓人。
 */
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent-600 text-white hover:bg-accent-700 active:bg-accent-700",
  secondary:
    "border border-ink-300 bg-white text-ink-700 hover:bg-ink-50 hover:text-ink-900 active:bg-ink-100",
  ghost: "text-ink-500 hover:bg-ink-100 hover:text-ink-900 active:bg-ink-200",
  danger: "text-danger-600 hover:bg-danger-50 active:bg-danger-100",
};

/** 三档高度：28 用于行内操作，32 为默认，36 用于页面级主按钮 */
const BUTTON_SIZES: Record<ButtonSize, string> = {
  xs: "h-7 px-2 text-xs",
  sm: "h-8 px-2.5 text-[13px]",
  md: "h-9 px-3.5 text-sm",
};

export function Button({
  variant = "secondary",
  size = "sm",
  className,
  ...rest
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      type="button"
      className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      {...rest}
    />
  );
}

/**
 * 按钮样式串。
 *
 * 供 <Link> 等非 button 元素复用按钮外观：不能把 <button> 套进 <a> 里
 * （嵌套交互元素，键盘与读屏行为都不对），所以只借样式不借标签。
 */
export function buttonClass(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "sm",
  className?: string
): string {
  return cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className);
}

/**
 * 纯图标按钮。
 *
 * 单独成组件是为了强制 aria-label：图标按钮没有可见文字，
 * 漏了 label 读屏软件只会念出"按钮"。做成必填参数比靠自觉更可靠。
 *
 * 尺寸取正方形而非依赖 padding：图标按钮并排时，宽度不一会让工具栏看起来参差。
 */
export function IconButton({
  label,
  size = "sm",
  variant = "ghost",
  className,
  children,
  ...rest
}: Omit<ComponentProps<"button">, "aria-label"> & {
  label: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
}) {
  const box = { xs: "size-7", sm: "size-8", md: "size-9" }[size];
  return (
    <button
      type="button"
      aria-label={label}
      className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], box, "p-0", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Card / Panel
// ---------------------------------------------------------------------------

/**
 * 内容容器。
 *
 * 同时给边框与极浅阴影：只有阴影时在浅灰页面底上边界不清，
 * 只有边框时又显得扁平。两者叠加是主流后台（Linear、Vercel）的做法。
 */
export function Card({ className, ...rest }: ComponentProps<"div">) {
  return (
    <div
      className={cx(
        "rounded-card border border-ink-200 bg-white shadow-panel",
        className
      )}
      {...rest}
    />
  );
}

/** 卡片内的分区标题条。与 Card 配合使用，自带下边框 */
export function CardHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink-200 px-4 py-3">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-ink-900">{title}</h2>
        {description && (
          <p className="mt-0.5 truncate text-xs text-ink-500">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 表单控件
// ---------------------------------------------------------------------------

/**
 * 输入类控件的共同样式。
 *
 * 聚焦时同时改边框色与加环：只加环在浅色边框上对比不足，
 * 只改边框色则对键盘用户不够明显。
 */
const FIELD_BASE = cx(
  "w-full rounded-panel border border-ink-300 bg-white text-ink-900",
  "placeholder:text-ink-400 transition-colors duration-150",
  "hover:border-ink-400",
  "focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/25",
  "disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-400"
);

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={cx(FIELD_BASE, "h-8 px-2.5 text-[13px]", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cx(FIELD_BASE, "px-2.5 py-2 text-[13px] leading-relaxed", className)}
      {...rest}
    />
  );
}

/**
 * 下拉选择。
 *
 * 用内联 SVG 画箭头并隐藏原生箭头：各浏览器的原生箭头样式差异很大，
 * 在紧凑密度下尤其突兀。appearance-none 后必须自己补，否则没有任何下拉指示。
 */
export function Select({ className, ...rest }: ComponentProps<"select">) {
  return (
    <select
      className={cx(
        FIELD_BASE,
        "h-8 cursor-pointer appearance-none bg-no-repeat pl-2.5 pr-8 text-[13px]",
        "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22%2364748B%22 stroke-width=%221.5%22 stroke-linecap=%22round%22%3E%3Cpath d=%22M4 6.5l4 3.5 4-3.5%22/%3E%3C/svg%3E')]",
        "bg-[length:16px_16px] bg-[position:right_0.5rem_center]",
        className
      )}
      {...rest}
    />
  );
}

/**
 * 表单项。
 *
 * errors 用 role="alert" 而非普通文字：表单校验失败时读屏软件需要被动通知，
 * 否则键盘用户提交后只会觉得"没反应"。
 */
export function Field({
  label,
  hint,
  errors,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  errors?: string[];
  /** 关联控件 id。传了才能点标签聚焦输入框，受控组件建议一并给 input 设同名 id */
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="flex items-baseline gap-1.5 text-[13px] font-medium text-ink-800"
      >
        {label}
        {hint && <span className="text-xs font-normal text-ink-400">{hint}</span>}
      </label>
      {children}
      {errors && errors.length > 0 && (
        <div role="alert" className="space-y-0.5">
          {errors.map((message) => (
            <p key={message} className="text-xs text-danger-600">
              {message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

export type BadgeTone =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "outline";

/**
 * 状态徽章。
 *
 * 全部采用「浅底 + 同色深字」而非实心：实心徽章在列表里视觉重量过大，
 * 十几行排下来会盖过标题本身。浅底方案既能区分状态，又不抢内容的注意力。
 *
 * 色相不是唯一区分手段——文案本身（已发布/草稿）已经说明了状态，
 * 颜色只是加速识别，因此对色觉障碍用户也可用。
 */
const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-ink-100 text-ink-600",
  accent: "bg-accent-50 text-accent-700",
  success: "bg-success-50 text-success-600",
  warning: "bg-warning-50 text-warning-600",
  danger: "bg-danger-50 text-danger-600",
  outline: "border border-ink-200 bg-white text-ink-500",
};

export function Badge({
  tone = "neutral",
  className,
  ...rest
}: ComponentProps<"span"> & { tone?: BadgeTone }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-panel px-1.5 py-0.5 text-[11px] font-medium leading-5",
        BADGE_TONES[tone],
        className
      )}
      {...rest}
    />
  );
}

// ---------------------------------------------------------------------------
// 空状态与页头
// ---------------------------------------------------------------------------

/** 列表为空时的占位。给出明确的下一步动作，而不是只说"暂无数据" */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && (
        /* 图标裹一层浅底圆：裸图标在大片空白里显得孤立、像是没加载出来 */
        <div className="flex size-10 items-center justify-center rounded-full bg-ink-100 text-ink-400">
          {icon}
        </div>
      )}
      <div className="space-y-1">
        <p className="text-[13px] font-medium text-ink-800">{title}</p>
        {description && (
          <p className="mx-auto max-w-sm text-xs leading-relaxed text-ink-500">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

/**
 * 页面标题区。
 *
 * 标题用 text-lg 而非更大：后台页面标题只需标明"我在哪"，
 * 放大到 2xl 会与内容争夺注意力，也白占一行高度。
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        <h1 className="text-lg font-semibold tracking-tight text-ink-900">{title}</h1>
        {description && <p className="text-[13px] text-ink-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 分隔与骨架
// ---------------------------------------------------------------------------

/** 水平分隔线。语义上是装饰，因此 aria-hidden */
export function Divider({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx("h-px bg-ink-200", className)} />;
}

/**
 * 骨架块。
 *
 * 异步内容加载时先占住空间，避免内容到位后页面跳动（CLS）。
 * 用脉冲而非旋转：整块区域的等待用脉冲更贴合，spinner 适合按钮内的局部等待。
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cx("animate-pulse rounded-panel bg-ink-100", className)}
    />
  );
}
