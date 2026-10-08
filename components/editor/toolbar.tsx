"use client";

import { useRef, useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  Bold,
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ChevronDown,
  Code,
  Heading2,
  Heading3,
  Heading4,
  Image as ImageIcon,
  Info,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  Loader2,
  Minus,
  Quote,
  SquareCode,
  Strikethrough,
  Table,
  Underline as UnderlineIcon,
  type LucideIcon,
} from "lucide-react";

import { Tooltip } from "@/components/overlay";
import { cx } from "@/components/ui";
import { ACCEPTED_IMAGE_TYPES, uploadImage } from "@/lib/upload-image";

import { CodeBlockLanguageMenu } from "./code-block-menu";

/**
 * 编辑器工具栏。
 *
 * 与选中浮出的气泡菜单分工不同：这边放块级结构（标题、列表、引用、代码块、
 * 表格、提示块、折叠块）与需要显式入口的操作（插图），行内格式交给气泡菜单。
 * 保留工具栏而非全靠命令面板，是因为反复插入同类块时点按钮明显更快，
 * 而命令面板需要先想清楚命令名。
 *
 * 按钮高亮走 useEditorState 而非直接读 editor.isActive：后者不是响应式的，
 * 光标移动后组件不重渲染，按钮会停在旧的高亮状态上。
 *
 * 链接与颜色不在这里放入口：它们属于行内格式，气泡菜单已有完整界面，
 * 两处都做会出现「工具栏弹 prompt、气泡菜单用输入框」的不一致。
 */

interface ToolbarItem {
  icon: LucideIcon;
  title: string;
  /** 分组号，相邻组之间画分隔线：标题 / 行内格式 / 对齐 / 块级元素 */
  group: number;
  run: () => void;
  active: boolean;
}

