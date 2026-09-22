"use client";

import { useState, type ReactNode } from "react";

import {
  ROBOTS_OPTIONS,
  SEO_LIMITS,
  hitsPrimaryKeyword,
  measureSeoLength,
  type SeoFormValues,
} from "@/lib/seo/schema";
import { Drawer } from "@/components/overlay";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";

/**
 * 文章设置抽屉。
 *
 * 从原来的「设置 / SEO 两个 Tab」合并而来。合并不是偷懒：这两组字段
 * 在实际写作里是连着填的（定了 slug 就顺手写 SEO 标题），分成两个 Tab
 * 反而要来回切。抽屉本身按分组展示，视觉上仍是两块。
 *
 * 抽屉不持有任何状态，所有字段都由 PostEditor 传入并回写。原因是保存时
 * 需要一次性拿到全部字段，若这里各存一份，两边的值迟早会不同步。
 */

export interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;

  isNew: boolean;
  postId: number | undefined;

  slug: string;
  onSlugChange: (value: string) => void;
  /** 由标题重新生成 slug */
  onRegenerateSlug: () => void;

  categoryId: number | null;
  onCategoryChange: (value: number | null) => void;
  categories: { id: number; name: string; depth: number }[];

  tagIds: number[];
  onTagIdsChange: (value: number[]) => void;
  newTagNames: string[];
  onNewTagNamesChange: (value: string[]) => void;
  allTags: { id: number; name: string }[];

  /**
   * 摘要留空表示由正文自动截取。
   *
   * 用「空字符串 = 自动」这一个状态表达，而不是额外的 autoGenerate 布尔：
   * 两者并存时会出现「开关是自动、输入框里却留着上次的文字」这种自相矛盾的界面。
   */
  excerpt: string;
  onExcerptChange: (value: string) => void;

  seo: SeoFormValues;
  onSeoChange: (value: SeoFormValues) => void;

  fieldErrors: Record<string, string[]>;
}

