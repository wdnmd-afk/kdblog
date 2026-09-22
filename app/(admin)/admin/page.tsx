import Link from "next/link";
import { ContentStatus } from "@prisma/client";
import { Plus } from "lucide-react";

import { prisma } from "@/lib/db";
import { buttonClass } from "@/components/ui";

/**
 * 后台仪表盘。
 *
 * 只做数量概览与快捷入口，不做图表——数据层没有访问统计，加图表得先加埋点。
 * 统计直连 prisma 而非经服务层：这里是聚合计数，不涉及软删内容外泄，
 * 但仍显式带上 deletedAt 条件，保持与服务层一致的语义。
 */
export default async function DashboardPage() {
  const [publishedPosts, draftPosts, pages, categories, tags, trashed] = await Promise.all([
    prisma.post.count({ where: { deletedAt: null, status: ContentStatus.PUBLISHED } }),
    prisma.post.count({ where: { deletedAt: null, status: ContentStatus.DRAFT } }),
    prisma.page.count({ where: { deletedAt: null } }),
    prisma.category.count(),
    prisma.tag.count(),
    prisma.post.count({ where: { deletedAt: { not: null } } }),
  ]);

  // 顺序对应稿子的 3×2 网格：已发布 / 草稿 / 页面 换行 分类 / 标签 / 回收站
  const stats = [
    { label: "已发布", value: publishedPosts, unit: "篇文章", href: "/admin/posts?status=PUBLISHED" },
    { label: "草稿", value: draftPosts, unit: "篇文章", href: "/admin/posts?status=DRAFT" },
    { label: "页面", value: pages, unit: "个页面", href: "/admin/pages" },
    { label: "分类", value: categories, unit: "个分类", href: "/admin/categories" },
    { label: "标签", value: tags, unit: "个标签", href: "/admin/tags" },
    { label: "回收站", value: trashed, unit: "篇内容", href: "/admin/trash" },
  ];

  return (
    <div className="space-y-7">
      <div className="flex items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">仪表盘</h1>
        <Link href="/admin/posts/new" className={buttonClass("primary")}>
          <Plus size={16} />
          写文章
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="rounded-panel border border-ink-200 bg-white px-5 py-5 transition-colors hover:border-ink-400"
          >
            <div className="text-[13px] text-ink-500">{item.label}</div>
            {/* 数字是这块的主角，字号拉到 40px 并用等宽数字保证多块对齐 */}
            <div className="mt-1.5 text-[2.5rem] font-semibold leading-none tabular-nums tracking-tight text-ink-900">
              {item.value}
            </div>
            <div className="mt-2 text-xs text-ink-400">{item.unit}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
