"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import {
  ChevronDown,
  Heading2,
  Heading3,
  Heading4,
  Image as ImageIcon,
  Info,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Pilcrow,
  Quote,
  SquareCode,
  Table,
  type LucideIcon,
} from "lucide-react";

import { cx } from "@/components/ui";
import { ACCEPTED_IMAGE_TYPES, uploadImage } from "@/lib/upload-image";
import {
  filterItemsByTrigger,
  getSlashMenuState,
  slashCommandItems,
  slashCommandPluginKey,
  TRIGGER_LABEL,
  type EditorIconName,
  type SlashMenuItem,
} from "@/lib/tiptap/slash-command";

/**
 * 命令面板（斜杠与井号两个触发字符共用）。
 *
 * 只负责渲染与定位，触发、过滤、键盘导航都在 lib/tiptap/slash-command.ts 的
 * ProseMirror 插件里完成。这样的分工让键盘事件在插件层就被处理掉——
 * 若改由 React 监听 keydown，输入法与编辑器的键盘处理会互相抢占。
 *
 * 位置不走 React state 而是直接改 DOM style：坐标需要跟随滚动实时更新，
 * 每次滚动都触发一轮 setState + 重渲染并不划算，而且会与「选中项变化」
 * 引起的重渲染互相打断。
 */

/** 图标名到组件的映射。扩展层只给字符串，避免把 React 依赖带进插件 */
const ICONS: Record<EditorIconName, LucideIcon> = {
  pilcrow: Pilcrow,
  heading2: Heading2,
  heading3: Heading3,
  heading4: Heading4,
  list: List,
  listOrdered: ListOrdered,
  listTodo: ListTodo,
  quote: Quote,
  squareCode: SquareCode,
  table: Table,
  image: ImageIcon,
  minus: Minus,
  info: Info,
  chevronDown: ChevronDown,
};

const MENU_WIDTH = 300;
const MENU_MAX_HEIGHT = 340;
/** 与视口边缘的最小间距 */
const EDGE_GAP = 12;

/**
 * 分组顺序。
 *
 * 不按命令数组的先后推：数组里为了可读性把同类命令放在一起，
 * 与面板上的展示顺序未必一致。显式列出顺序，往数组里插命令时
 * 不必再回头调整它的位置。
 */
const GROUP_ORDER = ["基础块", "列表", "插入"];

/** 按分组归拢命令，组内保持命令数组的原始顺序 */
function groupItems(items: SlashMenuItem[]): { group: string; items: SlashMenuItem[] }[] {
  const buckets = new Map<string, SlashMenuItem[]>();

  for (const item of items) {
    const bucket = buckets.get(item.group);
    if (bucket) bucket.push(item);
    else buckets.set(item.group, [item]);
  }

  return GROUP_ORDER.filter((group) => buckets.has(group)).map((group) => ({
    group,
    items: buckets.get(group)!,
  }));
}

