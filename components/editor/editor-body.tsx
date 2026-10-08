"use client";

import { useState } from "react";
import { EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/core";

import { uploadImage } from "@/lib/upload-image";

/**
 * 正文容器。
 *
 * 职责只有两件：渲染 EditorContent，以及在拖入文件时显示一层投放提示。
 *
 * 实际的粘贴与拖放处理都在 PostEditor 的 editorProps 里（handlePaste /
 * handleDrop），不在这里挂 onPaste / onDrop：ProseMirror 在 contenteditable
 * 自身监听这两个事件，冒泡到这一层时浏览器的默认行为已经执行完毕
 * （图片以 base64 直插，或整页跳转到图片地址），那时再 preventDefault 已经晚了。
 *
 * 这里只留 dragover 用于显示提示：dragover 不产生任何插入行为，
 * 拦截它不会与 ProseMirror 冲突，反而能让浏览器允许 drop。
 */

export function EditorBody({ editor }: { editor: Editor | null }) {
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => {
        // 必须 preventDefault，否则浏览器既不允许 drop，也不会发 drop 事件
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        // 只在真正离开容器时收起提示：从子元素移到另一个子元素也会触发 dragleave
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setDragging(false);
        }
      }}
      onDrop={() => setDragging(false)}
    >
      <EditorContent editor={editor} className="flex-1 overflow-y-auto" />

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-panel border-2 border-dashed border-ink-300 bg-white/80">
          <p className="text-sm text-ink-600">松开即可插入图片</p>
        </div>
      )}
    </div>
  );
}

/** 从剪贴板或拖拽事件里挑出图片文件 */
export function pickImages(list: FileList | null): File[] {
  if (!list) return [];
  return Array.from(list).filter((f) => f.type.startsWith("image/"));
}

/**
 * 上传并插入多张图片。
 *
 * 抽成独立函数而非组件内闭包：粘贴与拖入分处两个 editorProps 回调，
 * 闭包拿不到同一份实现，早晚会分叉。
 */
export async function insertImages(
  editor: Editor,
  files: File[],
  at: number | undefined,
  onError: (message: string) => void
) {
  // 记录插入位置：第一张插到 at，后续依次后移。
  // 若每张都插同一位置，后插的会排到前面，顺序与用户选择相反。
  let pos = at;

  for (const file of files) {
    const result = await uploadImage(file);
    if (!result.ok) {
      onError(result.msg);
      continue;
    }

    const attrs = { src: result.data.url, alt: file.name };

    if (pos === undefined) {
      editor.chain().focus().setImage(attrs).run();
    } else {
      editor.chain().focus().insertContentAt(pos, { type: "image", attrs }).run();
      pos += 1;
    }
  }
}
