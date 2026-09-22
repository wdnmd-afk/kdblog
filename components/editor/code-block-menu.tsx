"use client";

import { useEditorState, type Editor } from "@tiptap/react";

import { Select } from "@/components/ui";
import { CODE_LANGUAGES, normalizeLanguage } from "@/lib/tiptap/lowlight";

/**
 * 代码块语言选择。
 *
 * 单独成组件而不是塞进气泡菜单：气泡菜单的显示条件是「选中了非空文本」，
 * 而这里要的是「光标在代码块内」，两个条件互斥。混在一起会让 shouldShow
 * 变成一堆或条件，任一处调整都会波及另一处。
 *
 * 语言为空的选项显示为「纯文本」而不是「请选择语言」：
 * 不选语言是合法状态（不高亮），不该看起来像没填完的表单。
 */

const PLAIN_TEXT = "plaintext";

export function CodeBlockLanguageMenu({ editor }: { editor: Editor | null }) {
  /**
   * 订阅当前代码块的语言。
   *
   * 用 useEditorState 而非直接读 editor.getAttributes：后者不是响应式的，
   * 光标在代码块之间移动时组件不会重渲染，下拉框会停在上一块的语言上。
   */
  const language = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return "";
      if (!e.isActive("codeBlock")) return null;
      return (e.getAttributes("codeBlock").language as string | undefined) ?? "";
    },
  });

  // null 表示光标不在代码块内，此时不占用工具栏空间
  if (!editor || language === null || language === undefined) return null;

  // 归一后再匹配：历史内容里可能存着 js / ts 这类别名，
  // 直接拿去比对会选不中任何选项，下拉框显示空白
  const value = normalizeLanguage(language) || PLAIN_TEXT;

  return (
    <span className="ml-1.5 inline-flex items-center gap-1.5">
      <span className="text-[11px] text-ink-400">语言</span>
      <Select
        aria-label="代码块语言"
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          editor
            .chain()
            .focus()
            // 纯文本存空串而非 "plaintext"：语义上等于「没有指定语言」，
            // 服务端高亮也会跳过，不必为一个占位值多跑一次 lowlight
            .updateAttributes("codeBlock", { language: next === PLAIN_TEXT ? "" : next })
            .run();
        }}
        className="h-7 w-36 text-xs"
      >
        {CODE_LANGUAGES.map((lang) => (
          <option key={lang.value} value={lang.value}>
            {lang.label}
          </option>
        ))}
      </Select>
    </span>
  );
}
