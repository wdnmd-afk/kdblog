"use client";

import { useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  Baseline,
  Bold,
  Check,
  Code,
  Highlighter,
  Italic,
  Link2,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Underline as UnderlineIcon,
  Unlink,
  type LucideIcon,
} from "lucide-react";

import { cx } from "@/components/ui";
import {
  CALLOUT_TONE_LABEL,
  CALLOUT_TONES,
  type CalloutTone,
} from "@/lib/tiptap/callout-tone";

import { ColorPicker } from "./color-picker";

/**
 * 选中文本后就近浮出的格式菜单。
 *
 * 存在的理由：正文可能写得很长，鼠标移到顶部工具栏再回来会打断写作节奏。
 * 与工具栏的分工是「高频行内格式走浮动菜单，块级结构走工具栏」。
 * 文字对齐属于块级属性，放在工具栏而非这里。
 *
 * 提示块的语气切换挂在这里：它需要「光标在提示块内」的上下文，
 * 而气泡菜单天然知道光标位置。为它单独做一个块内浮层（NodeView）
 * 会把 React 组件挂进 sharedExtensions 的依赖链，代价不成比例。
 *
 * 用 @tiptap/react 内置的 BubbleMenu（3.x 起随主包提供），不额外装
 * @tiptap/extension-bubble-menu。
 */

interface MarkButton {
  key: string;
  label: string;
  icon: LucideIcon;
  isActive: boolean;
  toggle: () => void;
}

