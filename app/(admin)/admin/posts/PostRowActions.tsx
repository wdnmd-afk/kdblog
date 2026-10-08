"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CloudUpload, Download, EyeOff, ExternalLink, Trash2 } from "lucide-react";

import {
  publishPostsInBatchAction,
  trashPostAction,
  unpublishPostAction,
} from "@/server/actions/post";
import type { ActionResult } from "@/server/actions/types";
import { Button, buttonClass, cx } from "@/components/ui";
import { useFeedback } from "@/components/feedback";
import { downloadPostMarkdown } from "@/lib/markdown/download";

/**
 * 文章列表的行内操作。
 *
 * 拆成客户端组件是因为需要确认对话框与 pending 状态；列表页本身保持为
 * 服务端组件，避免把整张表的数据序列化到客户端。
 *
 * 反馈统一走 useFeedback：原先用 window.alert 报错、window.confirm 做确认，
 * 两者样式不可控且阻塞主线程，在移动端尤其突兀。
 *
 * 按钮位置在行与行之间必须**完全固定**：这一列的图标全部常驻，
 * 状态相关的那个（发布 / 取消发布）靠图标与行为切换，而不是靠显示隐藏。
 * 原先「取消发布」在草稿行上直接消失，导致同一列的删除按钮在不同行里
 * 左右错位，点完取消发布后按钮还会从指针下方消失——下一次点击就落到
 * 已经挪过来的删除按钮上，这是会误删的。
 */
export function PostRowActions({
  id,
  published,
  title,
  path,
}: {
  id: number;
  published: boolean;
  /** 用于确认文案与 Toast，让用户看清操作的是哪一篇 */
  title?: string;
  /** 前台地址。仅已发布文章可用，草稿传空或不传 */
  path?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { toast, confirm } = useFeedback();

  const name = title ? `「${title}」` : "该文章";

  function run(fn: () => Promise<ActionResult>, successText: string) {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        toast(result.msg, "error");
        return;
      }
      toast(successText, "success");
      router.refresh();
    });
  }

  /**
   * 行内发布。
   *
   * 借用批量发布的 action 而非 publishPostAction：后者要求提交完整表单
   * （标题 / 正文 / SEO 全量），列表页手里只有一个 id。批量那条正是为
   * 「按 id 发布已存在的文章」设计的，且它会跳过 SEO 不完整的文章并在
   * msg 里说明原因——这正是这里需要的反馈。
   *
   * 因此即使 ok 为真也要把 msg 展示出来：可能是「已发布 0 篇，
   * 1 篇因 SEO 不完整被跳过」，静默成功会让用户以为发布了。
   */
  function publish() {
    startTransition(async () => {
      const result = await publishPostsInBatchAction([id]);
      toast(result.msg, result.ok ? "success" : "error");
      if (result.ok) router.refresh();
    });
  }

  async function trash() {
    // 软删可还原，因此文案强调「移入回收站」而非「删除」，并说明去哪儿找回
    const ok = await confirm({
      title: `将${name}移入回收站？`,
      description: "前台会立即不可见，可以在回收站还原。",
      confirmLabel: "移入回收站",
      danger: true,
    });
    if (!ok) return;
    run(() => trashPostAction(id), `${name}已移入回收站`);
  }

  /**
   * 导出为 .md 文件。
   *
   * 与编辑器顶栏的导出走同一个端点，但这里不做任何确认：
   * 编辑器那边的确认是为了提醒「编辑器里有未保存的改动」，
   * 而列表读的就是库里已保存的版本，这个前提在这里不存在。
   *
   * 下载辅助方法先检查响应，再读取响应头中的文件名；401/503 等错误直接提示，
   * 不让浏览器把错误正文当作 Markdown 保存。
   */
  function exportMarkdown() {
    startTransition(async () => {
      const result = await downloadPostMarkdown(id);
      if (!result.ok) toast(result.msg, "error");
    });
  }

  return (
    /**
     * 图标按钮靠右对齐，与表头「操作」列的右对齐保持一致。
     *
     * 顺序为「只读 → 写入 → 删除」：查看、导出不改数据放最左，
     * 发布状态切换居中，不可逆的删除永远在最右，避免误点。
     */
    <div className="flex items-center justify-end gap-1">
      {/**
       * 在前台查看。
       *
       * 从标题旁边挪到这里：标题列里它是个 opacity-0、悬停才浮现的图标，
       * 既难发现又与「操作」列的职责重叠。
       *
       * 草稿没有可访问的前台地址（前台会 404），因此不给链接；但用一个
       * 等尺寸的占位保持这一列的按钮在所有行里横向对齐——直接省掉会让
       * 草稿行的其余按钮整体右移，就是这次要修的那类错位。
       */}
      {published && path ? (
        <Link
          href={path}
          target="_blank"
          rel="noopener"
          className={buttonClass("ghost", "sm")}
          title="在新标签查看"
          aria-label={title ? `在新标签查看「${title}」` : "在新标签查看"}
        >
          <ExternalLink size={16} />
        </Link>
      ) : (
        <span
          aria-hidden="true"
          className={cx(buttonClass("ghost", "sm"), "invisible")}
        >
          <ExternalLink size={16} />
        </span>
      )}

      <Button
        variant="ghost"
        size="sm"
        onClick={exportMarkdown}
        disabled={pending}
        title="导出 Markdown"
        // 一行里有多个导出按钮，读屏时靠文章名才能区分点的是哪一篇
        aria-label={title ? `导出「${title}」为 Markdown` : "导出为 Markdown"}
      >
        <Download size={16} />
      </Button>

      {/**
       * 发布状态切换。
       *
       * 按钮**常驻**，只换图标与行为：已发布显示「取消发布」，草稿显示
       * 「发布」。改版前草稿行上这个位置是空的，同一列的删除按钮因此在
       * 不同行左右错位；更糟的是点完取消发布后按钮当即消失，指针下方
       * 换成了删除按钮，连续点两下就会误删。
       */}
      {published ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => run(() => unpublishPostAction(id), `${name}已取消发布`)}
          title="取消发布"
          aria-label={title ? `取消发布「${title}」` : "取消发布"}
        >
          <EyeOff size={16} />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={publish}
          title="发布"
          aria-label={title ? `发布「${title}」` : "发布"}
        >
          <CloudUpload size={16} />
        </Button>
      )}

      <Button
        variant="danger"
        size="sm"
        disabled={pending}
        onClick={trash}
        title="移入回收站"
        aria-label={title ? `将「${title}」移入回收站` : "移入回收站"}
      >
        <Trash2 size={16} />
      </Button>
    </div>
  );
}