/** 单个图标按钮。定义在组件外，避免每次渲染重建组件类型导致子树重挂载 */
function IconButton({
  icon: Icon,
  title,
  active,
  onClick,
  disabled,
  spin,
}: {
  icon: LucideIcon;
  title: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  /** 上传中让图标转起来。用独立 prop 而非由 disabled 推断，
      否则任何禁用状态的按钮图标都会跟着旋转 */
  spin?: boolean;
}) {
  return (
    <Tooltip label={title}>
      <button
        type="button"
        aria-label={title}
        aria-pressed={active}
        onClick={onClick}
        disabled={disabled}
        className={cx(
          "flex h-8 w-8 items-center justify-center rounded-panel transition-colors disabled:opacity-40",
          active
            ? "bg-ink-100 text-ink-900"
            : "text-ink-500 hover:bg-ink-100 hover:text-ink-800"
        )}
      >
        <Icon size={16} className={spin ? "animate-spin" : undefined} />
      </button>
    </Tooltip>
  );
}
export function EditorToolbar({
  editor,
  onError,
}: {
  editor: Editor | null;
  /** 上传失败的提示出口。工具栏不消费 useFeedback，由调用方决定呈现方式 */
  onError: (message: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null;
      return {
        h2: e.isActive("heading", { level: 2 }),
        h3: e.isActive("heading", { level: 3 }),
        h4: e.isActive("heading", { level: 4 }),
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        underline: e.isActive("underline"),
        strike: e.isActive("strike"),
        code: e.isActive("code"),
        bulletList: e.isActive("bulletList"),
        orderedList: e.isActive("orderedList"),
        taskList: e.isActive("taskList"),
        blockquote: e.isActive("blockquote"),
        codeBlock: e.isActive("codeBlock"),
        callout: e.isActive("callout"),
        details: e.isActive("details"),
        alignLeft: e.isActive({ textAlign: "left" }),
        alignCenter: e.isActive({ textAlign: "center" }),
        alignRight: e.isActive({ textAlign: "right" }),
        alignJustify: e.isActive({ textAlign: "justify" }),
      };
    },
  });

  if (!editor || !state) return null;

  async function handleUpload(file: File) {
    setUploading(true);
    const result = await uploadImage(file);
    setUploading(false);

    // 清空 input，否则连续选同一文件不会触发 change
    if (fileInputRef.current) fileInputRef.current.value = "";

    if (!result.ok) {
      onError(result.msg);
      return;
    }

    editor!
      .chain()
      .focus()
      .setImage({ src: result.data.url, alt: file.name })
      .run();
  }

  const items: ToolbarItem[] = [
    {
      icon: Heading2,
      title: "二级标题",
      group: 1,
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      active: state.h2,
    },
    {
      icon: Heading3,
      title: "三级标题",
      group: 1,
      run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      active: state.h3,
    },
    {
      icon: Heading4,
      title: "四级标题",
      group: 1,
      run: () => editor.chain().focus().toggleHeading({ level: 4 }).run(),
      active: state.h4,
    },
    {
      icon: Bold,
      title: "加粗",
      group: 2,
      run: () => editor.chain().focus().toggleBold().run(),
      active: state.bold,
    },
    {
      icon: Italic,
      title: "斜体",
      group: 2,
      run: () => editor.chain().focus().toggleItalic().run(),
      active: state.italic,
    },
    {
      icon: UnderlineIcon,
      title: "下划线",
      group: 2,
      run: () => editor.chain().focus().toggleUnderline().run(),
      active: state.underline,
    },
    {
      icon: Strikethrough,
      title: "删除线",
      group: 2,
      run: () => editor.chain().focus().toggleStrike().run(),
      active: state.strike,
    },
    {
      icon: Code,
      title: "行内代码",
      group: 2,
      run: () => editor.chain().focus().toggleCode().run(),
      active: state.code,
    },
    {
      icon: AlignLeft,
      title: "左对齐",
      group: 3,
      run: () => editor.chain().focus().setTextAlign("left").run(),
      active: state.alignLeft,
    },
    {
      icon: AlignCenter,
      title: "居中",
      group: 3,
      run: () => editor.chain().focus().setTextAlign("center").run(),
      active: state.alignCenter,
    },
    {
      icon: AlignRight,
      title: "右对齐",
      group: 3,
      run: () => editor.chain().focus().setTextAlign("right").run(),
      active: state.alignRight,
    },
    {
      icon: AlignJustify,
      title: "两端对齐",
      group: 3,
      run: () => editor.chain().focus().setTextAlign("justify").run(),
      active: state.alignJustify,
    },
    {
      icon: List,
      title: "无序列表",
      group: 4,
      run: () => editor.chain().focus().toggleBulletList().run(),
      active: state.bulletList,
    },
    {
      icon: ListOrdered,
      title: "有序列表",
      group: 4,
      run: () => editor.chain().focus().toggleOrderedList().run(),
      active: state.orderedList,
    },
    {
      icon: ListTodo,
      title: "任务清单",
      group: 4,
      run: () => editor.chain().focus().toggleTaskList().run(),
      active: state.taskList,
    },
    {
      icon: Table,
      title: "插入表格",
      group: 4,
      run: () =>
        editor
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
      active: false,
    },
    {
      icon: Quote,
      title: "引用",
      group: 4,
      run: () => editor.chain().focus().toggleBlockquote().run(),
      active: state.blockquote,
    },
    {
      icon: SquareCode,
      title: "代码块",
      group: 4,
      run: () => editor.chain().focus().toggleCodeBlock().run(),
      active: state.codeBlock,
    },
    {
      icon: Info,
      title: "提示块",
      group: 4,
      run: () => editor.chain().focus().toggleCallout().run(),
      active: state.callout,
    },
    {
      icon: ChevronDown,
      title: "折叠块",
      group: 4,
      run: () => editor.chain().focus().setDetails().run(),
      active: state.details,
    },
    {
      icon: Minus,
      title: "分割线",
      group: 4,
      run: () => editor.chain().focus().setHorizontalRule().run(),
      active: false,
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-ink-200 px-2 py-1.5">
      {items.map((item, index) => {
        // 组间插分隔线：标题 / 行内格式 / 块级元素
        const needsDivider = index > 0 && items[index - 1].group !== item.group;
        return (
          <span key={item.title} className="flex items-center">
            {needsDivider && <span className="mx-1 h-5 w-px bg-ink-200" />}
            <IconButton
              icon={item.icon}
              title={item.title}
              active={item.active}
              onClick={item.run}
            />
          </span>
        );
      })}

      {/* 光标在代码块内时才出现，其余时候不占用工具栏宽度 */}
      <CodeBlockLanguageMenu editor={editor} />

      <span className="mx-1 h-5 w-px bg-ink-200" />

      <IconButton
        icon={uploading ? Loader2 : ImageIcon}
        title={uploading ? "上传中…" : "插入图片"}
        disabled={uploading}
        spin={uploading}
        onClick={() => fileInputRef.current?.click()}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleUpload(file);
        }}
      />
    </div>
  );
}
