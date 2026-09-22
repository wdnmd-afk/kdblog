import { generateHTML } from "@tiptap/html/server";
import sanitizeHtml from "sanitize-html";
import type { JSONContent } from "@tiptap/core";
import { HEX_COLOR_PATTERN } from "./editor-colors";
import { sharedExtensions } from "./extensions";
import { lowlight, normalizeLanguage } from "./lowlight";
import { extractFirstImage, extractPlainText } from "./plain-text";

/**
 * 白名单必须与 lib/tiptap/extensions.ts 的扩展列表对齐。
 * 新增 Tiptap 扩展后若忘记在此登记标签，其产出会被静默剥掉。
 */
const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "s",
  // StarterKit 默认启用 Underline，漏登记会让下划线内容在发布后被静默剥掉
  "u",
  "code",
  "pre",
  "blockquote",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "hr",
  "a",
  "img",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  // TextStyle 的输出容器
  "span",
  // Highlight 扩展的输出
  "mark",
  // Subscript / Superscript
  "sub",
  "sup",
  // Details 折叠块
  "details",
  "summary",
  // TaskList / TaskItem：label 包住复选框，div 是文本容器
  "label",
  "input",
  "div",
];

const sanitizeOptions: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ["href", "rel", "target", "title"],
    img: ["src", "alt", "title", "width", "height", "loading"],
    /**
     * span 承载两类内容：
     * - TextStyle 的行内颜色与背景色，取值由下面的 allowedStyles 用严格正则兜住
     * - lowlight 高亮后的给色容器，靠 class 挂配色
     */
    span: ["style", "class"],
    // Highlight 用 data-color 记录色值，样式另写在 style 里
    mark: ["data-color", "style"],
    // 折叠块的展开状态要保留，否则前台一律收起
    details: ["open"],
    summary: ["data-type"],
    /**
     * div 承载两类容器：
     * - detailsContent 与 taskItem 的内层容器，靠 data-type 区分形态
     * - Callout 本体，靠 data-type 标识、data-tone 决定配色
     */
    div: ["data-type", "data-tone"],
    // TaskItem 的复选框。disabled 让只读前台不可勾选
    input: ["type", "checked", "disabled"],
    ul: ["data-type"],
    li: ["data-type", "data-checked"],
    // TextAlign 扩展通过 style 输出对齐方式
    p: ["style"],
    h2: ["style"],
    h3: ["style"],
    h4: ["style"],
    // 代码块的语言标记与 lowlight 的 hljs-* 配色类
    pre: ["class"],
    code: ["class"],
  },
  /**
   * 只放行明确需要的 style 声明。
   *
   * 键是标签名：key 为 "*" 时对该标签的所有祖先生效，而显式的标签键
   * 会覆盖通配规则。因此对齐只留给块级标签，颜色只留给 span，
   * 二者不交叉——直接给 "*" 放开 color 等于开了任意 CSS 注入的口子。
   *
   * span 的取值用十六进制与 rgb()/hsl() 两种严格正则：前者是本站色板的
   * 输出格式，后者兼容粘贴进来的外部内容。刻意不放行 var()、url()、
   * expression() 等写法。
   */
  allowedStyles: {
    "*": { "text-align": [/^(left|right|center|justify)$/] },
    span: {
      color: [HEX_COLOR_PATTERN, /^rgba?\([\d\s.,%]+\)$/, /^hsla?\([\d\s.,%deg]+\)$/],
      "background-color": [
        HEX_COLOR_PATTERN,
        /^rgba?\([\d\s.,%]+\)$/,
        /^hsla?\([\d\s.,%deg]+\)$/,
      ],
    },
    mark: {
      "background-color": [
        HEX_COLOR_PATTERN,
        /^rgba?\([\d\s.,%]+\)$/,
        /^hsla?\([\d\s.,%deg]+\)$/,
      ],
      color: [HEX_COLOR_PATTERN, /^rgba?\([\d\s.,%]+\)$/, /^hsla?\([\d\s.,%deg]+\)$/],
    },
  },
  // 图片只允许站内相对路径与 https，阻断 javascript: 等伪协议
  allowedSchemes: ["https", "mailto"],
  allowedSchemesByTag: { img: ["https"] },
  allowProtocolRelative: false,
  transformTags: {
    // 兜底：即使编辑器侧配置被改动，外链仍强制加上安全属性
    a: sanitizeHtml.simpleTransform("a", {
      rel: "noopener noreferrer nofollow",
      target: "_blank",
    }),
  },
};

/**
 * 把 Tiptap JSON 预渲染为可直接输出的安全 HTML。
 *
 * 只在发布/保存时执行一次并落库（Post.contentHtml），前台读取时不再重复渲染，
 * 因此 sanitize 只需在这一处把关，页面层可以安全地直接输出该字段。
 */
