import { z } from "zod";

/**
 * SEO 字段规范的单一事实源。
 *
 * 这份定义同时服务三个地方，任何调整只改这里：
 * 1. Server Action 的服务端强校验（发布前置条件）
 * 2. 编辑器 SEO Tab 的实时字数与命中提示
 * 3. 「填写规范」说明块中展示的约束数值
 */

/** 各字段的长度与数量约束，UI 侧的进度条也读这份常量 */
export const SEO_LIMITS = {
  /** 中文按字计，英文按字符计；30 字 ≈ 60 字符，取宽松上界 */
  metaTitle: { min: 10, max: 60, recommendedCn: 30 },
  metaDescription: { min: 40, max: 160, recommendedCn: 80 },
  /** 1 个主关键词 + 2~3 个次要 + 1~3 个长尾 */
  keywords: { min: 3, max: 8 },
  slug: { max: 80, maxWords: 5 },
  ogImage: { width: 1200, height: 630, maxBytes: 200 * 1024 },
} as const;

/** robots 指令为枚举而非自由输入，避免写出无效值 */
export const ROBOTS_OPTIONS = [
  "index,follow",
  "index,nofollow",
  "noindex,follow",
  "noindex,nofollow",
] as const;

/**
 * slug 规则：小写、仅 a-z0-9 与连字符、不以连字符开头或结尾、不出现连续连字符。
 * 发布后不建议再改（URL 以 id 结尾兜底，改了也不会断链，但会产生一次 301）。
 */
export const slugSchema = z
  .string()
  .trim()
  .min(1, "slug 不能为空")
  .max(SEO_LIMITS.slug.max, `slug 不超过 ${SEO_LIMITS.slug.max} 个字符`)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "slug 只能包含小写字母、数字和单个连字符，且不能以连字符开头或结尾"
  );

/**
 * 前台根路径下的保留 slug。
 *
 * 独立页面模块已于 2026-09-24 移除，保留这份黑名单是为将来恢复根路径页面路由
 * （/{pageSlug}）时不必重新设计——届时与内置路由重名的 slug 会直接抢占路由。
 * 当前唯一的使用方是下面的 pageSlugSchema，暂无调用点。
 */
export const RESERVED_SLUGS = new Set([
  "posts",
  "categories",
  "tags",
  "admin",
  "api",
  "uploads",
  "sitemap.xml",
  "robots.txt",
  "feed",
  "search",
  "login",
  "_next",
]);

/**
 * 根路径页面的 slug 校验。
 *
 * 随独立页面模块的删除进入待用状态（原来只被 server/actions/page.ts 调用）。
 * 保留它连同上面的黑名单，恢复页面功能时直接接回，无需重新设计校验规则。
 */
export const pageSlugSchema = slugSchema.refine(
  (value) => !RESERVED_SLUGS.has(value),
  "该 slug 为系统保留字，请更换"
);

/** 关键词：去空白、去重、限定数量，避免同义词堆砌 */
export const keywordsSchema = z
  .array(z.string().trim().min(1, "关键词不能为空白"))
  .transform((list) => Array.from(new Set(list.filter(Boolean))))
  .refine(
    (list) => list.length >= SEO_LIMITS.keywords.min,
    `关键词至少 ${SEO_LIMITS.keywords.min} 个（1 个主关键词 + 2 个次要关键词）`
  )
  .refine(
    (list) => list.length <= SEO_LIMITS.keywords.max,
    `关键词最多 ${SEO_LIMITS.keywords.max} 个，超出属于堆砌`
  );

/**
 * 草稿态的 SEO 校验：全部可空，允许边写边存。
 * 发布时再用 seoPublishSchema 做强校验。
 */
