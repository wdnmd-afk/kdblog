"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Ban, Check } from "lucide-react";

import { cx } from "@/components/ui";
import { HIGHLIGHT_COLORS, TEXT_COLORS } from "@/lib/tiptap/editor-colors";

/**
 * 编辑器色板弹层。
 *
 * 为什么不用 <input type="color">：原生取色器是系统级弹窗，风格与本设计系统的
 * 紧凑密度完全脱节，而且它允许任意色值——色板受限反而更好，能保证全站正文
 * 的强调色不跑偏，也省掉一条「用户选了低对比度颜色」的可用性问题。
 *
 * 弹层自带开关与外部点击关闭，因为它的两个调用方（气泡菜单的入口按钮、
 * 代码块菜单）形态不同，把开关状态留在调用方会让两处各写一遍关闭逻辑。
 */

/** 色板类型：文字颜色与行内高亮共用一套弹层 */
export type SwatchKind = "text" | "highlight";

const SWATCHES: Record<SwatchKind, string[]> = {
  text: TEXT_COLORS,
  highlight: HIGHLIGHT_COLORS,
};

const LABELS: Record<SwatchKind, string> = {
  text: "文字颜色",
  highlight: "背景高亮",
};

export function ColorPicker({
  kind,
  activeValue,
  onPick,
  trigger,
}: {
  kind: SwatchKind;
  /** 当前光标处的色值，用于给对应色块打勾 */
  activeValue: string;
  onPick: (color: string) => void;
  /** 触发按钮。由调用方决定外观，弹层只负责开关与内容 */
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 点击外部或按 Esc 关闭。不锁 body 滚动——色板是轻量弹层，冻结整页太重
  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // 色值统一小写比较：节点属性里的来源不受控（粘贴内容可能是大写）
  const normalized = activeValue.toLowerCase();

  return (
    <div ref={rootRef} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}

      {open && (
        <div
          role="dialog"
          aria-label={LABELS[kind]}
          className="absolute left-1/2 top-full z-dropdown mt-1.5 w-44 -translate-x-1/2 animate-scale-in rounded-card border border-ink-200 bg-white p-2 shadow-popover"
        >
          <div className="grid grid-cols-4 gap-1.5">
            {SWATCHES[kind].map((color) => {
              const selected = normalized === color;
              return (
                <button
                  key={color}
                  type="button"
                  title={color}
                  aria-label={`${LABELS[kind]} ${color}`}
                  aria-pressed={selected}
                  // preventDefault 保住编辑器选区：失焦后选区消失，
                  // 命令会作用在错误的位置上
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onPick(color);
                    setOpen(false);
                  }}
                  style={{ backgroundColor: color }}
                  className={cx(
                    "flex size-7 cursor-pointer items-center justify-center rounded-panel border transition-transform hover:scale-110",
                    selected ? "border-ink-900" : "border-ink-200"
                  )}
                >
                  {/* 勾号颜色跟随色块明度不可靠，统一用带描边的白勾 */}
                  {selected && (
                    <Check
                      size={13}
                      strokeWidth={3}
                      className="text-white drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]"
                    />
                  )}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              // 空串表示清除该样式，与 Tiptap 的 unset 约定一致
              onPick("");
              setOpen(false);
            }}
            className="mt-1.5 flex w-full cursor-pointer items-center gap-2 rounded-panel px-2 py-1.5 text-left text-[13px] text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900"
          >
            <Ban size={14} className="shrink-0 text-ink-400" />
            清除
          </button>
        </div>
      )}
    </div>
  );
}
