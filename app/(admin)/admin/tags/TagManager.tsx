"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Hash, Pencil, Plus, Tag, Trash2 } from "lucide-react";

import { createTagAction, deleteTagAction, updateTagAction } from "@/server/actions/tag";
import type { TagWithCount } from "@/server/services/tag";
import {
  Button,
  Card,
  EmptyState,
  Field,
  IconButton,
  Input,
  cx,
} from "@/components/ui";
import {
  RowActions,
  Table,
  TableBody,
  TableEmptyRow,
  TableHead,
  TableSearch,
  TableToolbar,
  Td,
  Th,
  Tr,
} from "@/components/table";
import { Drawer } from "@/components/overlay";
import { useFeedback } from "@/components/feedback";

/**
 * 标签管理。
 *
 * 标签是扁平结构，比分类简单：只有名称与 slug 两个字段。
 * slug 留空时由服务层从名称转写，中文标签会退化为 tag-{随机后缀}。
 *
 * 布局与分类页保持一致（整宽表格 + 抽屉表单）：两个页面同属「分类与标签」
 * 这一组，形态不一致会让人以为是两套不同的东西。
 */

type SortMode = "name" | "usage";

export function TagManager({ tags }: { tags: TagWithCount[] }) {
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const [pending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("usage");
  const [adding, setAdding] = useState(false);

  /** 编辑中的标签；null 表示抽屉关闭 */
  const [editing, setEditing] = useState<TagWithCount | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);

  const open = adding || editing !== null;

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const matched = keyword
      ? tags.filter(
          (tag) =>
            tag.name.toLowerCase().includes(keyword) ||
            tag.slug.toLowerCase().includes(keyword)
        )
      : tags;

    // 复制一份再排：直接 sort 会原地改写 props 里的数组
    return [...matched].sort((a, b) =>
      sort === "usage"
        ? b.postCount - a.postCount || a.name.localeCompare(b.name, "zh-CN")
        : a.name.localeCompare(b.name, "zh-CN")
    );
  }, [tags, query, sort]);

  function openCreate() {
    setName("");
    setSlug("");
    setError(null);
    setEditing(null);
    setAdding(true);
  }

  function openEdit(tag: TagWithCount) {
    setName(tag.name);
    setSlug(tag.slug);
    setError(null);
    setAdding(false);
    setEditing(tag);
  }

  function close() {
    setAdding(false);
    setEditing(null);
    setError(null);
  }

  function submit() {
    setError(null);

    startTransition(async () => {
      const payload = { name, slug: slug.trim() || undefined };
      const result = editing
        ? await updateTagAction(editing.id, payload)
        : await createTagAction(payload);

      if (!result.ok) {
        setError(
          result.fieldErrors
            ? Object.values(result.fieldErrors).flat().join("；")
            : result.msg
        );
        return;
      }

      toast(result.msg, "success");
      close();
      router.refresh();
    });
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
        toast(result.msg, "error");
      }
    });
  }

  return (
    <>
      <Card className="overflow-hidden">
        <TableToolbar>
          <TableSearch
            value={query}
            onChange={setQuery}
            placeholder="搜索标签"
            label="搜索标签"
          />

          <span className="ml-auto flex items-center gap-1.5">
            {/* 分段控件：两个互斥的排序方式，用按钮组而非下拉——只有两项时下拉要多点一次 */}
            <span
              role="group"
              aria-label="排序方式"
              className="flex items-center rounded-panel border border-ink-300 bg-ink-50 p-0.5"
            >
              {(
                [
                  { mode: "usage", label: "按使用量" },
                  { mode: "name", label: "按名称" },
                ] as const
              ).map((option) => (
                <button
                  key={option.mode}
                  type="button"
                  aria-pressed={sort === option.mode}
                  onClick={() => setSort(option.mode)}
                  className={cx(
                    "cursor-pointer rounded-[4px] px-2.5 py-1 text-xs transition-colors duration-150",
                    "outline-none focus-visible:ring-2 focus-visible:ring-accent-500/45",
                    sort === option.mode
                      ? "bg-white font-medium text-ink-900 shadow-panel"
                      : "text-ink-500 hover:text-ink-800"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </span>

            <Button variant="primary" size="sm" onClick={openCreate}>
              <Plus size={14} />
              新建标签
            </Button>
          </span>
        </TableToolbar>

        <Table className="min-w-[30rem]">
          <TableHead>
            <tr>
              <Th>名称</Th>
              <Th className="hidden sm:table-cell">slug</Th>
              <Th align="right">文章</Th>
              <Th align="right">
                <span className="sr-only">操作</span>
              </Th>
            </tr>
          </TableHead>

          <TableBody>
            {visible.length === 0 ? (
              <TableEmptyRow colSpan={4}>
                {query ? (
                  <EmptyState
                    icon={<Tag size={20} />}
                    title={`没有匹配「${query}」的标签`}
                    description="换个关键词，或清空搜索查看全部。"
                  />
                ) : (
                  <EmptyState
                    icon={<Tag size={20} />}
                    title="还没有标签"
                    description="也可以在写文章时直接输入新标签名，系统会自动创建。"
                    action={
                      <Button variant="primary" size="sm" onClick={openCreate}>
                        <Plus size={14} />
                        新建标签
                      </Button>
                    }
                  />
                )}
              </TableEmptyRow>
            ) : (
              visible.map((tag) => (
                <Tr key={tag.id}>
                  <Td className="text-ink-900">
                    <span className="flex items-center gap-2">
                      <Hash size={14} className="shrink-0 text-ink-300" />
                      <span className="truncate">{tag.name}</span>
                    </span>
                  </Td>

                  <Td className="hidden font-mono text-xs text-ink-500 sm:table-cell">
                    {tag.slug}
                  </Td>

                  <Td align="right" className="tabular-nums text-ink-500">
                    {tag.postCount || <span className="text-ink-300">—</span>}
                  </Td>

                  <Td align="right">
                    <RowActions>
                      <IconButton
                        label={`编辑标签 ${tag.name}`}
                        title="编辑"
                        onClick={() => openEdit(tag)}
                      >
                        <Pencil size={15} />
                      </IconButton>
                      <IconButton
                        label={`删除标签 ${tag.name}`}
                        title="删除"
                        variant="danger"
                        disabled={pending}
                        onClick={() => remove(tag)}
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    </RowActions>
                  </Td>
                </Tr>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Drawer
        open={open}
        onClose={close}
        width="24rem"
        title={editing ? "编辑标签" : "新建标签"}
        description="标签是扁平的，一篇文章可以有多个"
        footer={
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={close}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={submit}
              disabled={pending || name.trim().length === 0}
            >
              {pending ? "保存中…" : editing ? "保存" : "创建"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {error && (
            <p
              role="alert"
              className="rounded-panel border border-danger-200 bg-danger-50 px-3 py-2 text-[13px] leading-relaxed text-danger-700"
            >
              {error}
            </p>
          )}

          <Field label="名称" htmlFor="tag-name">
            <Input
              id="tag-name"
              data-autofocus
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
        </div>
      </Drawer>
    </>
  );
}