export function EditorBubbleMenu({ editor }: { editor: Editor | null }) {
  const [linkOpen, setLinkOpen] = useState(false);

  /**
   * 订阅编辑器状态。
   *
   * 不用 editor.isActive 直接读：那些方法不是响应式的，选中区域变化后
   * 组件不会重渲染，按钮高亮会停在旧状态。useEditorState 把状态变化接进 React。
   */
  const marks = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null;
      return {
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        underline: e.isActive("underline"),
        strike: e.isActive("strike"),
        code: e.isActive("code"),
        subscript: e.isActive("subscript"),
        superscript: e.isActive("superscript"),
        link: e.isActive("link"),
        linkHref: (e.getAttributes("link").href as string | undefined) ?? "",
        // 色值为空串表示当前选区没有设过该样式，色板据此不打勾
        color: (e.getAttributes("textStyle").color as string | undefined) ?? "",
        backgroundColor:
          (e.getAttributes("textStyle").backgroundColor as string | undefined) ?? "",
        // 光标不在提示块内时为 null，据此决定是否渲染语气切换
        calloutTone: e.isActive("callout")
          ? ((e.getAttributes("callout").tone as CalloutTone | undefined) ?? null)
          : null,
      };
    },
  });

  if (!editor || !marks) return null;

  const buttons: MarkButton[] = [
    {
      key: "bold",
      label: "加粗",
      icon: Bold,
      isActive: marks.bold,
      toggle: () => editor.chain().focus().toggleBold().run(),
    },
    {
      key: "italic",
      label: "斜体",
      icon: Italic,
      isActive: marks.italic,
      toggle: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      key: "underline",
      label: "下划线",
      icon: UnderlineIcon,
      isActive: marks.underline,
      toggle: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      key: "strike",
      label: "删除线",
      icon: Strikethrough,
      isActive: marks.strike,
      toggle: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      key: "code",
      label: "行内代码",
      icon: Code,
      isActive: marks.code,
      toggle: () => editor.chain().focus().toggleCode().run(),
    },
    {
      key: "subscript",
      label: "下标",
      icon: SubscriptIcon,
      isActive: marks.subscript,
      toggle: () => editor.chain().focus().toggleSubscript().run(),
    },
    {
      key: "superscript",
      label: "上标",
      icon: SuperscriptIcon,
      isActive: marks.superscript,
      toggle: () => editor.chain().focus().toggleSuperscript().run(),
    },
  ];

  return (
    <BubbleMenu
      editor={editor}
      /**
       * 只在选中非空文本时出现。光标折叠（未选中）时若也弹出，
       * 会一直悬在正在输入的那一行上，干扰阅读。
       */
      shouldShow={({ editor: e, from, to }) => {
        if (!e.isEditable) return false;
        if (from === to) return false;
        // 代码块内的内容不做行内格式，弹出菜单只会让人误以为可用
        if (e.isActive("codeBlock")) return false;
        return true;
      }}
      options={{ placement: "top", offset: 8 }}
      className="z-dropdown"
    >
      {linkOpen ? (
        /**
         * key 用当前链接地址：选中区域变化时 href 随之变化，React 会重建这个
         * 子组件，输入框里的旧地址自动清空，不必再写一个 effect 去同步。
         */
        <LinkEditor
          key={marks.linkHref}
          initialValue={marks.linkHref}
          onSubmit={(href) => {
            // extendMarkRange 让已存在的链接整体更新，而不是在链接内再套一层
            const chain = editor.chain().focus().extendMarkRange("link");
            if (href === "") {
              chain.unsetLink().run();
            } else {
              chain.setLink({ href }).run();
            }
            setLinkOpen(false);
          }}
          onCancel={() => setLinkOpen(false)}
        />
      ) : (
        <div className="flex items-center gap-0.5 rounded-card border border-ink-200 bg-white p-1 shadow-popover">
          {buttons.map((b) => {
            const Icon = b.icon;
            return (
              <button
                key={b.key}
                type="button"
                title={b.label}
                aria-label={b.label}
                aria-pressed={b.isActive}
                // preventDefault 保住编辑器里的选区：一旦失焦，选区消失，
                // chain().focus() 就会作用在错误的位置上
                onMouseDown={(e) => e.preventDefault()}
                onClick={b.toggle}
                className={cx(
                  "flex h-7 w-7 cursor-pointer items-center justify-center rounded-panel transition-colors",
                  b.isActive
                    ? "bg-ink-100 text-ink-900"
                    : "text-ink-600 hover:bg-ink-100 hover:text-ink-900"
                )}
              >
                <Icon size={15} />
              </button>
            );
          })}

          <span className="mx-0.5 h-4 w-px bg-ink-200" />

          {/* 文字颜色 */}
          <ColorPicker
            kind="text"
            activeValue={marks.color}
            onPick={(color) => {
              const chain = editor.chain().focus();
              // 空串来自色板的「清除」，语义是 unset 而非设成空色值
              if (color === "") chain.unsetColor().run();
              else chain.setColor(color).run();
            }}
            trigger={({ open, toggle }) => (
              <ColorTrigger
                label="文字颜色"
                icon={Baseline}
                active={Boolean(marks.color)}
                open={open}
                onClick={toggle}
                // 用当前文字色画下划线，让按钮本身显示当前状态
                accent={marks.color || undefined}
              />
            )}
          />

          {/* 背景高亮 */}
          <ColorPicker
            kind="highlight"
            activeValue={marks.backgroundColor}
            onPick={(color) => {
              const chain = editor.chain().focus();
              if (color === "") chain.unsetBackgroundColor().run();
              else chain.setBackgroundColor(color).run();
            }}
            trigger={({ open, toggle }) => (
              <ColorTrigger
                label="背景高亮"
                icon={Highlighter}
                active={Boolean(marks.backgroundColor)}
                open={open}
                onClick={toggle}
                accent={marks.backgroundColor || undefined}
              />
            )}
          />

          <span className="mx-0.5 h-4 w-px bg-ink-200" />

          {marks.calloutTone && (
            <>
              {/* 提示块语气切换。只在光标位于提示块内时出现 */}
              <div className="flex items-center gap-0.5" role="group" aria-label="提示块语气">
                {CALLOUT_TONES.map((tone) => (
                  <button
                    key={tone}
                    type="button"
                    title={`切换为${CALLOUT_TONE_LABEL[tone]}`}
                    aria-label={`切换为${CALLOUT_TONE_LABEL[tone]}`}
                    aria-pressed={marks.calloutTone === tone}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => editor.chain().focus().setCalloutTone(tone).run()}
                    className={cx(
                      "h-7 cursor-pointer rounded-panel px-1.5 text-xs transition-colors",
                      marks.calloutTone === tone
                        ? "bg-ink-100 font-medium text-ink-900"
                        : "text-ink-500 hover:bg-ink-100 hover:text-ink-900"
                    )}
                  >
                    {CALLOUT_TONE_LABEL[tone]}
                  </button>
                ))}
              </div>
              <span className="mx-0.5 h-4 w-px bg-ink-200" />
            </>
          )}

          {marks.link && (
            <button
              type="button"
              title="移除链接"
              aria-label="移除链接"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().extendMarkRange("link").unsetLink().run()}
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-panel text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900"
            >
              <Unlink size={15} />
            </button>
          )}

          <button
            type="button"
            title="链接"
            aria-label="链接"
            aria-pressed={marks.link}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setLinkOpen(true)}
            className={cx(
              "flex h-7 w-7 cursor-pointer items-center justify-center rounded-panel transition-colors",
              marks.link
                ? "bg-ink-100 text-ink-900"
                : "text-ink-600 hover:bg-ink-100 hover:text-ink-900"
            )}
          >
            <Link2 size={15} />
          </button>
        </div>
      )}
    </BubbleMenu>
  );
}

