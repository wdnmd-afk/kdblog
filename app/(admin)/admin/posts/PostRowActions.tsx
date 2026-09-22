"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { EyeOff, Trash2 } from "lucide-react";

import { trashPostAction, unpublishPostAction } from "@/server/actions/post";
import { Button } from "@/components/ui";
import { useFeedback } from "@/components/feedback";

/**
 * 文章列表的行内操作。
 *
 * 拆成客户端组件是因为需要确认对话框与 pending 状态；列表页本身保持为
 * 服务端组件，避免把整张表的数据序列化到客户端。
 *
 * 反馈统一走 useFeedback：原先用 window.alert 报错、window.confirm 做确认，
 * 两者样式不可控且阻塞主线程，在移动端尤其突兀。
 */
export function PostRowActions({
  id,
  published,
  title,
}: {
  id: number;
  published: boolean;
  /** 用于确认文案与 Toast，让用户看清操作的是哪一篇 */
  title?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { toast, confirm } = useFeedback();

  const name = title ? `「${title}」` : "该文章";

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, successText: string) {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        toast(result.error ?? "操作失败", "error");
        return;
      }
      toast(successText, "success");
      router.refresh();
    });
  }

  async function trash() {
    // 软删可还原，因此文案强调「移入回收站」而非「删除」，并说明去哪儿找回
    const ok = await confirm({
      title: `将${name}移入回收站？`,
      description: "前台会立即不可见，可以在回收站还原。",
      confirmLabel: "移入回收站",
      danger: true,
    });
    if (!ok) return;
    run(() => trashPostAction(id), `${name}已移入回收站`);
  }

  return (
    // 图标按钮靠右对齐，与表头「操作」列的右对齐保持一致
    <div className="flex items-center justify-end gap-1">
      {published && (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => run(() => unpublishPostAction(id), `${name}已取消发布`)}
          title="取消发布"
          aria-label="取消发布"
        >
          <EyeOff size={16} />
        </Button>
      )}
      <Button
        variant="danger"
        size="sm"
        disabled={pending}
        onClick={trash}
        title="移入回收站"
        aria-label="移入回收站"
      >
        <Trash2 size={16} />
      </Button>
    </div>
  );
}
