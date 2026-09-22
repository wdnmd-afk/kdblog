import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import argon2 from "argon2";

import { prisma } from "@/lib/db";

/**
 * 登录表单校验。
 *
 * 账号字段不强制邮箱格式：单管理员场景下允许用简短用户名（如 admin）登录，
 * 数据库层面 User.email 仍是唯一键，只是不再要求它长得像邮箱。
 *
 * 注意：这里只做格式校验，不暴露"用户不存在"与"密码错误"的区别，避免账号枚举。
 */
const credentialsSchema = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
});

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 7, // 7 天
  },
  pages: {
    // 登录页刻意放在 /login 而非 /admin/login：后者会落进 (admin) 布局的鉴权
    // 重定向范围内，未登录访客会被无限重定向到登录页自身。
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "账号", type: "text" },
        password: { label: "密码", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        const ok = await argon2.verify(user.passwordHash, password);
        if (!ok) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    // 把用户 id 带进 token，服务层需要它写 authorId
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});

export type AdminUser = { id: string; email: string; name: string | null };

/**
 * 取当前会话，并回查数据库确认该用户仍然存在；任一步不成立返回 null。
 *
 * 为什么不能只信 token：session 策略是 JWT，用户 id 只在登录那一刻写进 token，
 * 之后 7 天内不再校验。一旦库被重新 seed（用户 id 变了），旧 cookie 仍带着
 * 已消失的 id 且结构完全合法——鉴权照常放行，直到写入时撞 authorId 外键
 * （P2003），最终只呈现为一句「操作失败，请稍后重试」。
 *
 * 页面层与 action 层共用这一处判定，避免出现「页面进得去、每个操作都失败」
 * 的死角。
 */
export async function getVerifiedAdmin(): Promise<AdminUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const exists = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true },
  });
  if (!exists) return null;

  return session.user as AdminUser;
}

/**
 * Server Action / Route Handler 内的统一鉴权入口。
 *
 * 为什么每个写操作都要单独调用它：middleware 只能拦截页面导航，
 * 拦不住对 Server Action 的直接 POST 调用，所以鉴权必须下沉到每个动作内部。
 */
export async function requireAdmin(): Promise<AdminUser> {
  const user = await getVerifiedAdmin();
  if (!user) {
    throw new Error("UNAUTHORIZED");
  }
  return user;
}