export function SettingsDrawer(props: SettingsDrawerProps) {
  const {
    open,
    onClose,
    isNew,
    postId,
    slug,
    onSlugChange,
    onRegenerateSlug,
    categoryId,
    onCategoryChange,
    categories,
    tagIds,
    onTagIdsChange,
    newTagNames,
    onNewTagNamesChange,
    allTags,
    excerpt,
    onExcerptChange,
    seo,
    onSeoChange,
    fieldErrors,
  } = props;

  const titleWidth = measureSeoLength(seo.metaTitle);
  const descWidth = measureSeoLength(seo.metaDescription);

  function toggleTag(id: number) {
    onTagIdsChange(
      tagIds.includes(id) ? tagIds.filter((t) => t !== id) : [...tagIds, id]
    );
  }

  function addKeyword(raw: string) {
    const value = raw.trim();
    if (!value || seo.keywords.includes(value)) return;
    onSeoChange({ ...seo, keywords: [...seo.keywords, value] });
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="文章设置"
      description="URL、分类标签与搜索引擎信息"
      footer={
        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose}>
            完成
          </Button>
        </div>
      }
    >
      <div className="space-y-7">
        <Section title="基本">
          <Field label="URL slug" errors={fieldErrors.slug}>
            <div className="flex gap-2">
              <Input
                value={slug}
                onChange={(e) => onSlugChange(e.target.value)}
                placeholder="my-first-post"
              />
              <Button
                onClick={onRegenerateSlug}
                className="shrink-0"
                title="按标题重新生成"
              >
                生成
              </Button>
            </div>
            <p className="!mt-1.5 text-xs text-ink-500">
              最终地址：/posts/{slug || "your-slug"}-{postId ?? "{id}"}
            </p>
          </Field>

          <Field label="分类">
            <Select
              value={categoryId ?? ""}
              onChange={(e) =>
                onCategoryChange(e.target.value ? Number(e.target.value) : null)
              }
            >
              <option value="">未分类</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {"　".repeat(c.depth)}
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>

          <TagField
            allTags={allTags}
            tagIds={tagIds}
            onToggle={toggleTag}
            newTagNames={newTagNames}
            onNewTagNamesChange={onNewTagNamesChange}
          />

          <Field
            label="摘要"
            hint="留空则由正文自动截取前 160 字"
            errors={fieldErrors.excerpt}
          >
            <Textarea
              value={excerpt}
              onChange={(e) => onExcerptChange(e.target.value)}
              rows={3}
              placeholder="自动截取正文开头"
            />
          </Field>
        </Section>

        <Section title="搜索引擎">
          <details className="rounded-panel border border-ink-200 bg-ink-50 px-3 py-2 text-sm">
            <summary className="cursor-pointer text-ink-700">填写规范</summary>
            <ul className="mt-2 space-y-1 text-xs leading-relaxed text-ink-600">
              <li>
                SEO 标题：含主关键词且靠前，中文 ≤ {SEO_LIMITS.metaTitle.recommendedCn} 字
                （约 {SEO_LIMITS.metaTitle.max} 字符）
              </li>
              <li>
                SEO 描述：中文 {SEO_LIMITS.metaDescription.recommendedCn} 字上下，含主关键词
                + 1 个长尾词，写读者收益而非正文摘抄
              </li>
              <li>
                关键词：{SEO_LIMITS.keywords.min}–{SEO_LIMITS.keywords.max} 个 = 1 个主关键词 +
                2–3 个次要 + 1–3 个长尾，第一个为主关键词
              </li>
              <li>canonical 留空即由系统生成；仅当同一内容也发在外站时才手填</li>
              <li>
                og 图 {SEO_LIMITS.ogImage.width}×{SEO_LIMITS.ogImage.height}，留空则回退正文首图
              </li>
            </ul>
          </details>

          <Field label="SEO 标题" errors={fieldErrors["seo.metaTitle"]}>
            <Input
              value={seo.metaTitle}
              onChange={(e) => onSeoChange({ ...seo, metaTitle: e.target.value })}
              placeholder="留空则使用文章标题"
            />
            <Meter
              current={titleWidth}
              max={SEO_LIMITS.metaTitle.max}
              hint={
                seo.keywords.length > 0 && !hitsPrimaryKeyword(seo.metaTitle, seo.keywords)
                  ? `未包含主关键词「${seo.keywords[0]}」`
                  : null
              }
            />
          </Field>

          <Field label="SEO 描述" errors={fieldErrors["seo.metaDescription"]}>
            <Textarea
              value={seo.metaDescription}
              onChange={(e) => onSeoChange({ ...seo, metaDescription: e.target.value })}
              rows={3}
            />
            <Meter
              current={descWidth}
              max={SEO_LIMITS.metaDescription.max}
              hint={
                seo.keywords.length > 0 &&
                !hitsPrimaryKeyword(seo.metaDescription, seo.keywords)
                  ? `未包含主关键词「${seo.keywords[0]}」`
                  : null
              }
            />
          </Field>

          <KeywordField
            keywords={seo.keywords}
            onAdd={addKeyword}
            onRemove={(k) =>
              onSeoChange({ ...seo, keywords: seo.keywords.filter((x) => x !== k) })
            }
            errors={fieldErrors["seo.keywords"]}
          />

          <Field label="Canonical URL" errors={fieldErrors["seo.canonicalUrl"]}>
            <Input
              value={seo.canonicalUrl}
              onChange={(e) => onSeoChange({ ...seo, canonicalUrl: e.target.value })}
              placeholder="留空由系统生成"
            />
          </Field>

          <Field label="og 图片路径">
            <Input
              value={seo.ogImage}
              onChange={(e) => onSeoChange({ ...seo, ogImage: e.target.value })}
              placeholder="/uploads/2026/02/cover.webp"
            />
          </Field>

          <Field label="robots">
            <Select
              value={seo.robots}
              onChange={(e) =>
                onSeoChange({
                  ...seo,
                  robots: e.target.value as SeoFormValues["robots"],
                })
              }
            >
              {ROBOTS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </Select>
          </Field>
        </Section>

        {isNew && (
          <p className="rounded-panel border border-ink-200 bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-500">
            这是新文章，保存后才会生成地址与版本记录。
          </p>
        )}
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// 分组容器
// ---------------------------------------------------------------------------

/** 抽屉内的字段分组。用标题 + 间距分组，不画卡片——抽屉本身已是容器 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
        {title}
      </h3>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 标签
// ---------------------------------------------------------------------------

function TagField({
  allTags,
  tagIds,
  onToggle,
  newTagNames,
  onNewTagNamesChange,
}: {
  allTags: { id: number; name: string }[];
  tagIds: number[];
  onToggle: (id: number) => void;
  newTagNames: string[];
  onNewTagNamesChange: (value: string[]) => void;
}) {
  const [input, setInput] = useState("");

  /**
   * 提交新标签名。
   *
   * 若输入的名字与既有标签重名，直接勾选那个标签而不是新建：
   * 否则保存时服务层 upsert 会把它们合成同一条，用户却看到两个标签被选中。
   */
  function commit() {
    const value = input.trim();
    if (!value) return;

    const existing = allTags.find((t) => t.name === value);
    if (existing) {
      if (!tagIds.includes(existing.id)) onToggle(existing.id);
    } else if (!newTagNames.includes(value)) {
      onNewTagNamesChange([...newTagNames, value]);
    }
    setInput("");
  }

  return (
    <Field label="标签" hint={`已选 ${tagIds.length}`}>
      <div className="flex flex-wrap gap-1.5">
        {allTags.map((t) => {
          const active = tagIds.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(t.id)}
              className={
                active
                  ? "rounded-panel bg-ink-900 px-2.5 py-1 text-xs text-white"
                  : "rounded-panel border border-ink-300 bg-white px-2.5 py-1 text-xs text-ink-700 transition-colors hover:bg-ink-50"
              }
            >
              {t.name}
            </button>
          );
        })}

        {newTagNames.map((name) => (
          <span
            key={name}
            className="inline-flex items-center gap-1 rounded-panel border border-dashed border-ink-400 px-2.5 py-1 text-xs text-ink-700"
          >
            {name}
            <span className="text-ink-400">新</span>
            <button
              type="button"
              aria-label={`取消新建标签 ${name}`}
              onClick={() => onNewTagNamesChange(newTagNames.filter((n) => n !== name))}
              className="text-ink-400 transition-colors hover:text-ink-900"
            >
              ×
            </button>
          </span>
        ))}

        {allTags.length === 0 && newTagNames.length === 0 && (
          <p className="text-xs text-ink-500">还没有标签，在下方输入即可新建</p>
        )}
      </div>

      {/* 现场新建：保存时由服务层 resolveTagIds 统一 upsert，
          不必先跳去标签页创建再回来 */}
      <div className="mt-2 flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          placeholder="输入标签名后回车"
        />
        <Button onClick={commit} className="shrink-0">
          添加
        </Button>
      </div>
    </Field>
  );
}

