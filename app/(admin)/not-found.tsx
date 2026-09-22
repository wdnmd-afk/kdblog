import Link from "next/link";
import { FileQuestion, LayoutDashboard } from "lucide-react";

/**
 * 后台 404。
 *
 * 放在 (admin) 分组内，因此会渲染在后台外壳里（侧栏仍在），
 * 用户能直接切到别的模块，而不是被丢到一个孤立页面。
 *
 * 后台出现 404 的典型原因是内容被删或 id 不存在，因此文案给出的是
 * 「回到列表」而非「回首页」——用户此刻的上下文在管理后台，不在前台。
 */
export default function AdminNotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <FileQuestion size={28} strokeWidth={1.5} className="text-ink-300" />
      <h1 className="mt-5 text-xl font-semibold tracking-tight text-ink-900">
        内容不存在
      </h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-500">
        这条记录可能已被删除，或者链接里的编号不正确。
      </p>

      <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
        <Link
          href="/admin"
          className="inline-flex h-9 items-center gap-1.5 rounded-panel bg-ink-900 px-3.5 text-sm font-medium text-white transition-colors hover:bg-ink-800"
        >
          <LayoutDashboard size={15} />
          回到仪表盘
        </Link>
        <Link
          href="/admin/posts"
          className="inline-flex h-9 items-center rounded-panel border border-ink-300 bg-white px-3.5 text-sm text-ink-800 transition-colors hover:bg-ink-50"
        >
          查看文章列表
        </Link>
      </div>
    </div>
  );
}
