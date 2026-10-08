"use client";

import { useTransition } from "react";
import { RotateCcw, Trash2 } from "lucide-react";

import { restorePostAction, purgePostAction } from "@/server/actions/post";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { useFeedback } from "@/components/feedback";

/**
 * 回收站列表（文章）。
 *
 * 彻底删除不可恢复，因此走二次确认。
 */

export interface TrashItem {
  id: number;
  title: string;
  slug: string;
  deletedAt: Date | null;
}

export function TrashList({ items }: { items: TrashItem[] }) {
  const [pending, startTransition] = useTransition();
  const { toast, confirm } = useFeedback();

  function restore(item: TrashItem) {
    startTransition(async () => {
      const result = await restorePostAction(item.id);
      if (result.ok) {
        toast(`文章「${item.title}」已还原`, "success");
      } else {
        toast(result.msg, "error");
      }
    });
  }

  /**
   * 彻底删除。
   *
   * 这是全站唯一不可恢复的操作，确认文案必须点明"无法恢复"——
   * 只说"确定删除吗"会让人以为还能像软删一样找回来。
   */
  async function purge(item: TrashItem) {
    const ok = await confirm({
      title: `彻底删除文章「${item.title}」？`,
      description: "该内容及其 SEO 设置、标签关联、历史版本会一并删除，无法恢复。",
      confirmLabel: "彻底删除",
      danger: true,
    });
    if (!ok) return;

    startTransition(async () => {
      const result = await purgePostAction(item.id);
      if (result.ok) {
        toast(`文章「${item.title}」已彻底删除`, "success");
      } else {
        toast(result.msg, "error");
      }
    });
  }

  if (items.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Trash2 size={20} />}
          title="回收站是空的"
          description="删除的文章会出现在这里，可以还原或彻底删除。"
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left text-xs text-ink-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">标题</th>
              <th className="px-4 py-2.5 font-medium">删除时间</th>
              <th className="px-4 py-2.5 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100 border-t border-ink-200">
            {items.map((item) => (
              <tr key={item.id} className="transition-colors hover:bg-ink-50/70">
                <td className="px-4 py-3">
                  <Badge tone="accent">文章</Badge>
                  <span className="ml-2 text-ink-900">{item.title}</span>
                  <span className="ml-2 font-mono text-xs text-ink-400">/{item.slug}</span>
                </td>
                <td className="px-4 py-3 text-xs text-ink-500">
                  {item.deletedAt ? new Date(item.deletedAt).toLocaleString("zh-CN") : "—"}
                </td>
                <td className="px-4 py-3">
                  <span className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => restore(item)}
                      disabled={pending}
                      title="还原"
                      aria-label={`还原 ${item.title}`}
                    >
                      <RotateCcw size={16} />
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => void purge(item)}
                      disabled={pending}
                      title="彻底删除"
                      aria-label={`彻底删除 ${item.title}`}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
