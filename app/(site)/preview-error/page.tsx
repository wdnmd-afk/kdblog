import Link from "next/link";
import { ArrowLeft, LinkIcon, Lock } from "lucide-react";

/**
 * 预览链接失效提示页。
 *
 * 为什么不做成 404：预览链接失效有几种原因（过期、签名不符、文章已删），
 * 都回同一个「页面不存在」会让用户以为是地址写错了，而不是链接过期了。
 * 因此这里按原因给出各自的说明与对应的下一步。
 *
 * Route Handler 里不能靠 notFound() 渲染 404 页——它本身就是请求的终点，
 * 返回什么就是什么，所以失效时重定向到这里。
 *
 * 放在 (site) 分组内：这个地址是会被分享出去的（预览链接给未登录的人看），
 * 因此和前台页面一样，不出现任何通往管理后台的入口——拿到链接的人
 * 本来就没有后台权限，给一个点了会跳登录页的按钮只会让人困惑。
 */

/**
 * 没有单独的「链接已过期」分支：令牌过期与签名不符在服务端不做区分，
 * 避免向链接持有者泄露两者的差异。过期这一最可能的原因写在 invalid 的说明里。
 */
const REASONS = {
  invalid: {
    icon: LinkIcon,
    title: "预览链接无效",
    description: "链接不完整或被改动过，无法通过签名校验。",
    hint: "如果是从编辑器复制的，请重新复制一次完整链接——聊天工具常会截断长链接。",
  },
  missing: {
    icon: LinkIcon,
    title: "缺少预览令牌",
    description: "这个地址需要带一个有效的预览令牌才能访问。",
    hint: "完整的预览链接在编辑器的「预览」按钮处生成。",
  },
  notfound: {
    icon: Lock,
    title: "内容不存在",
    description: "这篇内容可能已被删除，因此预览不可用。",
    hint: "如果它刚被彻底删除，则无法恢复。",
  },
} as const;

export type PreviewErrorReason = keyof typeof REASONS;

/**
 * 允许阻塞渲染。
 *
 * 本页读 searchParams（请求态数据），无法进入静态外壳。
 * 预览失效本身就是低频且一次性的路径，不值得为它设计流式降级。
 */
export const instant = false;

export default async function PreviewErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  // URL 参数不可信，回退到 invalid 而不是报错
  const key: PreviewErrorReason =
    reason && reason in REASONS ? (reason as PreviewErrorReason) : "invalid";
  const { icon: Icon, title, description, hint } = REASONS[key];

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-5 py-20 sm:px-6">
      <Icon size={28} strokeWidth={1.5} className="text-ink-300" />
      <h1 className="mt-5 text-2xl font-semibold tracking-tight text-ink-900">{title}</h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-500">{description}</p>
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-ink-400">{hint}</p>

      <div className="mt-7">
        <Link
          href="/"
          className="inline-flex h-9 items-center gap-1.5 rounded-panel border border-ink-300 bg-white px-3.5 text-sm text-ink-800 transition-colors hover:bg-ink-50"
        >
          <ArrowLeft size={15} />
          返回首页
        </Link>
      </div>
    </main>
  );
}
