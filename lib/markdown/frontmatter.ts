/**
 * YAML frontmatter 解析。
 *
 * 只认 `---` 包裹、位于文件最开头的块，且只解析「一层 key: value」与
 * 两种数组写法（内联 [a, b] 与短横线列表）。刻意不引 js-yaml：
 * 完整 YAML 规范包含锚点、多行标量、嵌套映射、类型标签等一大堆特性，
 * 而这里的用途只是读几个字符串字段填进表单。引一个解析器来覆盖
 * 我们永远不会生成的语法，不划算，也多一条攻击面（YAML 解析器历史上
 * 反复出现过反序列化漏洞）。
 *
 * 解析不出来不是错误：frontmatter 是可选的，格式不认识就当正文处理，
 * 绝不能因为一行写歪的元信息让整篇导入失败。
 *
 * ⚠ 本模块不含任何服务端专用 import，客户端与服务端都能引用。
 */

/** 已识别的元信息。全部可选——导入方只取自己认得的字段 */
export interface Frontmatter {
  title?: string;
  slug?: string;
  excerpt?: string;
  /** 兼容 tags 与 keywords 两种写法，调用方自行决定用途 */
  tags?: string[];
  keywords?: string[];
  /** 未识别的键原样留着，便于将来扩展时不必改解析器 */
  rest: Record<string, string>;
}

export interface SplitResult {
  frontmatter: Frontmatter | null;
  /** 剥掉 frontmatter 之后的正文 */
  body: string;
}

/**
 * 分隔线必须独占一行。
 *
 * 起始 `---` 要求在文件最开头（允许 BOM 与前置空行由调用方先 trim）。
 * 结束分隔线同时接受 `---` 与 `...`（YAML 文档结束符），后者少见但合法。
 */
const FRONTMATTER_PATTERN = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/**
 * 拆分 frontmatter 与正文。
 *
 * 没有 frontmatter 时返回 null 而非空对象：调用方需要区分「没写」与
 * 「写了但全是空值」——前者该从正文首个标题推断标题，后者应当尊重作者的留空。
 */
export function splitFrontmatter(source: string): SplitResult {
  // 去掉 UTF-8 BOM：它会让 /^---/ 匹配失败，而记事本另存的文件常带 BOM
  const text = source.replace(/^﻿/, "");

  const match = FRONTMATTER_PATTERN.exec(text);
  if (!match) {
    return { frontmatter: null, body: text };
  }

  const body = text.slice(match[0].length);
  const parsed = parseBlock(match[1]);

  // 块存在但一个键都没解析出来（例如里面是随手写的分隔线），当作没有 frontmatter
  if (!parsed) {
    return { frontmatter: null, body: text };
  }

  return { frontmatter: parsed, body };
}

/**
 * 解析 frontmatter 块体。
 *
 * 逐行处理而非按整体语法：这样单行写错只影响那一行，其余字段照常可用。
 * 返回 null 表示一个有效键都没有。
 */
function parseBlock(block: string): Frontmatter | null {
  const rest: Record<string, string> = {};
  const result: Frontmatter = { rest };
  let hasAny = false;

  const lines = block.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // 跳过空行与注释
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

    // 缩进行在这里只可能是上一个键的列表项，已在下面被前瞻消费掉；
    // 走到这里说明是孤立的缩进行，忽略
    if (/^\s/.test(line)) continue;

    const colon = line.indexOf(":");
    if (colon <= 0) continue;

    const key = line.slice(0, colon).trim().toLowerCase();
    let raw = line.slice(colon + 1).trim();

    /*
     * 值为空时前瞻后续的短横线列表：
     *
     *   tags:
     *     - a
     *     - b
     *
     * 这是 YAML 数组最常见的写法，不支持它等于大部分文件的 tags 都读不到。
     */
    if (raw === "") {
      const items: string[] = [];
      while (i + 1 < lines.length && /^\s+-\s*/.test(lines[i + 1])) {
        i += 1;
        const item = stripQuotes(lines[i].replace(/^\s+-\s*/, "").trim());
        if (item) items.push(item);
      }
      if (items.length > 0) {
        assign(result, rest, key, items.join(", "), items);
        hasAny = true;
      }
      continue;
    }

    raw = stripQuotes(raw);
    if (!raw) continue;

    // 内联数组 [a, b, c]
    const inline = /^\[(.*)\]$/.exec(raw);
    const list = inline
      ? inline[1]
          .split(",")
          .map((part) => stripQuotes(part.trim()))
          .filter(Boolean)
      : null;

    assign(result, rest, key, inline ? (list ?? []).join(", ") : raw, list);
    hasAny = true;
  }

  return hasAny ? result : null;
}

/** 把解析出的键值填到已知字段，未知键进 rest */
function assign(
  target: Frontmatter,
  rest: Record<string, string>,
  key: string,
  flat: string,
  list: string[] | null
) {
  switch (key) {
    case "title":
      target.title = flat;
      return;
    case "slug":
      target.slug = flat;
      return;
    case "excerpt":
    case "description":
    case "summary":
      // 三种常见写法都映射到摘要：导出时我们只写 excerpt，
      // 但导入的文件可能来自 Hugo / Jekyll 等生成器
      target.excerpt = flat;
      return;
    case "tags":
      target.tags = list ?? splitLoose(flat);
      return;
    case "keywords":
      target.keywords = list ?? splitLoose(flat);
      return;
    default:
      rest[key] = flat;
  }
}

/** 去掉成对的引号。只处理首尾配对的情况，避免把正文里的引号也剥掉 */
function stripQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

/** 逗号或中文逗号分隔的松散写法：tags: a, b、c */
function splitLoose(value: string): string[] {
  return value
    .split(/[,，、]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// 序列化（导出用）
// ---------------------------------------------------------------------------

/**
 * 生成 frontmatter 块。
 *
 * 值统一用双引号包裹并转义内部的引号与反斜杠：标题里出现冒号
 * （「标题: 副标题」这种）在 YAML 里会被解析成嵌套映射，不加引号就读不回来。
 * 空字段直接不输出，而不是写一个空串——空串在 YAML 里是有意义的值，
 * 会覆盖掉导入端「从正文推断」的回退逻辑。
 */
export function buildFrontmatter(fields: {
  title?: string;
  slug?: string;
  excerpt?: string;
  keywords?: string[];
  date?: string;
}): string {
  const lines: string[] = ["---"];

  if (fields.title) lines.push(`title: ${quote(fields.title)}`);
  if (fields.slug) lines.push(`slug: ${quote(fields.slug)}`);
  if (fields.excerpt) lines.push(`excerpt: ${quote(fields.excerpt)}`);
  if (fields.keywords && fields.keywords.length > 0) {
    lines.push(`keywords: [${fields.keywords.map(quote).join(", ")}]`);
  }
  if (fields.date) lines.push(`date: ${fields.date}`);

  lines.push("---");
  return lines.join("\n");
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
