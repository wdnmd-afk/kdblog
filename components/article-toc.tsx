"use client";

import { useEffect, useRef, useState } from "react";

import { cx } from "@/components/ui";
import type { TocItem } from "@/lib/toc";

/**
 * 文章右侧大纲。
 *
 * 点击定位用原生锚点（href="#id"），不依赖 JS —— 即使脚本未执行也能跳转，
 * 这是渐进增强的底线。脚本只负责两件加分的事：平滑滚动与高亮当前章节。
 *
 * 高亮用滚动位置计算而非 IntersectionObserver：后者的回调顺序不保证，
 * 在快速滚动时容易出现"高亮跳来跳去"。按位置取「已滚过线的最靠后一个标题」
 * 结果确定，且只在一个 rAF 里读一次布局。
 */

/** 判定线距视口顶部的距离，与 globals.css 的 scroll-padding-top 保持同一量级 */
const ACTIVE_LINE = 96;

export function ArticleToc({ items }: { items: TocItem[] }) {
  const [activeId, setActiveId] = useState<string>(items[0]?.id ?? "");
  // 用 rAF 节流：滚动事件触发极频繁，直接读布局会拖慢页面
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (items.length === 0) return;

    const update = () => {
      frame.current = null;

      // 取最后一个已越过判定线的标题；都没越过时保持第一个高亮
      let current = items[0].id;
      for (const item of items) {
        const el = document.getElementById(item.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= ACTIVE_LINE) current = item.id;
        else break;
      }

      // 滚到底部时最后一个标题可能始终越不过判定线，强制点亮它
      const atBottom =
        window.innerHeight + window.scrollY >= document.body.scrollHeight - 2;
      if (atBottom) current = items[items.length - 1].id;

      setActiveId(current);
    };

    const onScroll = () => {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [items]);

  if (items.length < 2) return null;

  return (
    <nav aria-label="文章大纲" className="sticky top-20">
      <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-ink-400">
        目录
      </p>

      <ul className="space-y-px border-l border-ink-200">
        {items.map((item) => {
          const active = item.id === activeId;
          // 层级用缩进表达，缩进量按 level 递增；左边条统一在容器上
          const indent = { 2: "pl-3", 3: "pl-6", 4: "pl-9" }[item.level] ?? "pl-3";

          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={active ? "location" : undefined}
                // 用 ::before 画选中边条，避免 border 引起水平抖动
                className={cx(
                  "relative block py-1 pr-2 text-[13px] leading-snug transition-colors",
                  indent,
                  active
                    ? "font-medium text-accent-700 before:absolute before:-left-px before:top-0 before:h-full before:w-0.5 before:bg-accent-600"
                    : "text-ink-500 hover:text-ink-900"
                )}
              >
                {item.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
