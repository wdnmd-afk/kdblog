"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ContentStatus } from "@prisma/client";
import { Eye, EyeOff, Trash2 } from "lucide-react";

import {
  publishPageAction,
  unpublishPageAction,
  trashPageAction,
} from "@/server/actions/page";
import { Button } from "@/components/ui";
import { useFeedback } from "@/components/feedback";

/**
 * 页面列表的行内操作。
 *
 * 与文章的差别：页面无 SEO 强校验，因此可以直接在列表页发布，
 * 不必先进编辑器补齐 SEO 字段。
 */
export function PageRowActions({
  id,
  title,
  status,
}: {
  id: number;
  title: string;
  status: ContentStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { toast, confirm } = useFeedback();

  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    successMessage: string
  ) {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        toast(result.error ?? "操作失败", "error");
        return;
      }
      toast(successMessage, "success");
      router.refresh();
    });
  }

  async function trash() {
    // 软删可从回收站还原，所以确认文案说明去向而非强调危险
    const ok = await confirm({
      title: `将页面「${title}」移入回收站？`,
      description: "可以在回收站还原。",
      confirmLabel: "移入回收站",
    });
    if (!ok) return;
    run(() => trashPageAction(id), `页面「${title}」已移入回收站`);
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {status === ContentStatus.PUBLISHED ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => run(() => unpublishPageAction(id), `页面「${title}」已取消发布`)}
          title="取消发布"
          aria-label={`取消发布 ${title}`}
        >
          <EyeOff size={16} />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => run(() => publishPageAction(id), `页面「${title}」已发布`)}
          title="发布"
          aria-label={`发布 ${title}`}
        >
          <Eye size={16} />
        </Button>
      )}

      <Button
        variant="danger"
        size="sm"
        disabled={pending}
        onClick={trash}
        title="移入回收站"
        aria-label={`移入回收站 ${title}`}
      >
        <Trash2 size={16} />
      </Button>
    </div>
  );
}
