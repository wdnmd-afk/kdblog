"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Tag, Trash2 } from "lucide-react";

import { createTagAction, deleteTagAction, updateTagAction } from "@/server/actions/tag";
import type { TagWithCount } from "@/server/services/tag";
import { Badge, Button, Card, EmptyState, Field, Input } from "@/components/ui";
import { useFeedback } from "@/components/feedback";

/**
 * 标签管理。
 *
 * 标签是扁平结构，比分类简单：只有名称与 slug 两个字段。
 * slug 留空时由服务层从名称转写，中文标签会退化为 tag-{随机后缀}。
 */
export function TagManager({ tags }: { tags: TagWithCount[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { toast, confirm } = useFeedback();
  /** 只承载表单字段校验错误；操作结果统一走 toast */
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);

  function resetForm() {
    setName("");
    setSlug("");
    setEditingId(null);
    setError(null);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const payload = { name, slug: slug.trim() || undefined };
      const result = editingId
        ? await updateTagAction(editingId, payload)
        : await createTagAction(payload);

      if (!result.ok) {
        setError(result.fieldErrors ? Object.values(result.fieldErrors).flat().join("；") : result.error);
        return;
      }
      toast(editingId ? "标签已更新" : "标签已创建", "success");
      resetForm();
      router.refresh();
    });
  }

  function startEdit(tag: TagWithCount) {
    setEditingId(tag.id);
    setName(tag.name);
    setSlug(tag.slug);
    setError(null);
  }

  async function remove(tag: TagWithCount) {
    // 标签删除只解除文章关联，不影响文章本身，因此提示语比分类温和
    const ok = await confirm({
      title: `删除标签「${tag.name}」？`,
      description:
        tag.postCount > 0
          ? `有 ${tag.postCount} 篇文章使用该标签，删除后这些文章会失去它，但文章本身不受影响。`
          : "该标签还没有被任何文章使用。",
      confirmLabel: "删除",
      danger: true,
    });
    if (!ok) return;

    startTransition(async () => {
      const result = await deleteTagAction(tag.id);
      if (result.ok) {
        toast(`标签「${tag.name}」已删除`, "success");
        router.refresh();
      } else {
        toast(result.error, "error");
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <Card className="p-4">
        <h2 className="mb-3 text-sm font-medium text-ink-900">
          {editingId ? "编辑标签" : "新建标签"}
        </h2>

        <div className="space-y-3">
          <Field label="名称" htmlFor="tag-name">
            <Input
              id="tag-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：性能优化"
            />
          </Field>

          <Field label="slug" hint="留空自动生成" htmlFor="tag-slug">
            <Input
              id="tag-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="font-mono"
              placeholder="performance"
            />
          </Field>

          {error && (
            <p className="rounded-panel border border-ink-300 bg-ink-50 px-3 py-2 text-xs text-ink-900">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              variant="primary"
              size="sm"
              onClick={submit}
              disabled={pending || name.trim().length === 0}
            >
              {pending ? "处理中…" : editingId ? "保存" : "创建"}
            </Button>
            {editingId && (
              <Button variant="secondary" size="sm" onClick={resetForm}>
                取消
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <h2 className="border-b border-ink-200 bg-ink-50 px-4 py-2.5 text-xs font-medium text-ink-500">
          全部标签（{tags.length}）
        </h2>

        {tags.length === 0 ? (
          <EmptyState
            icon={<Tag size={20} />}
            title="还没有标签"
            description="也可以在写文章时直接输入新标签名，系统会自动创建。"
          />
        ) : (
          /* 用行列表而非胶囊墙：操作按钮要常驻占位才能被键盘聚焦，
             胶囊里预留两个按钮的宽度会把每个标签撑得很宽，行布局没这个问题 */
          <ul className="divide-y divide-ink-100">
            {tags.map((tag) => (
              <li
                key={tag.id}
                className="group flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-ink-50/70"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm text-ink-900">{tag.name}</span>
                  <span className="font-mono text-xs text-ink-400">/{tag.slug}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <Badge tone="neutral">{tag.postCount}</Badge>
                  {/* 操作按钮常驻但降透明度，hover / 键盘聚焦时显形，避免焦点落到不可见元素 */}
                  <span className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => startEdit(tag)}
                      title="编辑"
                      aria-label={`编辑标签 ${tag.name}`}
                    >
                      <Pencil size={16} />
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => remove(tag)}
                      disabled={pending}
                      title="删除"
                      aria-label={`删除标签 ${tag.name}`}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
