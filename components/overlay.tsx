"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { cx } from "./ui";

/**
 * 交互浮层组件：Drawer / Modal / DropdownMenu / Tooltip。
 *
 * 为什么不放进 components/ui.tsx：那个文件刻意保持服务端可用（无 "use client"），
 * 文章列表等 Server Component 会直接 import 其中的 Button、Badge。
 * 一旦把带 useState 的组件混进去，整个文件变成客户端边界，服务端组件就被迫降级。
 *
 * 与 components/feedback.tsx 的分工：那边是「全局反馈」（toast、轻量确认），
 * 由 Provider 统一调度、页面里随处可调；这边是「页面内浮层」，
 * 由调用方自己控制开关与内容，不经过 Provider。
 *
 * 层级一律走 globals.css 的 z-index token（z-overlay / z-modal / z-dropdown /
 * z-toast），不写裸数字——浮层之间的遮挡关系必须在一处可读，
 * 散落的 z-30 / z-40 改动时无法判断会压住谁。
 */

// ---------------------------------------------------------------------------
// 浮层的共同行为
// ---------------------------------------------------------------------------

/**
 * 打开浮层期间锁定 body 滚动，并接管 Esc。
 *
 * 锁滚动时补上 padding-right 抵消滚动条宽度：直接 overflow: hidden 会让
 * 滚动条消失，页面内容横向跳动一下，浮层打开的瞬间很明显。
 *
 * 不做滚动位置恢复：浮层关闭后浏览器会保持原滚动位置，
 * 手动记录/还原反而容易在快速开关时错位。
 */
function useOverlayBehavior(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;

    const { overflow, paddingRight } = document.body.style;
    // 视口宽减去文档宽即滚动条占位，无滚动条时为 0
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = "hidden";
    if (scrollbar > 0) {
      document.body.style.paddingRight = `${scrollbar}px`;
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
}

/**
 * 焦点陷阱。
 *
 * 浮层打开后把焦点移入，并在 Tab 到头时绕回，避免键盘用户 Tab 到被遮罩
 * 挡住的页面元素上——那些元素视觉上不可见却仍可聚焦，是常见的可用性缺陷。
 *
 * 关闭时把焦点还给打开它的元素：否则焦点会掉回 body，
 * 键盘用户得从页首重新 Tab 一遍。
 */
function useFocusTrap(open: boolean, containerRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;

    const opener = document.activeElement as HTMLElement | null;

    const FOCUSABLE =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    // 优先聚焦标记了 data-autofocus 的元素，否则聚焦容器内第一个可聚焦元素
    const preferred = container.querySelector<HTMLElement>("[data-autofocus]");
    const first = preferred ?? container.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const items = Array.from(container!.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;

      const firstItem = items[0];
      const lastItem = items[items.length - 1];

      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      opener?.focus?.();
    };
  }, [open, containerRef]);
}

// ---------------------------------------------------------------------------
// 共用片段
// ---------------------------------------------------------------------------

/** 遮罩。点击即关闭，与 Esc 行为一致 */
function Scrim({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="absolute inset-0 z-overlay animate-fade-in bg-ink-950/40 backdrop-blur-[1px]"
      onClick={onClose}
      aria-hidden="true"
    />
  );
}

