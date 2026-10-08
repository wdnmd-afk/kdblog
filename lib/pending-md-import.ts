"use client";

/**
 * 列表页上传 Markdown 后，把解析结果交接给新建页。
 *
 * 为什么需要这样一个中转：列表页解析完文件要跳到 /admin/posts/new，
 * 而正文是 Tiptap JSON（几十上百 KB 很常见），塞不进 URL——撞长度限制，
 * 也会被写进浏览器历史。Server Action 只能返回可序列化的值，
 * 同样做不到「把内容带给下一个页面」。
 *
 * 为什么用 sessionStorage 而不是 localStorage：
 * lib/use-local-draft.ts 用 localStorage 是「同一篇文章跨会话继续写」的语义，
 * 必须跨标签页、跨天保留。这里是「一次上传动作的交接」，只在一个标签页内、
 * 几秒内有效。用 localStorage 的话，两个标签页各自上传会互相覆盖。
 *
 * 判断标准：本文件不许出现任何 import。它被客户端组件引用，
 * 一旦引入带依赖的模块就可能把服务端依赖链拖进浏览器包
 * （同 lib/markdown/file.ts 的理由）。
 */

const STORAGE_KEY = "kdblog:pending-md-import";

/** 交接内容。字段与 MarkdownImportResult 的可用子集一致 */
export interface PendingMarkdownImport {
  /** 可直接灌进编辑器的 Tiptap 文档 */
  contentJson: unknown;
  /** frontmatter 解析出的元信息，用于填充新建页的空白字段 */
  meta: {
    title: string | null;
    excerpt: string | null;
    slug: string | null;
    tags: string[];
    keywords: string[];
  };
  /** 原始文件名，用于跳转后的提示文案，让用户确认导入的是哪个文件 */
  fileName: string;
}

/**
 * 暂存待导入内容。
 *
 * 返回是否写入成功。调用方**必须**检查返回值：隐私模式下 sessionStorage
 * 会直接抛错，写不进去却照样跳转的话，用户到了新建页看到一片空白，
 * 会以为上传把内容弄丢了。写失败就留在原页面报错，比静默跳转好。
 */
export function stashPendingMarkdownImport(payload: PendingMarkdownImport): boolean {
  if (typeof window === "undefined") return false;

  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/**
 * 取出并清除待导入内容。
 *
 * 读与删必须是一次动作：只读不删的话，用户下次手动打开写文章页
 * 会被莫名灌进一篇旧内容。解析失败同样要删——坏数据留着只会
 * 在每次打开新建页时重复报错。
 *
 * 因此 finally 里无条件 removeItem，不区分成功与否。
 */
export function takePendingMarkdownImport(): PendingMarkdownImport | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<PendingMarkdownImport>;

    // contentJson 是唯一不可缺的字段，缺了就没有导入的意义
    if (!parsed.contentJson) return null;

    return {
      contentJson: parsed.contentJson,
      // meta 各字段逐个兜底而非整体判断：交接数据由本项目自己写入，
      // 结构是确定的，这里只防「旧版本写入的残留」这一种情况
      meta: {
        title: parsed.meta?.title ?? null,
        excerpt: parsed.meta?.excerpt ?? null,
        slug: parsed.meta?.slug ?? null,
        tags: parsed.meta?.tags ?? [],
        keywords: parsed.meta?.keywords ?? [],
      },
      fileName: parsed.fileName ?? "",
    };
  } catch {
    return null;
  } finally {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // 清除失败不影响主流程：内容已经读到手了
    }
  }
}