export function renderContentHtml(json: JSONContent): string {
  const rawHtml = generateHTML(json, sharedExtensions);
  // 先高亮再 sanitize：高亮产生的 span 与 class 需要经过白名单校验，
  // 顺序反过来会把刚加进去的标签当作未登记内容处理
  return sanitizeHtml(highlightCodeBlocks(rawHtml), sanitizeOptions);
}

// ---------------------------------------------------------------------------
// 代码块语法高亮
// ---------------------------------------------------------------------------

/** 匹配 generateHTML 输出的代码块，同时捕获语言与代码正文 */
const CODE_BLOCK_PATTERN =
  /<pre><code(?:\s+class="language-([\w-]+)")?>([\s\S]*?)<\/code><\/pre>/g;

/**
 * 给代码块补语法高亮。
 *
 * 为什么必须在这里补：lowlight 在编辑器里靠 ProseMirror 的装饰器着色，
 * 而装饰器只影响视图，不会进入 generateHTML 的输出——不补这一步，
 * 编辑器里代码是彩色的，发布后前台却是一片纯黑文字。实测确认过：
 * generateHTML 只产出 `<pre><code class="language-x">`，没有任何 hljs 节点。
 *
 * 用正则替换而非解析 HTML：输入全部来自 generateHTML，结构可预期，
 * 代码块是固定形态。代价是正文里若出现字面的 "</code></pre>" 会截断，
 * 但那段文本在 HTML 里必然已被转义成 &lt;/code&gt;，不会误匹配。
 *
 * 整段包在 try/catch 里：它挂在保存与发布链路上，
 * lowlight 对未注册语言会抛异常，绝不能因为一个语言名让整次保存失败。
 */
function highlightCodeBlocks(html: string): string {
  if (!html.includes("<pre><code")) return html;

  try {
    return html.replace(CODE_BLOCK_PATTERN, (whole, language: string, body: string) => {
      const resolved = normalizeLanguage(language);
      // 没写语言、或语言不在 lowlight 的注册表里：原样返回，不做高亮
      if (!resolved) return whole;

      // generateHTML 会把代码里的 < > & 转义，lowlight 需要的是原始文本
      const code = unescapeHtml(body);
      const tree = lowlight.highlight(resolved, code);

      const className = language ? ` class="language-${language}"` : "";
      return `<pre><code${className}>${serializeHast(tree.children)}</code></pre>`;
    });
  } catch {
    // 高亮失败不该影响正文落库，退回无高亮的原始 HTML
    return html;
  }
}

/** hast 节点。只用到 lowlight 会产出的两种形态：元素与文本 */
interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

/**
 * 把 lowlight 的 hast 树序列化为 HTML 字符串。
 *
 * lowlight 返回的是语法树而非字符串，官方示例用 hast-util-to-html 转换，
 * 但那会为一个只有十行的转换再引一个依赖。这里只处理 element 与 text
 * 两种节点（lowlight 的产物只有这两种），文本统一转义。
 */
function serializeHast(nodes: HastNode[]): string {
  let out = "";

  for (const node of nodes) {
    if (node.type === "text") {
      out += escapeHtml(node.value ?? "");
      continue;
    }

    if (node.type !== "element" || !node.tagName) continue;

    const classes = Array.isArray(node.properties?.className)
      ? (node.properties!.className as string[]).join(" ")
      : "";
    const attr = classes ? ` class="${escapeHtml(classes)}"` : "";
    const inner = node.children ? serializeHast(node.children) : "";

    out += `<${node.tagName}${attr}>${inner}</${node.tagName}>`;
  }

  return out;
}

/**
 * 转义为 HTML 文本。
 *
 * 顺序不能换：& 必须最先处理，否则会把后面几步产生的实体里的 & 再转一次，
 * 输出成 &amp;lt; 这种双重转义。
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 反转义 HTML 文本，是上面 escapeHtml 的逆操作。
 *
 * 自己写而不引 entities 之类的包：本函数只需处理 escapeHtml 会产出的
 * 那几种实体，而 generateHTML 内部的转义规则与 escapeHtml 一致。
 * 引入一个包来覆盖完整 HTML 实体表（含上百个具名实体）在这里用不上，
 * 且它目前只是 happy-dom 的传递依赖，直接 import 会依赖 pnpm 的
 * node_modules 扁平化行为，换包管理器就可能解析失败。
 *
 * &#39; 一并处理：generateHTML 对单引号用的是数字实体而非 &apos;。
 */
function unescapeHtml(value: string): string {
  return value
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    // &amp; 必须最后处理：提前还原会把 &amp;lt; 变成 &lt;，
    // 下一步又被还原成 "<"，凭空造出一个标签
    .replace(/&amp;/g, "&");
}

/**
 * 这两个函数实现已移到 ./plain-text，此处重导出以免既有调用方改 import。
 *
 * 它们必须留在客户端也能引用的模块里：编辑器需要数
 * extractPlainText 的字数，而本文件（因 @tiptap/html/server）只能跑在服务端。
 */
export { extractFirstImage, extractPlainText };
