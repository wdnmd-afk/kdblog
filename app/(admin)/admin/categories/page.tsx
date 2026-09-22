import { getCategoryTree, flattenCategoryTree } from "@/server/services/category";
import { PageHeader } from "@/components/ui";

import CategoryManager from "./CategoryManager";

/**
 * 分类管理。
 *
 * 树在服务端组装完毕后整棵传给客户端组件：分类数量通常在几十个量级，
 * 一次取完比按层懒加载简单，也避免了展开时的加载闪烁。
 */
export default async function CategoriesPage() {
  const tree = await getCategoryTree();

  return (
    <div className="space-y-5">
      <PageHeader title="分类" description="支持多级嵌套，一篇文章归属一个分类" />
      <CategoryManager tree={tree} flat={flattenCategoryTree(tree)} />
    </div>
  );
}
