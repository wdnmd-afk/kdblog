import { mergeAttributes, Node } from "@tiptap/core";

import { DEFAULT_CALLOUT_TONE, isCalloutTone, type CalloutTone } from "./callout-tone";

/**
 * 提示块（Callout）节点。
 *
 * 语义是「一段需要被看见的说明」，语雀里对应「高亮块」。Tiptap 官方没有
 * 对应扩展，因此自研，但刻意压到最小：只有语气（tone）一个属性，
 * 内容是一到多个段落，不接受嵌套。
 *
 * 不做嵌套：两层提示块在视觉上无法表达谁包含谁（都是同宽的色条块），
 * 也没有实际写作需求。content 用 "paragraph+" 而非 "block+" 顺带挡住了
 * 折叠块、表格进入提示块——那些组合的排版收益为零，出错面却很大。
 *
 * 不做 NodeView：语气切换放进气泡菜单（选中块内文字或光标在其中时出现）。
 * NodeView 换来的只是一个块内浮层按钮，却要把一个客户端组件挂到
 * sharedExtensions 的依赖链上——那份列表服务端 generateHTML 也要加载，
 * 引入 React 组件后就得靠动态 import 绕开，代价远大于收益。
 *
 * ⚠️ 本节点进 sharedExtensions：服务端 generateHTML 必须认识它，
 * 否则发布后的正文里提示块会整体消失。同时要在 sanitize.ts 登记
 * div[data-type="callout"] 与 data-tone 属性。
 */

export interface CalloutOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      /** 把当前块设为提示块，可指定语气 */
      setCallout: (attributes?: { tone?: CalloutTone }) => ReturnType;
      /** 已是提示块则取消，否则设为提示块 */
      toggleCallout: (attributes?: { tone?: CalloutTone }) => ReturnType;
      /** 取消提示块，保留内容 */
      unsetCallout: () => ReturnType;
      /** 只改语气，不改变块类型，也不动内容 */
      setCalloutTone: (tone: CalloutTone) => ReturnType;
    };
  }
}

export const Callout = Node.create<CalloutOptions>({
  name: "callout",

  group: "block",

  content: "paragraph+",

  /**
   * 编辑内部时不让相邻节点被合并进来。
   *
   * 提示块的边界是可见的（色条与浅底），若输入到末尾时把下一段吞进来，
   * 用户会看到色块突然变长，且撤销不回来。
   */
  defining: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      tone: {
        default: DEFAULT_CALLOUT_TONE,
        parseHTML: (element) => {
          const raw = element.getAttribute("data-tone");
          // 外部 HTML（版本快照、粘贴内容）的属性值不受控。非法值一律回落到
          // 默认语气，否则会写进节点却匹配不到样式，块渲染成一片空白
          return isCalloutTone(raw) ? raw : DEFAULT_CALLOUT_TONE;
        },
        renderHTML: (attributes) => ({ "data-tone": attributes.tone }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "callout",
        class: "kd-callout",
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setCallout:
        (attributes) =>
        ({ commands }) =>
          commands.setNode(this.name, {
            tone: attributes?.tone ?? DEFAULT_CALLOUT_TONE,
          }),

      toggleCallout:
        (attributes) =>
        ({ commands }) =>
          commands.toggleNode(this.name, "paragraph", {
            tone: attributes?.tone ?? DEFAULT_CALLOUT_TONE,
          }),

      unsetCallout:
        () =>
        ({ commands }) =>
          commands.setNode("paragraph"),

      /**
       * 改语气走 updateAttributes。
       *
       * 不能用 setNode 重设：那会连内容一起重置，用户的文字会丢。
       */
      setCalloutTone:
        (tone: CalloutTone) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { tone }),
    };
  },

  addKeyboardShortcuts() {
    return {
      /**
       * 光标在空的提示块首段时按回车，退回普通段落。
       *
       * 没有这条，提示块会粘住：用户想结束提示块继续写正文，
       * 只能回车后再想办法改块类型。
       */
      Enter: () => {
        const { editor } = this;
        if (!editor.isActive(this.name)) return false;

        const { $from } = editor.state.selection;
        // 只在空段落上生效，否则会吃掉正常换行
        if ($from.parent.content.size !== 0) return false;

        return editor.commands.unsetCallout();
      },
    };
  },
});
