import Link from "next/link";
import { ArrowLeft, FileQuestion } from "lucide-react";

/**
 * 前台 404。
 *
 * 放在 (site) 分组内，因此继承该分组的页头与页脚；
 * 未匹配到任何路由的请求由根级 app/not-found.tsx 兜底。
 *
 * 刻意不显示"搜索"或"最近文章"之类的补救入口：当前系统没有站内搜索，
 * 而把用户引向一堆文章不如直接给一条确定的退路（回首页）。
 * 同样地，这里也没有任何通往管理后台的链接。
 */
export default function SiteNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-5 py-20 sm:px-6">
      <FileQuestion size={28} strokeWidth={1.5} className="text-ink-300" />
      <h1 className="mt-5 text-2xl font-semibold tracking-tight text-ink-900">
        页面不存在
      </h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-500">
        这个地址没有对应的内容。可能是链接输错了，或者内容已经被删除。
      </p>

      <div className="mt-7">
        <Link
          href="/"
          className="inline-flex h-9 items-center gap-1.5 rounded-panel bg-ink-900 px-3.5 text-sm font-medium text-white transition-colors hover:bg-ink-800"
        >
          <ArrowLeft size={15} />
          返回首页
        </Link>
      </div>
    </main>
  );
}