/** 浮层头部：标题 + 可选说明 + 关闭按钮 */
function OverlayHeader({
  titleId,
  title,
  description,
  onClose,
}: {
  titleId: string;
  title: string;
  description?: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4">
      <div className="min-w-0">
        <h2 id={titleId} className="text-sm font-semibold tracking-tight text-ink-900">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-xs leading-relaxed text-ink-500">{description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭"
        className="-mr-1.5 -mt-0.5 shrink-0 cursor-pointer rounded-panel p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-900"
      >
        <X size={16} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

/**
 * 右侧滑出面板。
 *
 * 用 fixed 覆盖而非挤压内容宽度：写作时打开设置若导致正文重排，
 * 光标位置会在视觉上跳动，是很差的写作体验。
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  width = "27rem",
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** 面板宽度。默认 27rem，够放 slug、分类、SEO 等表单 */
  width?: string;
  children: ReactNode;
  /** 固定在底部的操作区，不随内容滚动 */
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useOverlayBehavior(open, onClose);
  useFocusTrap(open, panelRef);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-modal">
      <Scrim onClose={onClose} />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ width }}
        className="absolute inset-y-0 right-0 z-modal flex max-w-full animate-slide-in-right flex-col bg-white shadow-modal"
      >
        <OverlayHeader
          titleId={titleId}
          title={title}
          description={description}
          onClose={onClose}
        />

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {footer && (
          <div className="border-t border-ink-200 bg-ink-50 px-5 py-3">{footer}</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal({
  open,
  onClose,
  title,
  description,
  size = "md",
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: "sm" | "md" | "lg";
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useOverlayBehavior(open, onClose);
  useFocusTrap(open, panelRef);

  if (!open) return null;

  const sizes = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" } as const;

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center px-4 py-8">
      <Scrim onClose={onClose} />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx(
          "relative z-modal flex max-h-full w-full animate-scale-in flex-col rounded-panel bg-white shadow-modal",
          sizes[size]
        )}
      >
        <OverlayHeader
          titleId={titleId}
          title={title}
          description={description}
          onClose={onClose}
        />

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {footer && (
          <div className="border-t border-ink-200 bg-ink-50 px-5 py-3">{footer}</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DropdownMenu
// ---------------------------------------------------------------------------

export interface DropdownItem {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  /** 危险项用红色文字标记，与普通项拉开距离 */
  danger?: boolean;
  disabled?: boolean;
}

/**
 * 点击触发的下拉菜单。
 *
 * 只做「点开、选一项、关闭」这一种用法，不做多级子菜单：
 * 后台里需要多级菜单的地方目前没有，先不引入这份复杂度。
 */
export function DropdownMenu({
  trigger,
  items,
  align = "end",
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  items: DropdownItem[];
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // 点击外部或按 Esc 关闭。这里不锁 body 滚动——下拉菜单不该冻结整页
  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <div ref={rootRef} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}

      {open && (
        <div
          role="menu"
          className={cx(
            "absolute top-full z-dropdown mt-1.5 min-w-44 animate-scale-in overflow-hidden rounded-panel border border-ink-200 bg-white p-1 shadow-popover",
            align === "end" ? "right-0 origin-top-right" : "left-0 origin-top-left"
          )}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                close();
                item.onSelect();
              }}
              className={cx(
                "flex w-full cursor-pointer items-center gap-2.5 rounded-panel px-2.5 py-1.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                item.danger
                  ? "text-danger-600 hover:bg-danger-50"
                  : "text-ink-700 hover:bg-ink-100 hover:text-ink-900"
              )}
            >
              {/* 图标统一 14px 且不压缩，否则长标签会把它挤扁 */}
              {item.icon && <span className="shrink-0 text-ink-400">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

/**
 * 悬浮提示。
 *
 * 基于 title 属性的原生提示延迟长、无法定制，工具栏的图标按钮又必须靠提示
 * 才能被理解，因此用 CSS 实现即时提示。
 *
 * 用 aria-label 而非 role="tooltip"：图标按钮真正需要的是无障碍名称，
 * 而 tooltip 角色要求额外的 aria-describedby 关联，这里得不偿失。
 */
export function Tooltip({
  label,
  side = "bottom",
  children,
}: {
  label: string;
  side?: "top" | "bottom";
  children: ReactNode;
}) {
  return (
    <span className="group/tooltip relative inline-flex">
      {children}
      <span
        role="presentation"
        className={cx(
          "pointer-events-none absolute left-1/2 z-toast -translate-x-1/2 whitespace-nowrap rounded-panel bg-ink-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-popover transition-opacity delay-500 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100",
          side === "bottom" ? "top-full mt-2" : "bottom-full mb-2"
        )}
      >
        {label}
      </span>
    </span>
  );
}