/**
 * 按显示宽度校验（中文计 2，英文计 1），而非用字符串 length。
 *
 * 这修的是一个会让人以为"永远发不出去"的 bug：
 * 校验此前用 zod 的 min/max 直接比 string.length，而编辑器里的进度条用
 * measureSeoLength 算的是显示宽度。两把尺子不一致——描述框写满 60 个中文字，
 * 进度条显示 61/160（宽度）看着远没到上限，可 length 只有 30，卡在"至少 40"上，
 * 于是永远提示"SEO 信息不完整"却看不出差在哪。统一到显示宽度这一把尺子。
 */
const maxWidth = (limit: number, label: string) =>
  z
    .string()
    .trim()
    .refine(
      (v) => measureSeoLength(v) <= limit,
      `${label}不超过 ${limit} 个字符（中文按 2 计）`
    );

const widthRange = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .refine((v) => measureSeoLength(v) >= min, `${label}至少 ${min} 个字符（中文按 2 计）`)
    .refine((v) => measureSeoLength(v) <= max, `${label}不超过 ${max} 个字符（中文按 2 计）`);

export const seoDraftSchema = z.object({
  metaTitle: maxWidth(SEO_LIMITS.metaTitle.max, "SEO 标题").optional().or(z.literal("")),
  metaDescription: maxWidth(SEO_LIMITS.metaDescription.max, "SEO 描述")
    .optional()
    .or(z.literal("")),
  keywords: z.array(z.string().trim()).default([]),
  /** 留空表示由系统按 /posts/{slug}-{id} 自动生成，仅跨站同发时才需手填 */
  canonicalUrl: z.string().trim().url("canonical 必须是完整 URL").optional().or(z.literal("")),
  ogImage: z.string().trim().optional().or(z.literal("")),
  /** 留空则继承 metaTitle / metaDescription */
  ogTitle: maxWidth(SEO_LIMITS.metaTitle.max, "OG 标题").optional().or(z.literal("")),
  ogDescription: maxWidth(SEO_LIMITS.metaDescription.max, "OG 描述")
    .optional()
    .or(z.literal("")),
  robots: z.enum(ROBOTS_OPTIONS).default("index,follow"),
});

export type SeoDraftInput = z.infer<typeof seoDraftSchema>;

/**
 * 编辑器表单持有的 SEO 值：字段全部必填且为字符串。
 *
 * 与 SeoDraftInput 的区别在于「未填」的表示方式：schema 侧允许 undefined（便于
 * 部分提交），表单侧统一用空字符串，这样受控输入框不会在 undefined 与 "" 之间
 * 切换导致 React 报非受控警告。转换由 toSeoFormValues 负责。
 */
export type SeoFormValues = {
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
  ogImage: string;
  ogTitle: string;
  ogDescription: string;
  canonicalUrl: string;
  robots: (typeof ROBOTS_OPTIONS)[number];
};

/**
 * 发布态的 SEO 校验：标题、描述、关键词为硬性必填。
 * 不合规时发布 action 直接中止并返回字段级错误，不写库。
 */
export const seoPublishSchema = seoDraftSchema.extend({
  metaTitle: widthRange(SEO_LIMITS.metaTitle.min, SEO_LIMITS.metaTitle.max, "SEO 标题"),
  metaDescription: widthRange(
    SEO_LIMITS.metaDescription.min,
    SEO_LIMITS.metaDescription.max,
    "SEO 描述"
  ),
  keywords: keywordsSchema,
});

export type SeoPublishInput = z.infer<typeof seoPublishSchema>;

/**
 * 中英混排的长度度量：CJK 字符计 2，其余计 1。
 * 搜索引擎按像素宽度截断，这个近似比单纯 length 更接近实际显示效果。
 */
export function measureSeoLength(text: string): number {
  let width = 0;
  for (const char of text) {
    width += /[一-龥　-〿＀-￯]/.test(char) ? 2 : 1;
  }
  return width;
}

/** 判断文本是否命中主关键词（关键词列表的第一项），用于编辑器提示 */
export function hitsPrimaryKeyword(text: string, keywords: string[]): boolean {
  const primary = keywords[0]?.trim().toLowerCase();
  if (!primary) return false;
  return text.toLowerCase().includes(primary);
}
