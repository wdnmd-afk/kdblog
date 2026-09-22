import Link from "next/link";
import { ArrowLeft, FileQuestion } from "lucide-react";

/**
 * 根级 404 兜底。
 *
 * 与 (site)/not-found.tsx 的分工：那个处理前台内部的 notFound()（文章不存在、
 * slug 不匹配解析失败等），这个处理**完全匹配不上任何路由**的地址。
 * 后者不会渲染任何 route group 的布局，因此必须自备完整的页面骨架。
 *
 * 不套用后台侧栏：访问一个不存在的地址时，用户未必处于登录态，
 * 渲染鉴权相关的导航只会产生一次多余的跳转。
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="border-b border-ink-200">
        <div className="mx-auto flex max-w-2xl items-center px-5 py-6 sm:px-6">
          <Link
            href="/"
            className="text-lg font-semibold tracking-tight text-ink-900"
          >
            {process.env.NEXT_PUBLIC_SITE_NAME ?? "kdblog"}
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-5 py-20 sm:px-6">
        <FileQuestion size={28} strokeWidth={1.5} className="text-ink-300" />
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-ink-900">
          页面不存在
        </h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-500">
          这个地址没有对应的内容。检查一下链接是否完整，或者回到首页重新找。
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
    </div>
  );
}
