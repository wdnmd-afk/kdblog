"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";

/**
 * 前台错误边界。
 *
 * 用 Tailwind 类但不复用 components/ui：错误可能源自某个共享组件，
 * 多引一层依赖会把风险带进错误页自身。视觉上与全站保持一致。
 *
 * 页头与页脚由 (site)/layout.tsx 提供——错误边界渲染在布局内部，
 * 这里再画一遍页头会重复。同样地，这里不出现任何管理后台的入口。
 */
export default function SiteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[site-error]", error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-5 py-20 sm:px-6">
      <AlertTriangle size={28} strokeWidth={1.5} className="text-ink-300" />
      <h1 className="mt-5 text-2xl font-semibold tracking-tight text-ink-900">
        页面暂时打不开
      </h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-500">
        服务端在读取内容时出了点问题。稍等片刻再试一次通常就好了。
      </p>

      {error.digest && (
        <p className="mt-3 font-mono text-xs text-ink-400">错误编号 {error.digest}</p>
      )}

      <div className="mt-7 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex cursor-pointer h-9 items-center gap-1.5 rounded-panel bg-ink-900 px-3.5 text-sm font-medium text-white transition-colors hover:bg-ink-800"
        >
          <RotateCcw size={15} />
          重试
        </button>
        <Link
          href="/"
          className="inline-flex h-9 items-center rounded-panel border border-ink-300 bg-white px-3.5 text-sm text-ink-800 transition-colors hover:bg-ink-50"
        >
          返回首页
        </Link>
      </div>
    </main>
  );
}
