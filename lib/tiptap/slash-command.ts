import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Editor, Range } from "@tiptap/core";

/**
 * 斜杠命令扩展。
 *
 * 为什么自行实现而不用 @tiptap/suggestion：
 * suggestion 面向「任意字符触发的提及/标签」场景，带一整套装饰与异步查询能力，
 * 而命令面板只需要「特定位置打触发符弹出固定列表」这一种用法。自己实现约 300 行，
 * 省掉一个依赖，也避免 suggestion 的默认行为（如跨段落触发）需要额外关闭。
 *
 * 两个触发字符共用同一套状态机，只在 trigger 字段上区分：
 * "/" 是自由查询（按标题与关键词匹配），"#" 是数字直映射标题层级。
 * 这样键盘导航、范围删除、装饰、收敛守卫都只有一份实现。
 *
 * 触发位置规则（两个字符一致）：必须处于行首，或紧跟在空白之后。
 * 这条规则替代了早期「必须是空段落第一个字符」的写法——后者让段落中间与
 * 列表项里都唤不出面板，与语雀的行为差得较远；而放宽到「前接空白」仍然
 * 拦得住 1/2、and/or、a/b 这类正文写法。
 *
 * 触发符与查询词是文档里的真实文本，只是被装饰成灰色、执行时删除。
 * 这样做的原因：光标位置随文本自然前进，过滤词能逐个字符累积；
 * 若把触发符吞掉不写入文档，输入下一个字符时光标仍在原位，查询词永远累积不起来。
 * Esc 放弃时会显式删除已输入的部分，用户不会留下孤儿字符。
 *
 * ⚠️ 本扩展只进 editorOnlyExtensions，不得加入 sharedExtensions。
 * 服务端 generateHTML 不需要命令菜单（它不产生任何新节点类型），
 * 但插件依赖 DOM 与编辑器实例，混进去会让服务端渲染失败。
 */

export const slashCommandPluginKey = new PluginKey<SlashMenuState>("slashCommand");

/** 触发字符。两个字符的差异只在过滤规则，位置规则与交互完全一致 */
export type SlashTrigger = "/" | "#";

const TRIGGERS: readonly string[] = ["/", "#"];

/** 图标名。扩展层只给字符串，由 UI 层映射为组件，避免把 React 依赖带进插件 */
export type EditorIconName =
  | "pilcrow"
  | "heading2"
  | "heading3"
  | "heading4"
  | "list"
  | "listOrdered"
  | "listTodo"
  | "quote"
  | "squareCode"
  | "table"
  | "image"
  | "minus"
  | "info"
  | "chevronDown";

export interface SlashMenuItem {
  /** 执行命令。Range 是触发符加查询词的范围，执行前会被删除 */
  run?: (props: { editor: Editor; range: Range }) => void;
  /**
   * 命令类型。
   *
   * "action" 表示需要 UI 层配合的动作（如插入图片要打开文件选择框），
   * 插件层拿不到 DOM 上下文，因此不给这类项写 run。
   */
  kind: "command" | "action";
  title: string;
  description: string;
  /** 参与过滤：输入 /h2 或 /标题 都应能找到二级标题 */
  keywords: string[];
  icon: EditorIconName;
  /** 分组名。同组连排，组间画分隔线——平铺二十项时找不到东西 */
  group: string;
  /** 右侧展示的快捷键提示，如 "#1"。标题项用它说明数字编号 */
  shortcut?: string;
}

export interface SlashMenuState {
  open: boolean;
  /** 触发字符，决定过滤规则 */
  trigger: SlashTrigger;
  /** 触发符之后的过滤词 */
  query: string;
  /** 待替换的范围，从触发符起到光标止 */
  range: Range | null;
  /** 列表高亮项 */
  selected: number;
  /** 光标位置。只存位置不存坐标：坐标需随滚动重算，位置在事务里稳定 */
  from: number;
}

const CLOSED: SlashMenuState = {
  open: false,
  trigger: "/",
  query: "",
  range: null,
  selected: 0,
  from: 0,
};

