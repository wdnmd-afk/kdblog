"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle, Loader2 } from "lucide-react";

import {
  publishPostsInBatchAction,
  trashPostsInBatchAction,
  unpublishPostsInBatchAction,
  type BatchActionResult,
} from "@/server/actions/post";
import { Badge, Button, cx, type BadgeTone } from "@/components/ui";
import { useFeedback } from "@/components/feedback";
import { PostRowActions } from "./PostRowActions";

/**
 * 带批量选择的文章表格。
 *
 * 为什么整张表放进客户端组件：勾选状态是纯客户端交互，若只把复选框做成客户端组件，
 * 「全选」与「已选 N 项」的工具栏就无法共享同一份状态，得靠 context 或提升到 URL，
 * 两者都比直接把表格主体交给客户端更绕。行数据仍由服务端查好后传入。
 */

export interface PostRow {
  id: number;
  title: string;
  slug: string;
  path: string;
  categoryName: string | null;
  status: string;
  statusLabel: string;
  statusTone: BadgeTone;
  keywordCount: number;
  updatedAt: string;
  published: boolean;
}

export function PostBulkTable({ rows }: { rows: PostRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<number[]>([]);
  const [pending, startTransition] = useTransition();
  const { toast, confirm } = useFeedback();

  const allSelected = rows.length > 0 && selected.length === rows.length;
  const someSelected = selected.length > 0;

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleAll() {
    setSelected(allSelected ? [] : rows.map((r) => r.id));
  }

  /**
   * 执行批量操作。
   *
   * 成功后清空选择并 refresh：不清空的话工具栏会继续显示已被移走的条目，
   * 用户再点一次会对着不存在的目标操作。
   */
  async function run(
    action: (ids: number[]) => Promise<BatchActionResult>,
    confirmOptions?: { title: string; description?: string; confirmLabel?: string }
  ) {
    if (confirmOptions) {
      const ok = await confirm({ ...confirmOptions, danger: true });
      if (!ok) return;
    }

    startTransition(async () => {
      const result = await action(selected);
      // 批量发布可能部分成功（SEO 不全的被跳过），msg 里带了明细，
      // 因此即使 ok 也要展示出来，不能只在失败时提示
      toast(result.msg, result.ok ? "success" : "error");
      if (result.ok) {
        setSelected([]);
        router.refresh();
      }
    });
  }

  return (
    <div>
      {/**
       * 工具栏占位高度固定：出现与消失时表格不会上下跳动。
       *
       * 有选中时换成浅蓝底而非浅灰——这是「当前有待处理的操作」的信号，
       * 与导航选中态同属强调蓝的用法，用灰底则与表头悬停态混淆。
       */}
      <div
        className={cx(
          "flex min-h-10 flex-wrap items-center gap-1.5 border-b px-4 py-1.5 text-[13px] transition-colors",
          someSelected ? "border-accent-200 bg-accent-50" : "border-ink-200 bg-white"
        )}
      >
        {someSelected ? (
          <>
            <span className="font-medium text-accent-700 tabular-nums">
              已选 {selected.length} 项
            </span>
            <span className="mx-1 h-3.5 w-px bg-accent-200" />
            <Button
              size="sm"
              disabled={pending}
              onClick={() => run(publishPostsInBatchAction)}
            >
              发布
            </Button>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => run(unpublishPostsInBatchAction)}
            >
              取消发布
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={() =>
                run(trashPostsInBatchAction, {
                  title: `将 ${selected.length} 篇文章移入回收站？`,
                  description: "移入回收站后前台立即不可见，可在回收站还原。",
                  confirmLabel: "移入回收站",
                })
              }
            >
              移入回收站
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setSelected([])}>
              取消选择
            </Button>
            {pending && <Loader2 size={14} className="animate-spin text-ink-400" />}
          </>
        ) : (
          <span className="text-xs text-ink-500">勾选文章可批量发布或删除</span>
        )}
      </div>

      {/* 横向可滚动：窄屏下宽表格自己滚，不撑破整页布局 */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-[13px]">
          <thead>
            <tr className="border-b border-ink-200 text-left text-[11px] font-medium uppercase tracking-wide text-ink-400">
              <th className="w-10 py-2 pl-4 pr-0">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="全选"
                />
              </th>
              <th className="px-3 py-2 font-medium">标题</th>
              <th className="px-3 py-2 font-medium">分类</th>
              <th className="px-3 py-2 font-medium">状态</th>
              <th className="px-3 py-2 font-medium">SEO</th>
              <th className="px-3 py-2 font-medium">更新时间</th>
              <th className="py-2 pl-3 pr-4 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((row) => {
              const checked = selected.includes(row.id);
              return (
                <tr
                  key={row.id}
                  className={cx(
                    // group 让行内的「查看」「操作」等次要图标平时淡出、悬停行时浮现，
                    // 静止状态因此更干净，只留标题与状态
                    "group transition-colors",
                    checked ? "bg-accent-50/60" : "hover:bg-ink-50"
                  )}
                >
                  <td className="py-2.5 pl-4 pr-0">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(row.id)}
                      aria-label={`选择「${row.title}」`}
                    />
                  </td>
                  {/* 标题只是标题。「在新标签查看」已挪到操作列——它是一个动作，
                      混在标题旁边既要靠悬停才浮现（发现不了），又让标题的可点区域
                      旁边多出一个语义不同的链接，误点会离开当前页 */}
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/admin/posts/${row.id}`}
                      className="block max-w-[24rem] truncate font-medium text-ink-900 transition-colors hover:text-accent-600"
                    >
                      {row.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-ink-500">{row.categoryName ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={row.statusTone}>{row.statusLabel}</Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    {row.keywordCount > 0 ? (
                      <span className="text-xs text-ink-500 tabular-nums">
                        {row.keywordCount} 个关键词
                      </span>
                    ) : (
                      <Badge tone="warning">
                        <AlertCircle size={11} />
                        未填
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-ink-500 tabular-nums">
                    {row.updatedAt}
                  </td>
                  <td className="py-2.5 pl-3 pr-4 text-right">
                    {/* 传标题进去：导出按钮的 aria-label 要靠它区分是哪一篇，
                        删除确认的文案也因此从「该文章」变成具体标题。
                        path 供操作栏里的「在新标签查看」使用，草稿行不渲染该按钮 */}
                    <PostRowActions
                      id={row.id}
                      published={row.published}
                      title={row.title}
                      path={row.path}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
