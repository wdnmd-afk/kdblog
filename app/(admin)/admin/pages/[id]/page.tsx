import { notFound } from "next/navigation";

import { getPageById } from "@/server/services/page";
import { PageEditor } from "./PageEditor";

/**
 * 页面编辑路由。
 *
 * 与文章编辑页同构：id 为 "new" 时走新建分支，否则按数字 id 载入。
 */
export default async function PageEditRoute({
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

  const page = isNew ? null : await getPageById(Number(id));

  if (!isNew && !page) {
    notFound();
  }

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">{isNew ? "新建页面" : "编辑页面"}</h1>

      <PageEditor
        page={{
          id: page?.id,
          title: page?.title ?? "",
          slug: page?.slug ?? "",
          excerpt: page?.excerpt ?? "",
          contentJson: page?.contentJson ?? null,
          status: page?.status ?? "DRAFT",
        }}
      />
    </div>
  );
}