export function SlashMenu({
  editor,
  onError,
}: {
  editor: Editor | null;
  /**
   * 上传失败的提示出口，由调用方决定呈现方式。
   *
   * 图片的文件选择框由面板自带（见下方 input），不需要调用方提供回调：
   * 工具栏那个 input 在另一个组件里，跨组件传一个"点它"的回调只是绕路，
   * 真正需要共用的是上传逻辑，而那已经在 lib/upload-image.ts 里了。
   */
  onError?: (message: string) => void;
}) {
  const [state, setState] = useState(() => getSlashMenuState(editor));
  const menuRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 订阅编辑器事务：菜单的开关、过滤词、高亮项都由插件状态驱动
  useEffect(() => {
    if (!editor) return;

    const update = () => setState(getSlashMenuState(editor));
    editor.on("transaction", update);

    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);

  const open = Boolean(editor && state?.open && state.range);
  const from = state?.from ?? 0;

  /**
   * 定位。
   *
   * useLayoutEffect 而非 useEffect：在浏览器绘制前写完坐标，
   * 否则菜单会先在默认位置闪现一帧再跳到光标处。
   */
  useLayoutEffect(() => {
    if (!editor || !open) return;

    const place = () => {
      const el = menuRef.current;
      if (!el) return;

      // coordsAtPos 给出视口坐标，菜单用 fixed 定位，两者坐标系一致
      const coords = editor.view.coordsAtPos(from);

      // 下方空间不够时翻到光标上方，避免菜单被视口裁掉
      const spaceBelow = window.innerHeight - coords.bottom;
      const openUpward = spaceBelow < MENU_MAX_HEIGHT + EDGE_GAP;

      const left = Math.max(
        EDGE_GAP,
        Math.min(coords.left, window.innerWidth - MENU_WIDTH - EDGE_GAP)
      );

      el.style.left = `${left}px`;
      el.style.top = `${openUpward ? coords.top - MENU_MAX_HEIGHT - 8 : coords.bottom + 8}px`;
    };

    place();

    // capture 阶段监听：编辑区自身的滚动容器也能捕获到，滚动时菜单跟着光标走
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [editor, open, from, state?.query]);

  if (!editor || !open || !state) return null;

  // 从这里往下 editor 已是非空，闭包里不必再断言
  const activeEditor = editor;
  const current = state;
  const range = current.range!;

  const filtered = filterItemsByTrigger(slashCommandItems, current.trigger, current.query)
    // 没有错误出口时藏掉图片项：上传失败会静默无反应，不如不显示
    .filter((item) => item.kind !== "action" || onError);

  // 过滤词无匹配时收起面板（"#" 后接非数字即走这条路径）
  if (filtered.length === 0) return null;

  /**
   * 展开后的展示顺序，以及每一项在其中的下标。
   *
   * groupItems 只做归拢与组间重排，组内保持 filtered 的原始相对顺序，
   * 因此这份下标与插件层 filterItemsByTrigger 的返回值一一对应——
   * 键盘导航的高亮项与面板上的高亮项才不会错位。
   *
   * 先算成映射表再渲染：分组后组内的局部下标与全局下标不等，
   * 在渲染里现算容易算错，也让 JSX 里多一层与展示无关的推导。
   */
  const groups = groupItems(filtered);
  const flat = groups.flatMap((g) => g.items);
  const indexOfItem = new Map(flat.map((item, index) => [item, index]));
  const activeIndex = Math.min(current.selected, flat.length - 1);

  /** 关掉面板并清掉已输入的触发符与查询词 */
  function closeAndClear() {
    const { state: editorState, view } = activeEditor;
    view.dispatch(
      editorState.tr.delete(range.from, range.to).setMeta(slashCommandPluginKey, "close")
    );
    activeEditor.commands.focus();
  }

  /**
   * 上传并插入选中的图片。
   *
   * 插到当前光标处而非命令面板的 range：触发符已经被删掉，
   * range 的位置就是用户期望图片落下的地方。
   */
  async function handleFile(file: File) {
    const result = await uploadImage(file);
    if (!result.ok) {
      onError?.(result.error);
      return;
    }

    activeEditor
      .chain()
      .focus()
      .setImage({ src: result.data.url, alt: file.name })
      .run();
  }

  /** 选中的命令若是 action 类，交给 UI 层处理；返回是否已处理 */
  function runAction(item: SlashMenuItem): boolean {
    if (item.kind !== "action") return false;

    if (item.icon === "image") {
      // 先把触发符与查询词删掉再打开文件框：否则用户取消选择后，
      // 正文里会留下一个 "/图片" 的残迹
      closeAndClear();
      fileRef.current?.click();
      return true;
    }

    return false;
  }

  return (
    <>
      <div
        ref={menuRef}
        role="listbox"
        aria-label={TRIGGER_LABEL[current.trigger]}
        style={{ width: MENU_WIDTH, maxHeight: MENU_MAX_HEIGHT }}
        className="fixed z-dropdown overflow-y-auto rounded-card border border-ink-200 bg-white py-1 shadow-popover"
      >
        <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-400">
          {TRIGGER_LABEL[current.trigger]}
        </div>

        {groups.map((group, groupIndex) => (
          <div key={group.group}>
            {groupIndex > 0 && <div className="my-1 h-px bg-ink-200" />}

            <div className="px-2.5 py-1 text-[11px] font-medium text-ink-400">
              {group.group}
            </div>

            {group.items.map((item) => {
              const active = indexOfItem.get(item) === activeIndex;
              const Icon = ICONS[item.icon] ?? Pilcrow;

              return (
                <button
                  key={item.title}
                  type="button"
                  role="option"
                  aria-selected={active}
                  // 用 mousedown 而非 click：click 触发前输入框会先失焦，
                  // 编辑器随之收起选择，命令作用的位置就错了
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (runAction(item)) return;
                    item.run?.({ editor, range });
                  }}
                  className={cx(
                    "flex w-full cursor-pointer items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors",
                    active ? "bg-ink-100" : "hover:bg-ink-50"
                  )}
                >
                  <span
                    className={cx(
                      "flex size-7 shrink-0 items-center justify-center rounded-panel border",
                      active
                        ? "border-ink-300 bg-white text-ink-900"
                        : "border-ink-200 text-ink-500"
                    )}
                  >
                    <Icon size={15} />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm text-ink-900">{item.title}</span>
                      {item.shortcut && (
                        <kbd className="shrink-0 rounded border border-ink-200 bg-ink-50 px-1 font-mono text-[10px] leading-4 text-ink-500">
                          {item.shortcut}
                        </kbd>
                      )}
                    </span>
                    <span className="block truncate text-xs text-ink-500">
                      {item.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/*
        图片上传的文件选择框。
        放在面板之外而不是面板里：面板在查询词无匹配时会整体卸载，
        而这个 input 需要在用户取消选择后依然可用。
      */}
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // 清空 input，否则连续选同一文件不会触发 change
          e.target.value = "";
          if (file) void handleFile(file);
        }}
      />
    </>
  );
}
