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
};

export default nextConfig;
