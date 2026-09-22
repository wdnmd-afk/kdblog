"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";

/**
 * 本地草稿保护。
 *
 * 只写 localStorage，不静默落数据库。原因是 kdblog 的 saveDraft 会重写 contentHtml：
 * 若文章已发布，静默保存等于把写到一半的内容直接推到线上。
 * halo 对此的处理是保存前判断文章状态，这里选择更保守的做法——
 * 本地永远兜底，落库始终由用户显式触发。
 */

const STORAGE_PREFIX = "kdblog:post-draft:";
/** 输入停顿多久后写入本地。太短会频繁写盘，太长则崩溃时丢字 */
const DEBOUNCE_MS = 800;

export interface LocalDraft {
  title: string;
  contentJson: JSONContent;
  /** ISO 字符串，展示时由调用方格式化 */
  savedAt: string;
}

function storageKey(postId: number | undefined): string {
  return `${STORAGE_PREFIX}${postId ?? "new"}`;
}

/**
 * 读本地草稿。
 *
 * 解析失败一律当作没有草稿：localStorage 里的内容可能被旧版本写入过、
 * 也可能被用户手动改坏，为一条坏数据让编辑器打不开是不划算的。
 */
function readDraft(postId: number | undefined): LocalDraft | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(storageKey(postId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<LocalDraft>;
    if (
      typeof parsed.title !== "string" ||
      typeof parsed.savedAt !== "string" ||
      !parsed.contentJson
    ) {
      return null;
    }

    return {
      title: parsed.title,
      contentJson: parsed.contentJson as JSONContent,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

/**
 * 本地草稿读写。
 *
 * @param postId 文章 id；新建文章传 undefined
 * @param snapshot 取当前内容的函数。用函数而非值，避免每次输入都重建定时器
 * @param enabled 关闭时停止写入（如正在加载服务端内容）
 */
export function useLocalDraft(
  postId: number | undefined,
  snapshot: () => { title: string; contentJson: JSONContent },
  enabled: boolean
) {
  /**
   * 初始值用惰性初始化读一次 localStorage。
   *
   * 不能在 useEffect 里读后 setState：那样首帧渲染的是空编辑器，
   * 用户会看到内容「闪」一下再出现。localStorage 是同步 API，
   * 惰性初始化里读不会造成明显的首屏阻塞。
   */
  const [draft, setDraft] = useState<LocalDraft | null>(() => readDraft(postId));

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * 写入本地。
   *
   * 直接从闭包读 snapshot，不经过 ref 中转：snapshot 由调用方 useCallback 持有，
   * 依赖变化时本函数会重建，因此总是最新的。用 ref 反而要求在渲染期赋值，
   * 那是 React Compiler 明确禁止的副作用。
   */
  const write = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      const { title, contentJson } = snapshot();
      const next: LocalDraft = {
        title,
        contentJson,
        savedAt: new Date().toISOString(),
      };
      window.localStorage.setItem(storageKey(postId), JSON.stringify(next));
    } catch {
      // 隐私模式下 localStorage 可能直接抛错，也可能超出配额。
      // 本地草稿是「有则更好」的保障，写不进去不该打断写作。
    }
  }, [postId, snapshot]);

  /** 内容变化后延迟写入，输入过程中不反复写盘 */
  const schedule = useCallback(() => {
    if (!enabled) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(write, DEBOUNCE_MS);
  }, [enabled, write]);

  /** 立即写入。Ctrl+S 与「保存草稿」成功后调用 */
  const saveNow = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    write();
  }, [write]);

  /** 清除本地草稿。落库成功后调用，避免下次打开又提示「有待恢复的内容」 */
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(storageKey(postId));
    } catch {
      // 同 write：清除失败不影响主流程
    }
    setDraft(null);
  }, [postId]);

  // 卸载时清掉未触发的定时器，避免对已卸载组件写状态
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return { draft, schedule, saveNow, clear };
}

/**
 * 判断本地草稿是否值得提示恢复。
 *
 * 判据是「本地比服务端新」而非「本地存在」：用户正常保存后服务端内容
 * 一定比本地新，此时提示恢复只会让人困惑。
 */
export function shouldOfferRecovery(
  draft: LocalDraft | null,
  serverUpdatedAt: Date | string | undefined
): boolean {
  if (!draft) return false;
  if (!serverUpdatedAt) return true;
  return new Date(draft.savedAt) > new Date(serverUpdatedAt);
}

/** 把 ISO 时间格式化成「今天 14:32」这类可读文案 */
export function formatDraftTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const time = date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) return `今天 ${time}`;
  return `${date.toLocaleDateString("zh-CN")} ${time}`;
}