/** 查询词上限。超过就认为用户是在写含斜杠的正文，而非找命令 */
const MAX_QUERY_LENGTH = 20;

/**
 * "#" 的数字编号到标题层级的映射。
 *
 * 数字从 1 起排，但输出是 h2~h4：正文不使用 h1（它留给文章标题，
 * 见 extensions.ts 的说明），因此不存在 "#4" 对应的层级。
 */
const HASH_HEADING_LEVELS: Record<string, 2 | 3 | 4> = {
  "1": 2,
  "2": 3,
  "3": 4,
};

export interface SlashCommandOptions {
  items: SlashMenuItem[];
}

/**
 * 判断某个输入字符能否在当前位置唤出面板。
 *
 * 用编辑器全文判断而非当前文本块：光标处于块的起始位置时，作为参照的
 * 前一个字符在上一块里，只看当前块会把「回车后直接打 /」误判为无效。
 */
function canTriggerAt(view: EditorView, from: number): boolean {
  const $from = view.state.doc.resolve(from);

  // 代码块里的 "/" 是正文（注释、路径、正则），不能弹面板
  if ($from.parent.type.name === "codeBlock") return false;

  // textBetween 的 leafText 传空串：图片等叶子节点在正文里可视作「无字符」，
  // 它后面紧跟触发符应算作行首
  const before = view.state.doc.textBetween(0, from, "\n", "");
  if (before.length === 0) return true;

  // 行首（上一字符是换行）或前一字符是空白，都算触发位置
  return /\s$/.test(before);
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: "slashCommand",

  addOptions() {
    return { items: [] };
  },

  addProseMirrorPlugins() {
    const { items } = this.options;
    /**
     * 在这里取一次编辑器实例。
     *
     * 插件配置里的 this 指向 Plugin 而非 Extension，直接用 this.editor 会取到
     * undefined；闭包捕获外层的 this 才是编辑器。
     */
    const editor = this.editor;

    return [
      new Plugin<SlashMenuState>({
        key: slashCommandPluginKey,

        state: {
          init: () => CLOSED,

          apply(tr, prev, _oldState, newState) {
            // 关闭指令：命令已执行或用户撤销，直接复位
            if (tr.getMeta(slashCommandPluginKey) === "close") {
              return CLOSED;
            }

            // 选择范围时不该弹命令菜单，用户多半是在选文本
            if (!tr.selection.empty) {
              return prev.open ? CLOSED : prev;
            }

            const from = tr.selection.from;

            if (prev.open && prev.range) {
              const text = newState.doc.textBetween(prev.range.from, from, "\n", "\n");

              // range.from 处必须仍是触发符：用户可能删掉了它
              if (!text.startsWith(prev.trigger)) return CLOSED;

              const query = text.slice(1);

              // 出现空格或换行说明是在写正文（如 "和/或 的用法"），不是在找命令
              if (query.length > MAX_QUERY_LENGTH || /[\s\n]/.test(query)) {
                return CLOSED;
              }

              return {
                open: true,
                trigger: prev.trigger,
                query,
                range: { from: prev.range.from, to: from },
                // 过滤词变化后原高亮可能越界，归零交给 UI 层按新列表收敛
                selected: query === prev.query ? prev.selected : 0,
                from,
              };
            }

            // 未打开时监视本文本块是否新出现了触发符
            return prev;
          },
        },

        props: {
          /**
           * 输入触发符时打开菜单。
           *
           * 返回 false 让触发符正常进入文档：这样光标会后移，
           * 后续字符才能累积成过滤词（见文件头说明）。
           */
          handleTextInput(view, from, _to, text) {
            if (!TRIGGERS.includes(text)) return false;
            if (!canTriggerAt(view, from)) return false;

            // 没有命令可显示时打开一个空菜单，还不如不打开
            if (items.length === 0) return false;

            // 文档会插入触发符，光标随之后移一位，范围与 from 都按新位置记
            const after = from + 1;
            const state: SlashMenuState = {
              open: true,
              trigger: text as SlashTrigger,
              query: "",
              range: { from, to: after },
              selected: 0,
              from: after,
            };

            view.dispatch(view.state.tr.setMeta(slashCommandPluginKey, state));
            return false;
          },

          handleKeyDown(view, event) {
            const state = slashCommandPluginKey.getState(view.state);
            if (!state?.open || !state.range) return false;

            const filtered = filterItemsByTrigger(items, state.trigger, state.query);

            if (event.key === "Escape") {
              // 把已输入的触发符与查询词删掉再关闭，避免留下孤儿字符
              const tr = view.state.tr
                .delete(state.range.from, state.range.to)
                .setMeta(slashCommandPluginKey, "close");
              view.dispatch(tr);
              return true;
            }

            if (filtered.length === 0) return false;

            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              const delta = event.key === "ArrowDown" ? 1 : -1;
              const selected = (state.selected + delta + filtered.length) % filtered.length;
              view.dispatch(
                view.state.tr.setMeta(slashCommandPluginKey, { ...state, selected })
              );
              return true;
            }

            if (event.key === "Enter") {
              const item = filtered[state.selected];
              // action 类命令需要 UI 层配合（如打开文件选择框），
              // 插件层无法执行，放行让回车正常换行
              if (!item || item.kind !== "command" || !item.run) return false;

              // 先关闭菜单再执行：命令自身会发起链式事务，
              // 顺序反过来会让命令事务覆盖插件状态，菜单残留在屏幕上
              view.dispatch(view.state.tr.setMeta(slashCommandPluginKey, "close"));
              item.run({ editor, range: state.range });
              return true;
            }

            return false;
          },

          /**
           * 把已输入的触发符与过滤词显示为灰色。
           *
           * 不装饰就与正文同样式，用户会以为它是正文的一部分；
           * 灰掉能传达「这段是临时的，选完命令就消失」。
           */
          decorations(state) {
            const s = slashCommandPluginKey.getState(state);
            if (!s?.open || !s.range) return null;

            return DecorationSet.create(state.doc, [
              Decoration.inline(s.range.from, s.range.to, {
                class: "text-ink-400",
              }),
            ]);
          },
        },
      }),
    ];
  },
});

