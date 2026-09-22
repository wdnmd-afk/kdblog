"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui";

/**
 * 后台错误边界。
 *
 * 接住 (admin) 分组下页面渲染时抛出的异常，避免落到 Next 的默认错误屏。
 * 与 global-error 的分工：那个只处理根布局崩溃，这个是分组级的，能保留后台外壳。
 *
 * 必须重新加载而不是只调 reset() 的场景：reset 只重渲染当前子树，
 * 若错误来自服务端数据（如数据库瞬时不可用），重渲染会立刻再次失败。
 * 因此这里同时给出「重试」与「重新加载」两条路。
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // digest 是生产环境下唯一能与服务端日志对上的线索
    console.error("[admin-error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <AlertTriangle size={28} strokeWidth={1.5} className="text-ink-300" />
      <h1 className="mt-5 text-xl font-semibold tracking-tight text-ink-900">
        操作没能完成
      </h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-500">
        页面在加载数据时出错了。可以先重试一次；如果一直失败，稍后再来。
      </p>

      {error.digest && (
        <p className="mt-3 font-mono text-xs text-ink-400">错误编号 {error.digest}</p>
      )}

      <div className="mt-7 flex gap-2">
        <Button variant="primary" onClick={reset}>
          <RotateCcw size={15} />
          重试
        </Button>
        <Button onClick={() => window.location.reload()}>重新加载</Button>
      </div>
    </div>
  );
}
