"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, ChevronRight, Info, Trash2 } from "lucide-react";

import { clearLogsAction } from "@/server/actions/system-log";
import type { LogEntry } from "@/server/services/system-log";
import { Badge, Button, Card, EmptyState, cx } from "@/components/ui";
import { useFeedback } from "@/components/feedback";

/**
 * 日志列表。
 *
 * 默认折叠堆栈，只显示「时间 / 位置 / 错误码 / 消息」这一行摘要——
 * 排查时先扫一眼就能定位是哪次操作失败，需要细节再展开看堆栈。
 */

const LEVEL_META = {
  error: { tone: "danger" as const, icon: AlertTriangle, label: "错误" },
  warn: { tone: "warning" as const, icon: AlertTriangle, label: "警告" },
  info: { tone: "neutral" as const, icon: Info, label: "信息" },
};

export function LogList({
  entries,
  days,
  activeDay,
}: {
  entries: LogEntry[];
  /** 可选日期，供切换 */
  days: string[];
  activeDay: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { toast, confirm } = useFeedback();
  const [expanded, setExpanded] = useState<string | null>(null);

  async function clearAll() {
    const ok = await confirm({
      title: "清空全部日志？",
      description: "历史错误记录会被删除且无法恢复。建议先确认不需要再回溯。",
      confirmLabel: "清空",
      danger: true,
    });
    if (!ok) return;

    startTransition(async () => {
      const result = await clearLogsAction();
      if (result.ok) {
        toast("日志已清空", "success");
        router.refresh();
      } else {
        toast(result.error, "error");
      }
    });
  }

  if (entries.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Info size={20} />}
          title={activeDay ? "这一天没有日志" : "没有日志记录"}
          description="这里会记录服务端的失败信息。空的说明还没有出现过被捕获的错误。"
          action={
            activeDay && days.length > 1 ? (
              <Link
                href="/admin/logs"
                className="text-[13px] text-accent-600 transition-colors hover:text-accent-700"
              >
                查看最近一天
              </Link>
            ) : undefined
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[13px] text-ink-500">
            共 {entries.length} 条，最新的在最前
          </p>

          {/* 多天有日志时才需要切换；只有一天时这行是多余的 */}
          {days.length > 1 && (
            <div className="flex items-center gap-0.5 rounded-panel bg-ink-100 p-0.5">
              {days.slice(0, 7).map((d) => {
                const active = d === activeDay;
                return (
                  <Link
                    key={d}
                    href={`/admin/logs?day=${d}`}
                    aria-current={active ? "true" : undefined}
                    className={cx(
                      "rounded-[4px] px-2.5 py-1 text-xs tabular-nums transition-colors",
                      active
                        ? "bg-white font-medium text-ink-900 shadow-panel"
                        : "text-ink-500 hover:text-ink-900"
                    )}
                  >
                    {d.slice(5)}
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <Button variant="danger" size="sm" onClick={clearAll} disabled={pending}>
          <Trash2 size={14} />
          清空日志
        </Button>
      </div>

      <Card className="divide-y divide-ink-100 overflow-hidden">
        {entries.map((entry, index) => {
          // 同一毫秒可能有多条，用索引参与 key 避免重复
          const key = `${entry.time}-${index}`;
          const open = expanded === key;
          const meta = LEVEL_META[entry.level] ?? LEVEL_META.info;
          const Icon = meta.icon;

          return (
            <div key={key}>
              <button
                type="button"
                onClick={() => setExpanded(open ? null : key)}
                aria-expanded={open}
                className="flex w-full cursor-pointer items-start gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-ink-50"
              >
                <span className="mt-0.5 shrink-0 text-ink-400">
                  {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={meta.tone}>
                      <Icon size={11} />
                      {meta.label}
                    </Badge>
                    <span className="font-mono text-xs text-ink-500">{entry.where}</span>
                    {entry.code && (
                      <span className="font-mono text-xs text-ink-400">{entry.code}</span>
                    )}
                    <span className="text-xs text-ink-400 tabular-nums">
                      {formatTime(entry.time)}
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-[13px] text-ink-800">
                    {entry.message || "(无消息)"}
                  </span>
                </span>
              </button>

              {open && (
                <div className="border-t border-ink-100 bg-ink-50 px-4 py-3">
                  {entry.meta && Object.keys(entry.meta).length > 0 && (
                    <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                      {Object.entries(entry.meta).map(([k, v]) => (
                        <div key={k} className="col-span-2 flex gap-3">
                          <dt className="shrink-0 font-mono text-ink-500">{k}</dt>
                          <dd className="min-w-0 break-all text-ink-800">{String(v)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-ink-600">
                    {entry.stack ?? "(无堆栈)"}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </Card>
    </div>
  );
}

/** 只显示到秒，日志不需要毫秒精度 */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { hour12: false });
}