/**
 * 按过滤词筛命令。
 *
 * keywords 也参与匹配：用户输入 /h2 或 /标题 都应找到二级标题，
 * 只匹配 title 会让中文用户被迫记住英文命令名。
 */
export function filterItems(items: SlashMenuItem[], query: string): SlashMenuItem[] {
  if (!query) return items;
  const q = query.toLowerCase();
  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.keywords.some((k) => k.toLowerCase().includes(q))
  );
}

/**
 * 按触发字符分派过滤规则。
 *
 * "#" 走数字直映射而非关键词匹配：用户输入 #1 期待的是「第一个标题层级」，
 * 而不是「标题里含 1 的命令」。若按关键词匹配，"一级标题" 里含 "一" 不含 "1"，
 * 列表会瞬间清空，看起来像功能坏了。
 *
 * 规则：
 * - 查询词为空：给出全部标题项，让用户不必先记住数字
 * - 查询词是 1/2/3：只留对应层级
 * - 其它任何字符：返回空列表，UI 层据此收起面板
 */
export function filterItemsByTrigger(
  items: SlashMenuItem[],
  trigger: SlashTrigger,
  query: string
): SlashMenuItem[] {
  const scoped = items.filter((item) => !item.shortcut || item.shortcut.startsWith(trigger));

  if (trigger !== "#") return filterItems(scoped, query);
  if (query === "") return scoped;

  const level = HASH_HEADING_LEVELS[query];
  if (!level) return [];

  // shortcut 是 "#1" 这样的一到两个字符，层级由它反查
  return scoped.filter((item) => item.shortcut === `${trigger}${query}`);
}

/**
 * 从编辑器状态读斜杠菜单状态。
 *
 * 断言为可空：扩展未装配时插件不存在，getState 会返回 undefined。
 */
export function getSlashMenuState(editor: Editor | null): SlashMenuState | null {
  if (!editor) return null;
  return slashCommandPluginKey.getState(editor.state) ?? null;
}

