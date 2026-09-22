import Link from "next/link";

/**
 * 前台外壳。
 *
 * 这一层是「对外站点」与「管理后台」的分界线：
 * (site) 分组下的页面只经由此布局，绝不引用后台的任何入口——
 * 这些页面会被分享出去、被外部站点引用，读者不该顺着链接走进管理界面。
 *
 * 也因此这里不 import 后台的组件（AdminNav 等）：物理上不引用，
 * 就不会因为将来某次改动把后台入口带了进来。
 *
 * 将来要把前台单独部署成站点时，把 (site) 目录整体搬走即可，
 * 后台那边不受影响。
 */

const siteName = process.env.NEXT_PUBLIC_SITE_NAME ?? "kdblog";

/**
 * 版权年份在模块加载时取一次。
 *
 * 不在渲染里调 new Date()：cacheComponents 下这类不确定值会让预渲染失败
 * （每次结果不同，进不了静态外壳）。年份一年一变，进程重启即更新。
 */
const currentYear = new Date().getFullYear();

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="border-b border-ink-200">
        <div className="mx-auto flex max-w-2xl items-center px-5 py-6 sm:px-6">
          <Link
            href="/"
            className="text-lg font-semibold tracking-tight text-ink-900 transition-colors hover:text-ink-700"
          >
            {siteName}
          </Link>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">{children}</div>

      <footer className="border-t border-ink-200">
        <div className="mx-auto max-w-2xl px-5 py-8 text-xs text-ink-400 sm:px-6">
          © {currentYear} {siteName}
        </div>
      </footer>
    </div>
  );
}
