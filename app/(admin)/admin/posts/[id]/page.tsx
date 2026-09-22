import { notFound } from "next/navigation";

import { getCategoryTree, flattenCategoryTree } from "@/server/services/category";
import { listTags } from "@/server/services/tag";
import { getPostForEdit, listRevisions } from "@/server/services/post";
import { toSeoFormValues } from "@/server/services/seo";
import { PostEditor } from "./PostEditor";

/**
 * 文章编辑页。
 *
 * 新建与编辑复用同一路由：id 为 "new" 时走新建分支，否则按数字 id 载入既有文章。
 * 这样编辑器组件只有一份，避免"新建页能用、编辑页有 bug"的两套逻辑漂移。
 */
export default async function PostEditPage({
  params,
}: {
  // Next 16 起 params 是 Promise，必须 await
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const isNew = id === "new";

  if (!isNew && !/^\d+$/.test(id)) {
    notFound();
  }

  const [tree, tags, post] = await Promise.all([
    getCategoryTree(),
    listTags(),
    isNew ? Promise.resolve(null) : getPostForEdit(Number(id)),
  ]);

  // 编辑器的分类下拉用缩进表示层级，因此需要带 depth 的扁平列表
  const categories = flattenCategoryTree(tree);

  if (!isNew && !post) {
    notFound();
  }

  // 版本历史仅在编辑既有文章时有意义；快照在每次发布时写入
  const revisions = post ? await listRevisions(post.id) : [];

  return (
    <PostEditor
      categories={categories}
      allTags={tags}
      post={{
        id: post?.id,
        title: post?.title ?? "",
        slug: post?.slug ?? "",
        excerpt: post?.excerpt ?? "",
        contentJson: post?.contentJson ?? null,
        categoryId: post?.categoryId ?? null,
        tagIds: post?.tags.map((t) => t.tagId) ?? [],
        // 传给编辑器用于判断本地草稿是否比服务端内容新
        updatedAt: post?.updatedAt.toISOString(),
      }}
      seo={toSeoFormValues(post?.seo ?? null)}
      revisions={revisions.map((r) => ({
        id: r.id,
        version: r.version,
        title: r.title,
        createdAt: r.createdAt.toLocaleString("zh-CN"),
      }))}
    />
  );
}
