import { handlers } from "@/lib/auth";

/** NextAuth 的登录/登出/会话回调统一由这里承接 */
export const { GET, POST } = handlers;
