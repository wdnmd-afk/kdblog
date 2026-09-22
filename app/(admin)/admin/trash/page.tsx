import { listTrashedPosts } from "@/server/services/post";
import { listPages } from "@/server/services/page";
import { PageHeader } from "@/components/ui";

import { TrashList } from "./TrashList";

/**
 * 回收站。
 *
 * 文章与页面的软删记录合并展示。软删除的意义在于误删可恢复，
 * 因此"彻底删除"必须二次确认（在 TrashList 中处理）。
 */
export const metadata = { title: "回收站 - kdblog" };

export default async function AdminTrashPage() {
  const [posts, pagesResult] = await Promise.all([
    listTrashedPosts(),
    listPages({ trashed: true, pageSize: 100 }),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="回收站"
        description="删除的内容保留在这里，可以还原或彻底删除。彻底删除不可恢复。"
      />

      {/* 文章与页面合并成一个列表，用 kind 区分来源，按删除时间倒序 */}
      <TrashList
        items={[
          ...posts.map((p) => ({
            kind: "post" as const,
            id: p.id,
            title: p.title,
            slug: p.slug,
            deletedAt: p.deletedAt,
          })),
          ...pagesResult.items.map((p) => ({
            kind: "page" as const,
            id: p.id,
            title: p.title,
            slug: p.slug,
            deletedAt: p.deletedAt,
          })),
        ].sort((a, b) => (b.deletedAt?.getTime() ?? 0) - (a.deletedAt?.getTime() ?? 0))}
      />
    </div>
  );
}
