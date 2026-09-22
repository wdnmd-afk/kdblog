import type { MetadataRoute } from "next";

import { getSiteUrl } from "@/lib/url";

/**
 * robots.txt。
 *
 * /admin 与 /api 必须屏蔽：后台页面本身有鉴权，但让爬虫反复请求登录页
 * 会浪费抓取配额，也可能把登录页收录成站内结果。
 * /uploads 允许抓取——图片需要被图片搜索收录。
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api"],
    },
    sitemap: `${getSiteUrl()}/sitemap.xml`,
  };
}
