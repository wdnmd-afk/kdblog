"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FileText,
  FolderTree,
  LayoutDashboard,
  ScrollText,
  Tag,
  Trash2,
} from "lucide-react";

import { cx } from "@/components/ui";

/**
 * 后台侧边栏导航。
 *
 * 单独拆成客户端组件只为拿 usePathname 做当前项高亮——布局本身要 await auth()，
 * 必须留在服务端，两者不能合并。
 *
 * 选中态是强调蓝在全站的三处用法之一：浅蓝底 + 蓝色文字 + 左侧 2px 边条。
 * 只靠底色深浅区分（改版前的做法）在扫视时几乎看不出来，边条才是真正
 * 提供"我在哪"的信号。
 */

const NAV_ITEMS = [
  { href: "/admin", label: "仪表盘", icon: LayoutDashboard },
  { href: "/admin/posts", label: "文章", icon: FileText },
  { href: "/admin/categories", label: "分类", icon: FolderTree },
  { href: "/admin/tags", label: "标签", icon: Tag },
  { href: "/admin/trash", label: "回收站", icon: Trash2 },
  { href: "/admin/logs", label: "系统日志", icon: ScrollText },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="px-2 py-1.5">
      <ul className="space-y-px">
        {NAV_ITEMS.map((item) => {
          // 仪表盘只在精确匹配时高亮，否则任何 /admin/* 子路由都会把它一起点亮
          const active =
            item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  // 左侧 2px 边条用 before 伪元素而非 border-l：后者会让内容整体右移 2px，
                  // 选中/未选中之间产生水平抖动
                  "relative flex h-8 items-center gap-2.5 rounded-panel px-2.5 text-[13px] transition-colors",
                  "before:absolute before:left-0 before:top-1/2 before:h-4 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:transition-colors",
                  active
                    ? "bg-accent-50 font-medium text-accent-700 before:bg-accent-600"
                    : "text-ink-600 before:bg-transparent hover:bg-ink-100 hover:text-ink-900"
                )}
              >
                <Icon
                  size={15}
                  strokeWidth={active ? 2.2 : 1.8}
                  className={active ? "text-accent-600" : "text-ink-400"}
                />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
