import { listTrashedPosts } from "@/server/services/post";
import { PageHeader } from "@/components/ui";

import { TrashList } from "./TrashList";

/**
 * 回收站。
 *
 * 展示文章的软删记录。软删除的意义在于误删可恢复，
 * 因此"彻底删除"必须二次确认（在 TrashList 中处理）。
 */
export const metadata = { title: "回收站 - kdblog" };

export default async function AdminTrashPage() {
  const posts = await listTrashedPosts();

  return (
    <div className="space-y-5">
      <PageHeader
        title="回收站"
        description="删除的内容保留在这里，可以还原或彻底删除。彻底删除不可恢复。"
      />

      {/* 按删除时间倒序，最近删的排在前面 */}
      <TrashList
        items={posts
          .map((p) => ({
            id: p.id,
            title: p.title,
            slug: p.slug,
            deletedAt: p.deletedAt,
          }))
          .sort((a, b) => (b.deletedAt?.getTime() ?? 0) - (a.deletedAt?.getTime() ?? 0))}
      />
    </div>
  );
}
