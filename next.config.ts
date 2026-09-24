import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker 部署用：只输出运行所需的最小依赖集，镜像体积远小于整个 node_modules
  output: "standalone",

  // cacheComponents 是 'use cache' 与 cacheTag/cacheLife 的前置开关。
  // 本项目的前台缓存策略依赖按 tag 精准失效（发布文章只刷该篇），因此必须开启。
  cacheComponents: true,

  images: {
    // 本地上传的图片走 /uploads/**，由 sharp 预生成多尺寸后交给 next/image 输出 srcset
    localPatterns: [{ pathname: "/uploads/**" }],
  },

  // argon2 是原生模块，不能被打进 bundle，只能在服务端外部引入
  serverExternalPackages: ["argon2"],

  /**
   * 根路径跳后台。
   *
   * 前台已不再提供文章列表页，对外只保留文章详情 /posts/{slug}-{id}。
   * 根路径因此没有内容可展示，直接送去后台，省掉一个只为跳转而存在的页面组件。
   *
   * 用 307 而非 308（permanent: false）：/ 将来若要恢复成前台首页，
   * 308 会被浏览器和中间代理长期缓存，改回去时老用户仍被弹进后台。
   */
  async redirects() {
    return [{ source: "/", destination: "/admin", permanent: false }];
  },
};

export default nextConfig;
