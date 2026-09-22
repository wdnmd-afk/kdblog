import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { AlertCircle, User } from "lucide-react";

import { auth, signIn } from "@/lib/auth";
import { Button, Card } from "@/components/ui";
import { PasswordInput } from "./PasswordInput";

/**
 * 管理员登录页。
 *
 * 放在 /login 而不是 /admin/login：后者会落进 (admin) 分组的 layout，
 * 而该 layout 自身带鉴权重定向，未登录访问会形成无限重定向循环。
 */

export const metadata = {
  title: "登录 - kdblog",
  // 登录页不应进入索引
  robots: { index: false, follow: false },
};

// 登录页要读 session 判断是否已登录，属于请求态数据，无法预渲染进静态外壳
export const instant = false;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; redirectTo?: string }>;
}) {
  const session = await auth();
  if (session?.user?.id) {
    redirect("/admin/posts");
  }

  const { error, redirectTo } = await searchParams;

  async function loginAction(formData: FormData) {
    "use server";

    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const target = String(formData.get("redirectTo") ?? "") || "/admin/posts";

    try {
      await signIn("credentials", { email, password, redirectTo: target });
    } catch (err) {
      // signIn 成功时会抛出 NEXT_REDIRECT，必须原样放行，否则跳转会被吞掉
      if (err instanceof AuthError) {
        redirect(`/login?error=1${target ? `&redirectTo=${encodeURIComponent(target)}` : ""}`);
      }
      throw err;
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4">
      <Card className="w-full max-w-sm px-8 py-10">
        <div className="mb-7 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">欢迎回来</h1>
          <p className="mt-1.5 text-xs text-ink-500">请使用你的用户名登录</p>
        </div>

        {error ? (
          <p className="mb-4 flex items-start gap-2 rounded-panel border border-ink-300 bg-ink-50 px-3 py-2 text-xs text-ink-900">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            账号或密码不正确
          </p>
        ) : null}

        <form action={loginAction} className="space-y-3">
          <input type="hidden" name="redirectTo" value={redirectTo ?? ""} />

          {/* 图标做前缀而非 label：登录表单字段含义无歧义，省掉标签让版面更静 */}
          <div className="relative">
            <User
              size={16}
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
            />
            <input
              id="email"
              name="email"
              type="text"
              required
              autoComplete="username"
              placeholder="用户名"
              aria-label="用户名"
              className="h-11 w-full rounded-panel border border-ink-200 bg-white pl-9 pr-3 text-sm text-ink-900 transition-colors placeholder:text-ink-400 hover:border-ink-300 focus:border-ink-900 focus:outline-none"
            />
          </div>

          <PasswordInput />

          <Button type="submit" variant="primary" className="mt-1 h-11 w-full rounded-panel">
            登录
          </Button>
        </form>
      </Card>
    </main>
  );
}
