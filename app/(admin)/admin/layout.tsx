import { redirect } from "next/navigation";
import { LogOut, Search } from "lucide-react";

import { getVerifiedAdmin, signOut } from "@/lib/auth";
import { AdminNav } from "./AdminNav";
import { FeedbackProvider } from "@/components/feedback";

/**
 * 后台统一外壳。
 *
 * 鉴权在这里做一次，用于把未登录访客挡在页面导航之外；但这**不能**替代
 * 每个 Server Action 内部的 requireAdmin()——布局只在渲染页面时执行，
 * 拦不住对 action 的直接 POST 调用。
 *
 * 布局要点：
 *
 * 1. 侧栏用 border-r 而非阴影分层。紧凑密度下阴影会在侧栏边缘糊出一片灰，
 *    一条 1px 硬线更利落，也让"侧栏 / 内容区"的边界在扫视时更明确。
 * 2. 内容区是 flex 列且带 min-h-0，子页面因此可以用 flex-1 撑满剩余高度。
 *    编辑器页需要占满视口，靠这个而非 calc(100vh - 某个猜的值)——后者只要
 *    页脚或内边距一改就会多出一条滚动条。
 * 3. 侧栏 fixed 而非 sticky：侧栏自身要能独立滚动，长导航滚动时不牵动主内容。
 */

/**
 * 后台整体允许阻塞渲染。
 *
 * 开启 cacheComponents 后，Next 要求每个路由段要么可预渲染、要么显式声明允许阻塞。
 * 后台的每个页面都必须读会话与最新数据，既不能进静态外壳也不该被缓存，
 * 因此在壳层统一声明一次，覆盖其下所有管理页面。
 */
export const instant = false;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getVerifiedAdmin();
  if (!user) {
    redirect("/login");
  }

  const displayName = user.name ?? user.email ?? "管理员";

  return (
    <div className="flex min-h-screen bg-ink-50">
      {/* 窄屏隐藏侧栏：当前没有抽屉式移动导航，占满半屏反而挡内容 */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-ink-200 bg-white md:flex">
        {/* 品牌区高度与内容区顶栏对齐（48px），两侧的第一条横线因此连成一条 */}
        <div className="flex h-12 flex-none items-center gap-2 border-b border-ink-200 px-4">
          <span className="flex size-6 items-center justify-center rounded-panel bg-ink-900 text-xs font-bold text-white">
            k
          </span>
          <span className="text-sm font-semibold tracking-tight text-ink-900">kdblog</span>
        </div>

        {/* 侧栏搜索直接提交到文章列表：后台内容量以文章为主，
            不做跨模块全局搜索，避免一个只有一处结果的搜索框 */}
        <div className="flex-none px-2 pt-2">
          <form action="/admin/posts" className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400"
            />
            <input
              type="search"
              name="keyword"
              placeholder="搜索文章"
              aria-label="搜索文章"
              className="h-8 w-full rounded-panel bg-ink-100 pl-8 pr-2.5 text-[13px] text-ink-900 transition-colors placeholder:text-ink-400 hover:bg-ink-200/70 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent-500/35"
            />
          </form>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <AdminNav />
        </div>

        <div className="flex-none border-t border-ink-200 p-2">
          <div className="flex items-center gap-2 rounded-panel px-1.5 py-1.5">
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink-100 text-[11px] font-semibold uppercase text-ink-600"
            >
              {displayName[0]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium leading-tight text-ink-900">
                {displayName}
              </p>
              <p className="truncate text-[11px] leading-tight text-ink-500">
                {user.email}
              </p>
            </div>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button
                type="submit"
                aria-label="退出登录"
                className="flex size-7 cursor-pointer items-center justify-center rounded-panel text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/35"
              >
                <LogOut size={15} />
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* min-w-0 让内容区可以收缩：缺了它，宽表格会把整个布局撑出横向滚动 */}
      <div className="flex min-h-screen w-full min-w-0 flex-col md:pl-60">
        <FeedbackProvider>
          {/* min-h-0 是编辑器能用 flex-1 撑满高度的前提 */}
          <main className="flex min-h-0 flex-1 flex-col px-5 py-5 lg:px-7">{children}</main>
        </FeedbackProvider>
      </div>
    </div>
  );
}
