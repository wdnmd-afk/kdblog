import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import { TextAlign } from "@tiptap/extension-text-align";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import { Highlight } from "@tiptap/extension-highlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { TextStyleKit } from "@tiptap/extension-text-style";
import StarterKit from "@tiptap/starter-kit";
import type { Extensions } from "@tiptap/core";

import { Callout } from "./callout";
import { lowlight } from "./lowlight";
import { SlashCommand, slashCommandItems } from "./slash-command";

/**
 * 前后端共享的 Tiptap 扩展列表。
 *
 * ⚠️ 禁止单侧修改：编辑器（客户端）与 generateHTML（服务端预渲染）必须 import
 * 同一份列表。一旦分叉就会出现「编辑器里显示正常、发布后样式或节点丢失」的问题，
 * 且因为两边都不报错，排查成本极高。
 *
 * 新增扩展时必须同步两处：
 * 1. 这里的 extensions 数组
 * 2. lib/tiptap/sanitize.ts 的标签/属性白名单（否则新节点会被静默剥掉）
 */
export const sharedExtensions: Extensions = [
  StarterKit.configure({
    // 标题只开放 h2~h4：h1 留给文章标题本身，避免正文抢占唯一 h1 影响 SEO。
    // 面板上的「一级标题」对应这里的 level 2，见 slash-command.ts 的说明
    heading: { levels: [2, 3, 4] },
    // 关掉 StarterKit 自带的 Link，改用下方带 nofollow 配置的那份。
    // 两者同时启用会触发 "Duplicate extension names found: ['link']"，
    // 且哪一份生效不确定，外链的 rel 属性可能丢失。
    link: false,
    // 同理关掉自带的代码块，换成带语法高亮的版本。两者同名，
    // 同时启用会报重复扩展，且高亮是否生效取决于注册顺序
    codeBlock: false,
  }),
  CodeBlockLowlight.configure({ lowlight }),
  Image.configure({
    inline: false,
    allowBase64: false, // 图片统一走上传接口，不允许 base64 内联膨胀正文
  }),
  Link.configure({
    openOnClick: false,
    autolink: true,
    // 外链统一加 nofollow，避免无意向外传递权重
    HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
  }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  TableKit.configure({ table: { resizable: true } }),
  /**
   * 只取文字颜色与背景色。
   *
   * 每个字段收 false 或一份 Partial 配置，没有「true 表示启用」这种写法——
   * 空对象即用默认配置启用。
   *
   * fontFamily / fontSize / lineHeight 会引入任意字体与字号，与本设计系统
   * 「层级靠明度差而非字号堆砌」的基调冲突，而且它们放进 style 属性后
   * sanitize 侧必须再放开两条正则，口子开得没必要。
   */
  TextStyleKit.configure({
    textStyle: {},
    color: {},
    backgroundColor: {},
    fontFamily: false,
    fontSize: false,
    lineHeight: false,
  }),
  // multicolor 打开才会输出 data-color 与 background-color；
  // 关掉时所有高亮是同一个颜色，没法区分语义
  Highlight.configure({ multicolor: true }),
  Subscript,
  Superscript,
  /**
   * 折叠块。persist 置真让展开状态写进文档属性，发布后前台保持作者当时的
   * 展开选择——置假的话前台一律收起，长内容会被折叠成一个标题。
   */
  Details.configure({ persist: true, HTMLAttributes: { class: "kd-details" } }),
  DetailsSummary,
  DetailsContent,
  TaskList,
  TaskItem.configure({ nested: true }),
  Callout,
];

/** 编辑器专用扩展：仅客户端需要，服务端渲染不涉及 */
export const editorOnlyExtensions: Extensions = [
  Placeholder.configure({ placeholder: "输入 / 或 # 唤起命令，或直接开始写作…" }),
  // 斜杠命令依赖 DOM 与编辑器实例，只能存在于客户端这一侧
  SlashCommand.configure({ items: slashCommandItems }),
];
