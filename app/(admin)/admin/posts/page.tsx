import Link from "next/link";
import { ContentStatus } from "@prisma/client";
import { FileText, Plus, Search } from "lucide-react";

import { listPosts, type PostSort } from "@/server/services/post";
import { flattenCategoryTree, getCategoryTree } from "@/server/services/category";
import { listTags } from "@/server/services/tag";
import { buildPostPath } from "@/lib/url";
import {
  Card,
  EmptyState,
  Input,
  PageHeader,
  Select,
  buttonClass,
  cx,
  type BadgeTone,
} from "@/components/ui";
import { PostBulkTable, type PostRow } from "./PostBulkTable";

/**
 * 文章列表。
 *
 * 所有筛选条件走 URL query 而非组件内 state：列表页因此保持为 Server Component，
 * 筛选结果可直接分享链接，浏览器前进后退也符合预期。
 */

const STATUS_LABELS: Record<ContentStatus, string> = {
  DRAFT: "草稿",
  PUBLISHED: "已发布",
  SCHEDULED: "定时发布",
  ARCHIVED: "已归档",
};

const STATUS_FILTERS: Array<{ label: string; value?: ContentStatus }> = [
  { label: "全部" },
  { label: "已发布", value: ContentStatus.PUBLISHED },
  { label: "草稿", value: ContentStatus.DRAFT },
];

/** 状态对应的 Badge 色调，纯展示用，与业务枚举解耦 */
const STATUS_TONES: Record<ContentStatus, BadgeTone> = {
  DRAFT: "neutral",
  PUBLISHED: "success",
  SCHEDULED: "warning",
  ARCHIVED: "outline",
};

const SORT_OPTIONS: Array<{ value: PostSort; label: string }> = [
  { value: "updated_desc", label: "最近修改" },
  { value: "published_desc", label: "最新发布" },
  { value: "published_asc", label: "最早发布" },
  { value: "created_desc", label: "最近创建" },
  { value: "title_asc", label: "标题 A-Z" },
];

