import { draftMode } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { verifyPreviewToken } from "@/lib/preview";
import { buildPostPath } from "@/lib/url";
import { getPostPreview } from "@/server/services/post";

/**
 * 草稿预览入口。
 *
 * 校验 HMAC 令牌后开启 Next 的 draftMode（写入一个 cookie），再重定向到文章页。
 * 文章页检测到 draft 模式就绕过 ISR 直查数据库，因此未发布内容也能看到，
 * 且不会污染正式缓存。
 *
 * 失败时重定向到 /preview-error 而不是直接返回文本：Route Handler 是请求的终点，
 * 返回纯文本的 "Not Found" 会让用户看到一个无样式的白页，且分不清是链接过期
 * 还是文章被删。带上 reason 后由那个页面按原因给出说明。
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    redirect("/preview-error?reason=missing");
  }

  const postId = verifyPreviewToken(token);
  if (postId === null) {
    // 令牌格式错误、签名不符、已过期都归到这里。不细分是为了不向持有者
    // 泄露"签名对了但过期了"这类信息。
    redirect("/preview-error?reason=invalid");
  }

  const post = await getPostPreview(postId);
  if (!post) {
    redirect("/preview-error?reason=notfound");
  }

  const draft = await draftMode();
  draft.enable();

  redirect(buildPostPath(post.slug, post.id));
}
