"use client";

import { useEffect } from "react";

/**
 * 根级错误边界。
 *
 * global-error 只在**根布局自身**抛错时触发（子路由的错误由各自的 error.tsx 接）。
 * 它必须自带 <html> 与 <body>：此时根布局没有渲染成功，没有任何外层骨架可继承。
 *
 * 样式刻意用内联而非 Tailwind 类：能走到这里说明渲染链已经出问题，
 * 不再依赖样式表是否成功加载更稳妥。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 生产环境下 Next 会脱敏错误详情，digest 是唯一能与服务端日志对上的线索
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#fff",
          color: "#1D1D1F",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif",
          padding: "0 20px",
        }}
      >
        <div style={{ maxWidth: "28rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>
            页面出错了
          </h1>
          <p
            style={{
              marginTop: "0.5rem",
              fontSize: "0.875rem",
              lineHeight: 1.6,
              color: "#6B7280",
            }}
          >
            应用在渲染时遇到问题。可以重试一次；若持续失败，请查看服务端日志。
          </p>

          {error.digest && (
            <p
              style={{
                marginTop: "0.75rem",
                fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
                fontSize: "0.75rem",
                color: "#86868B",
              }}
            >
              错误编号 {error.digest}
            </p>
          )}

          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              height: "2.25rem",
              padding: "0 0.875rem",
              border: "none",
              borderRadius: "4px",
              background: "#1D1D1F",
              color: "#fff",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            重试
          </button>
        </div>
      </body>
    </html>
  );
}