/**
 * 色板触发按钮。
 *
 * 独立出来是因为两个色板（文字色、背景色）的按钮只差图标与当前色，
 * 内联写两遍会让气泡菜单的主体被样式串淹没。
 *
 * accent 用当前色给图标加一条底边：色板按钮若不显示当前状态，
 * 用户无法判断这段文字到底有没有设过颜色。
 */
function ColorTrigger({
  label,
  icon: Icon,
  active,
  open,
  onClick,
  accent,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  open: boolean;
  onClick: () => void;
  accent?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      aria-expanded={open}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cx(
        "flex h-7 w-7 cursor-pointer items-center justify-center rounded-panel transition-colors",
        active || open
          ? "bg-ink-100 text-ink-900"
          : "text-ink-600 hover:bg-ink-100 hover:text-ink-900"
      )}
    >
      <span className="flex flex-col items-center">
        <Icon size={15} />
        {accent && (
          <span
            aria-hidden="true"
            className="-mt-0.5 h-[3px] w-3.5 rounded-full"
            style={{ backgroundColor: accent }}
          />
        )}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// 链接编辑
// ---------------------------------------------------------------------------

/**
 * 链接地址输入。
 *
 * 独立成组件而非内联在 EditorBubbleMenu 里，是为了用 key 换到状态重置：
 * 选中区域一变，父组件传入的 initialValue 就变，React 会重建这个组件，
 * 输入框自然清空。内联写法只能靠 effect 监听 href 变化再 setState，
 * 那正是 React 明确不建议的用法。
 *
 * 打开即聚焦用 ref 回调而不是 useEffect：回调在元素挂载时就会执行，
 * 不需要额外一次渲染。
 */
function LinkEditor({
  initialValue,
  onSubmit,
  onCancel,
}: {
  initialValue: string;
  onSubmit: (href: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);

  return (
    <div className="flex items-center gap-1 rounded-card border border-ink-200 bg-white p-1 shadow-popover">
      <input
        ref={(el) => el?.focus()}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit(value.trim());
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder="https://"
        aria-label="链接地址"
        className="h-7 w-56 rounded-panel border border-ink-200 px-2 text-sm focus:border-ink-900 focus:outline-none"
      />
      <button
        type="button"
        // 空值等于移除链接，省得用户先点「移除链接」再确认
        title={value.trim() === "" ? "移除链接" : "确定"}
        aria-label={value.trim() === "" ? "移除链接" : "确定"}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onSubmit(value.trim())}
        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-panel text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900"
      >
        <Check size={15} />
      </button>
    </div>
  );
}