const SORT_VALUES = new Set<string>(SORT_OPTIONS.map((o) => o.value));

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    keyword?: string;
    page?: string;
    categoryId?: string;
    tagId?: string;
    sort?: string;
  }>;
}) {
  const params = await searchParams;

  // query 参数来自 URL，逐个校验合法性再传入服务层，避免把任意字符串当枚举或数字用
  const status =
    params.status && params.status in STATUS_LABELS
      ? (params.status as ContentStatus)
      : undefined;
  const categoryId = Number(params.categoryId) || undefined;
  const tagId = Number(params.tagId) || undefined;
  const sort = params.sort && SORT_VALUES.has(params.sort) ? (params.sort as PostSort) : undefined;

  const [{ items, total, page, pageSize }, categoryTree, tags] = await Promise.all([
    listPosts({
      status,
      keyword: params.keyword,
      categoryId,
      tagId,
      sort,
      page: Number(params.page) || 1,
    }),
    getCategoryTree(),
    listTags(),
  ]);

  const categories = flattenCategoryTree(categoryTree);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // 仅用于空状态文案：带筛选时"还没有文章"是错的，实际是筛不出结果
  const filtered = Boolean(status || params.keyword || categoryId || tagId);

  /** 保留当前筛选、只替换其中一项，用于分页与状态切换的链接 */
  function hrefWith(overrides: Record<string, string | number | undefined>) {
    const query = new URLSearchParams();
    const merged = {
      status,
      keyword: params.keyword,
      categoryId,
      tagId,
      sort,
      page: Number(params.page) || undefined,
      ...overrides,
    };
    for (const [key, value] of Object.entries(merged)) {
      if (value !== undefined && value !== "" && value !== null) {
        query.set(key, String(value));
      }
    }
    const qs = query.toString();
    return qs ? `/admin/posts?${qs}` : "/admin/posts";
  }

  const rows: PostRow[] = items.map((post) => ({
    id: post.id,
    title: post.title,
    slug: post.slug,
    path: buildPostPath(post.slug, post.id),
    categoryName: post.category?.name ?? null,
    status: post.status,
    statusLabel: STATUS_LABELS[post.status],
    statusTone: STATUS_TONES[post.status],
    keywordCount: post.seo?.keywords?.length ?? 0,
    // 时间在服务端格式化：客户端组件里 toLocaleString 会因时区差异导致 hydration 不匹配
    updatedAt: post.updatedAt.toLocaleString("zh-CN"),
    published: post.status === ContentStatus.PUBLISHED,
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="文章"
        description={`共 ${total} 篇`}
        actions={
          <Link href="/admin/posts/new" className={buttonClass("primary")}>
            <Plus size={16} />
            写文章
          </Link>
        }
      />

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* 分段控件：选中项用白底+浮起，未选中透明，靠底色差而非实心黑区分 */}
          <div className="flex items-center gap-0.5 rounded-panel bg-ink-100 p-0.5">
            {STATUS_FILTERS.map((filter) => {
              const active = filter.value === status;
              return (
                <Link
                  key={filter.label}
                  // 切状态时回到第一页：留在第 5 页很可能超出新结果集的范围
                  href={hrefWith({ status: filter.value, page: undefined })}
                  aria-current={active ? "true" : undefined}
                  className={cx(
                    "rounded-[4px] px-3 py-1 text-[13px] transition-colors",
                    active
                      ? "bg-white font-medium text-ink-900 shadow-panel"
                      : "text-ink-500 hover:text-ink-900"
                  )}
                >
                  {filter.label}
                </Link>
              );
            })}
          </div>

          {/* 宽度给在外层容器：Input 自带 w-full，直接传 w-64 覆盖不掉 */}
          <form action="/admin/posts" className="ml-auto">
            {/* 搜索时保留其他筛选条件，否则一搜就把分类标签清空了 */}
            {status && <input type="hidden" name="status" value={status} />}
            {categoryId && <input type="hidden" name="categoryId" value={categoryId} />}
            {tagId && <input type="hidden" name="tagId" value={tagId} />}
            {sort && <input type="hidden" name="sort" value={sort} />}
            <div className="relative w-64">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
              />
              <Input
                type="search"
                name="keyword"
                defaultValue={params.keyword ?? ""}
                placeholder="搜索标题或 slug"
                className="pl-9"
              />
            </div>
          </form>
        </div>

        {/* 分类/标签/排序用原生 select + GET 表单：无需 JS 即可用，也不必为三个下拉引入客户端组件 */}
        <form action="/admin/posts" className="flex flex-wrap items-center gap-2">
          {status && <input type="hidden" name="status" value={status} />}
          {params.keyword && <input type="hidden" name="keyword" value={params.keyword} />}

          {/* 宽度给在外层 div 而非 Select 上：Select 自带 w-full，
              同级传 w-40 谁生效取决于 CSS 生成顺序，结果是三个下拉各占一整行 */}
          <div className="w-40">
            <Select name="categoryId" defaultValue={categoryId ?? ""} aria-label="按分类筛选">
              <option value="">全部分类</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {"　".repeat(c.depth)}
                  {c.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="w-36">
            <Select name="tagId" defaultValue={tagId ?? ""} aria-label="按标签筛选">
              <option value="">全部标签</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="w-32">
            <Select name="sort" defaultValue={sort ?? "updated_desc"} aria-label="排序方式">
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>

          <button type="submit" className={buttonClass("secondary", "sm")}>
            应用
          </button>

          {filtered && (
            <Link href="/admin/posts" className={buttonClass("ghost", "sm")}>
              清除筛选
            </Link>
          )}
        </form>
      </div>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={<FileText size={20} />}
            title={filtered ? "没有匹配的文章" : "还没有文章"}
            description={
              filtered ? "换个筛选条件或关键词再试试。" : "从第一篇开始，写完可以先存草稿。"
            }
            action={
              filtered ? (
                <Link href="/admin/posts" className={buttonClass("secondary", "sm")}>
                  清除筛选
                </Link>
              ) : (
                <Link href="/admin/posts/new" className={buttonClass("primary", "sm")}>
                  <Plus size={16} />
                  写第一篇文章
                </Link>
              )
            }
          />
        ) : (
          <PostBulkTable rows={rows} />
        )}
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 text-[13px]">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              href={hrefWith({ page: p })}
              aria-current={p === page ? "page" : undefined}
              className={cx(
                "flex h-8 min-w-8 items-center justify-center rounded-panel px-2 tabular-nums transition-colors",
                p === page
                  ? "bg-accent-600 font-medium text-white"
                  : "border border-ink-200 bg-white text-ink-600 hover:border-ink-300 hover:bg-ink-50 hover:text-ink-900"
              )}
            >
              {p}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