// ---------------------------------------------------------------------------
// 关键词
// ---------------------------------------------------------------------------

function KeywordField({
  keywords,
  onAdd,
  onRemove,
  errors,
}: {
  keywords: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
  errors?: string[];
}) {
  const [input, setInput] = useState("");

  function commit() {
    onAdd(input);
    setInput("");
  }

  return (
    <Field
      label="关键词"
      hint={`${keywords.length} / ${SEO_LIMITS.keywords.max}`}
      errors={errors}
    >
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          placeholder="输入后回车添加"
        />
        <Button onClick={commit} className="shrink-0">
          添加
        </Button>
      </div>

      {keywords.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {keywords.map((k, i) => (
            <span
              key={k}
              className="inline-flex items-center gap-1 rounded-panel bg-ink-100 px-2.5 py-1 text-xs text-ink-700"
            >
              {/* 首个关键词是主关键词，校验与提示都以它为准，需要让用户看清是哪个 */}
              {i === 0 && <span className="text-ink-400">主</span>}
              {k}
              <button
                type="button"
                aria-label={`移除关键词 ${k}`}
                onClick={() => onRemove(k)}
                className="text-ink-400 transition-colors hover:text-ink-900"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </Field>
  );
}

// ---------------------------------------------------------------------------
// 长度进度条
// ---------------------------------------------------------------------------

/** 字数进度条：超限变深色提示，未命中主关键词时给出说明 */
function Meter({
  current,
  max,
  hint,
}: {
  current: number;
  max: number;
  hint: string | null;
}) {
  const over = current > max;
  return (
    <div className="!mt-1.5 space-y-1">
      <div className="flex items-center gap-2 text-xs">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink-100">
          <div
            className={over ? "h-full bg-ink-900" : "h-full bg-ink-400"}
            style={{ width: `${Math.min(100, (current / max) * 100)}%` }}
          />
        </div>
        <span className={over ? "text-ink-900" : "text-ink-500"}>
          {current} / {max}
        </span>
      </div>
      {hint && <p className="text-xs text-ink-500">{hint}</p>}
    </div>
  );
}
