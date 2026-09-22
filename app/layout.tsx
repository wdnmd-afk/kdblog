import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

/**
 * 根布局。
 *
 * 字体通过 next/font 自托管（不走 Google CDN 运行时请求），
 * 变量名与 globals.css 的 --font-sans / --font-mono 对应。
 */
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

const siteName = process.env.NEXT_PUBLIC_SITE_NAME ?? "kdblog";

export const metadata: Metadata = {
  // 模板形式：子页面只需给出自己的 title，站名由此统一追加
  title: { default: siteName, template: `%s · ${siteName}` },
  description: "基于 Next.js 的内容管理与发布系统",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // lang 用 zh-CN：内容为中文，错误的 lang 会影响屏幕阅读器与搜索引擎判断
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
