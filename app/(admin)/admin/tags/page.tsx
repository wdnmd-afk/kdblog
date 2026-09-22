import { listTagsWithCount } from "@/server/services/tag";
import { PageHeader } from "@/components/ui";
import { TagManager } from "./TagManager";

export const metadata = { title: "标签管理" };

export default async function TagsPage() {
  const tags = await listTagsWithCount();

  return (
    <div className="space-y-5">
      <PageHeader title="标签" description="写文章时输入新标签名也会自动创建" />
      <TagManager tags={tags} />
    </div>
  );
}
