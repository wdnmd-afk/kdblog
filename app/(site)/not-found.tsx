import { FileQuestion } from "lucide-react";

/**
 * 前台 404。
 *
 * 放在 (site) 分组内，因此继承该分组的页脚。
 * 未匹配到任何路由的请求由根级 app/not-found.tsx 兜底。
 *
 * 刻意不给任何「退路」链接：前台只剩文章详情一个路由，没有可回的列表页，
 * 而根路径会跳到后台——把拿到失效文章链接的读者引去登录页只会让人困惑。
 * 同理也没有搜索或「最近文章」（系统本就没有站内搜索）。
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
    </main>
  );
}
