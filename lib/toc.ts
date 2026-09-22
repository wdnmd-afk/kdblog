/**
 * 文章大纲（TOC）的构建。
 *
 * 设计取舍：在**渲染时**从 contentHtml 里提取标题并注入 id，而不是把 id
 * 写进正文存储。理由是标题文本改动后 id 会自动跟着变，不会留下失效锚点；
 * 已发布的旧文章也无需回填即可获得大纲。
 *
 * 覆盖 h2~h4：与编辑器开放的标题层级一致（h1 留给文章标题本身）。
 */

export interface TocItem {
  id: string;
  /** 纯文本标签，已去掉内联标签与实体 */
  text: string;
  level: 2 | 3 | 4;
}

/** 匹配标题标签，捕获层级、已有属性、内部 HTML */
const HEADING_RE = /<h([234])((?:\s[^>]*)?)>([\s\S]*?)<\/h\1>/g;

/**
 * 由标题文本生成锚点 id。
 *
 * 只保留 ASCII 字母数字与连字符：中文标题转不出有意义的 slug，
 * 此时返回空串，由调用方回退到序号命名，保证 id 始终合法且唯一。
 */
function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/** 去掉内联标签，得到纯文本标签 */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

/**
 * 反转义为可读文本。
 *
 * 顺序与 lib/tiptap/sanitize.ts 的 unescapeHtml 一致：&amp; 必须最后处理，
 * 否则 &amp;lt; 会被先还原成 &lt; 再还原成 "<"。
 */
function unescapeText(value: string): string {
  return value
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export interface BuildTocResult {
  /** 注入了 id 的 HTML，供正文渲染 */
  html: string;
  items: TocItem[];
}

/**
 * 扫描 HTML，给标题注入 id 并收集大纲项。
 *
 * 用正则而非解析器：输入是 sanitize 之后的正文，标签集合受白名单约束、
 * 结构可预期；为一个只认五种标签的提取动作引入 HTML 解析器并不划算。
 */
export function buildToc(html: string): BuildTocResult {
  const items: TocItem[] = [];
  // 记录每个 slug 已出现的次数，用于去重（同名标题会加 -2、-3）
  const seen = new Map<string, number>();

  const withIds = html.replace(
    HEADING_RE,
    (whole, levelStr: string, attrs: string, inner: string) => {
      const text = unescapeText(stripTags(inner)).trim();
      // 空标题不进大纲，但仍要保留在正文里
      if (!text) return whole;

      const level = Number(levelStr) as 2 | 3 | 4;
      const base = slugifyHeading(text) || `section-${items.length + 1}`;

      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      const id = count === 0 ? base : `${base}-${count + 1}`;

      items.push({ id, text, level });

      // 已有属性（如 TextAlign 写出的 style）原样保留，id 追加在后
      return `<h${level}${attrs} id="${id}">${inner}</h${level}>`;
    }
  );

  return { html: withIds, items };
}
