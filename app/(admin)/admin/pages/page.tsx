import Link from "next/link";
import { AlertCircle, Files, Plus } from "lucide-react";

import { listPages } from "@/server/services/page";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  buttonClass,
  type BadgeTone,
} from "@/components/ui";
import { PageRowActions } from "./PageRowActions";

/**
 * 独立页面列表。
 *
 * 当前范围内页面只在后台管理，不产出前台路由（架构约定），
 * 因此这里不显示"查看"链接，只有编辑入口。
 */
export const metadata = { title: "页面管理 - kdblog" };

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "草稿",
  PUBLISHED: "已发布",
  SCHEDULED: "定时",
  ARCHIVED: "归档",
};

/** 状态色调，仅用于展示；未知状态回落到 neutral */
const STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: "neutral",
  PUBLISHED: "success",
  SCHEDULED: "warning",
  ARCHIVED: "outline",
};

export default async function AdminPagesPage() {
  const { items, total } = await listPages({ pageSize: 50 });

  return (
    <div className="space-y-5">
      <PageHeader
        title="页面"
        description={`共 ${total} 个页面`}
        actions={
          <Link href="/admin/pages/new" className={buttonClass("primary")}>
            <Plus size={16} />
            新建页面
          </Link>
        }
      />

      {/* 页面 slug 直接占用根路径，这里明确提示，避免误建与内置路由冲突的 slug */}
      <div className="flex gap-2.5 rounded-panel border border-ink-200 bg-ink-50 px-3.5 py-3 text-xs leading-relaxed text-ink-700">
        <AlertCircle size={16} className="mt-px shrink-0 text-ink-500" />
        <p>
          页面 slug 会占用站点根路径（如 /about）。posts、admin、api 等系统保留字无法使用。
          当前版本页面仅作内容存储，前台暂不渲染。
        </p>
      </div>

      <Card className="overflow-hidden">
        {items.length === 0 ? (
          <EmptyState
            icon={<Files size={20} />}
            title="还没有页面"
            description="用于「关于」「联系」这类固定内容。"
            action={
              <Link href="/admin/pages/new" className={buttonClass("primary", "sm")}>
                <Plus size={16} />
                新建页面
              </Link>
            }
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs text-ink-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">标题</th>
                <th className="px-4 py-2.5 font-medium">路径</th>
                <th className="px-4 py-2.5 font-medium">状态</th>
                <th className="px-4 py-2.5 font-medium">更新时间</th>
                <th className="px-4 py-2.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 border-t border-ink-200">
              {items.map((page) => (
                <tr key={page.id} className="transition-colors hover:bg-ink-50/70">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/pages/${page.id}`}
                      className="font-medium text-ink-900 hover:text-ink-900"
                    >
                      {page.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-500">/{page.slug}</td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[page.status] ?? "neutral"}>
                      {STATUS_LABEL[page.status] ?? page.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-500">
                    {page.updatedAt.toLocaleString("zh-CN")}
                  </td>
                  <td className="px-4 py-3">
                    <PageRowActions id={page.id} title={page.title} status={page.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