/** 面板标题。两个触发字符的意图不同，标题跟着换 */
export const TRIGGER_LABEL: Record<SlashTrigger, string> = {
  "/": "插入内容",
  "#": "标题层级",
};

/**
 * 命令项定义。
 *
 * 与工具栏共用同一套 chain 调用，保证「菜单里能做的」与「工具栏能做的」行为一致。
 *
 * 标题项的 run 里先 setParagraph 再 toggleHeading：toggleHeading 在已经是指定
 * 层级的标题上会取消标题。用户在一个 h3 上执行 "#1" 的意图是「改成最大标题」，
 * 不先归零的话会得到正文，与预期相反。
 *
 * shortcut 同时承担两个职责：面板右侧的提示文案，以及 "#" 触发下的可见性判断
 * （只有带 shortcut 的项才会出现在 "#" 面板里）。
 */
export const slashCommandItems: SlashMenuItem[] = [
  {
    kind: "command",
    title: "正文",
    description: "普通段落",
    keywords: ["p", "paragraph", "text", "正文", "段落", "duanluo"],
    icon: "pilcrow",
    group: "基础块",
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  {
    kind: "command",
    title: "一级标题",
    description: "章节标题 · 输出 H2",
    keywords: ["h1", "h2", "heading", "标题", "biaoti"],
    icon: "heading2",
    group: "基础块",
    shortcut: "#1",
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setParagraph()
        .toggleHeading({ level: 2 })
        .run(),
  },
  {
    kind: "command",
    title: "二级标题",
    description: "小节标题 · 输出 H3",
    keywords: ["h2", "h3", "heading", "标题", "biaoti"],
    icon: "heading3",
    group: "基础块",
    shortcut: "#2",
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setParagraph()
        .toggleHeading({ level: 3 })
        .run(),
  },
  {
    kind: "command",
    title: "三级标题",
    description: "更细的层级 · 输出 H4",
    keywords: ["h3", "h4", "heading", "标题", "biaoti"],
    icon: "heading4",
    group: "基础块",
    shortcut: "#3",
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setParagraph()
        .toggleHeading({ level: 4 })
        .run(),
  },
  {
    kind: "command",
    title: "无序列表",
    description: "项目符号列表",
    keywords: ["ul", "bullet", "list", "列表", "liebiao"],
    icon: "list",
    group: "列表",
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    kind: "command",
    title: "有序列表",
    description: "带编号的列表",
    keywords: ["ol", "ordered", "list", "列表", "编号"],
    icon: "listOrdered",
    group: "列表",
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    kind: "command",
    title: "任务清单",
    description: "可勾选的待办项",
    keywords: ["todo", "task", "check", "任务", "待办", "renwu"],
    icon: "listTodo",
    group: "列表",
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    kind: "command",
    title: "引用",
    description: "引用一段话",
    keywords: ["quote", "blockquote", "引用", "yinyong"],
    icon: "quote",
    group: "基础块",
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    kind: "command",
    title: "代码块",
    description: "带语法高亮的代码",
    keywords: ["code", "pre", "代码", "daima"],
    icon: "squareCode",
    group: "基础块",
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    kind: "command",
    title: "提示块",
    description: "醒目的一段说明",
    keywords: ["callout", "note", "tip", "提示", "tishi"],
    icon: "info",
    group: "基础块",
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleCallout().run(),
  },
  {
    kind: "command",
    title: "折叠块",
    description: "可展开收起的内容",
    keywords: ["details", "collapse", "折叠", "zhedie"],
    icon: "chevronDown",
    group: "基础块",
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setDetails().run(),
  },
  {
    kind: "command",
    title: "表格",
    description: "插入 3×3 表格",
    keywords: ["table", "grid", "表格", "biaoge"],
    icon: "table",
    group: "插入",
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  {
    kind: "action",
    title: "图片",
    description: "从本地上传",
    keywords: ["image", "img", "photo", "图片", "tupian"],
    icon: "image",
    group: "插入",
  },
  {
    kind: "command",
    title: "分割线",
    description: "内容分隔",
    keywords: ["hr", "divider", "分割线", "fengexian"],
    icon: "minus",
    group: "插入",
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
];
