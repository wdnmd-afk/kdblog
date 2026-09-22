"use client";

import { History } from "lucide-react";

import { Modal } from "@/components/overlay";
import { Button } from "@/components/ui";

/**
 * 版本历史。
 *
 * 从原先的「版本」Tab 改为模态：写作时不该常驻一块平时不看的列表，
 * 而回滚是低频且需要专注的操作，模态能让人看清自己选了哪一版。
 */

export interface RevisionItem {
  id: number;
  version: number;
  title: string;
  createdAt: string;
}

/** 需与 server/services/post.ts 的 REVISION_KEEP 保持一致 */
const REVISION_KEEP = 20;

export function RevisionsModal({
  open,
  onClose,
  revisions,
  onRevert,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  revisions: RevisionItem[];
  onRevert: (version: number) => void;
  pending: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="版本历史"
      description={`每次发布生成一个快照，仅保留最近 ${REVISION_KEEP} 版`}
    >
      {revisions.length === 0 ? (
        <p className="rounded-panel border border-ink-200 bg-ink-50 px-3 py-8 text-center text-sm text-ink-500">
          还没有版本记录，发布一次后会生成
        </p>
      ) : (
        <>
          <p className="mb-3 text-xs leading-relaxed text-ink-500">
            回滚只把内容恢复到编辑器，不会自动重新发布——
            确认无误后需再次点「发布」，线上内容才会变化。
          </p>

          <ul className="divide-y divide-ink-100 rounded-panel border border-ink-200">
            {revisions.map((rev) => (
              <li
                key={rev.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink-900">
                    <span className="mr-1.5 text-ink-400">v{rev.version}</span>
                    {rev.title || "（无标题）"}
                  </p>
                  <p className="text-xs text-ink-500">{rev.createdAt}</p>
                </div>
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => onRevert(rev.version)}
                  className="shrink-0"
                >
                  <History size={13} />
                  回滚到此版本
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
