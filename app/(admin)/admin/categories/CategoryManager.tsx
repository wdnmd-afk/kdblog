"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CornerDownRight, FolderTree, Pencil, Trash2 } from "lucide-react";

import {
  createCategoryAction,
  deleteCategoryAction,
  updateCategoryAction,
} from "@/server/actions/category";
import type { CategoryNode } from "@/server/services/category";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Textarea,
} from "@/components/ui";
import { useFeedback } from "@/components/feedback";

/**
 * 分类管理器。
 *
 * 树形结构以缩进展示而非拖拽：分类量通常很小，缩进 + 父级下拉已经够用，
 * 省掉拖拽库的体积与触屏适配成本。
 */

interface Props {
  tree: CategoryNode[];
  /** 扁平化的分类列表，供「父分类」下拉使用 */
  flat: { id: number; name: string; depth: number }[];
}

interface FormState {
  id?: number;
  name: string;
  slug: string;
  description: string;
  parentId: number | null;
}

const EMPTY_FORM: FormState = { name: "", slug: "", description: "", parentId: null };

export default function CategoryManager({ tree, flat }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast, confirm } = useFeedback();

  const isEditing = form.id !== undefined;

  function submit() {
    setError(null);
    startTransition(async () => {
      const payload = {
        name: form.name,
        slug: form.slug,
        description: form.description || undefined,
        parentId: form.parentId,
      };

      const result = isEditing
        ? await updateCategoryAction(form.id!, payload)
        : await createCategoryAction(payload);

      if (!result.ok) {
        // 字段级错误合并成一行展示，分类表单字段少，不必逐字段标注
        const detail = result.fieldErrors
          ? Object.values(result.fieldErrors).flat().join("；")
          : result.error;
        setError(detail);
        return;
      }
      toast(isEditing ? "分类已更新" : `分类「${form.name}」已创建`, "success");
      setForm(EMPTY_FORM);
      router.refresh();
    });
  }

  /**
   * 删除分类。
   *
   * 分类删除不是软删，但后果有限（文章只是失去分类归属），
   * 因此确认文案说明影响即可，不必像彻底删除内容那样强调不可恢复。
   */
  async function remove(id: number, name: string) {
    const ok = await confirm({
      title: `删除分类「${name}」？`,
      description: "该分类下的文章会变为「未分类」，文章本身不受影响。",
      confirmLabel: "删除",
      danger: true,
    });
    if (!ok) return;

    setError(null);
    startTransition(async () => {
      const result = await deleteCategoryAction(id);
      if (result.ok) {
        toast(`分类「${name}」已删除`, "success");
        router.refresh();
      } else {
        toast(result.error, "error");
      }
    });
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      <Card className="overflow-hidden">
        {tree.length === 0 ? (
          <EmptyState
            icon={<FolderTree size={20} />}
            title="还没有分类"
            description="先在右侧创建一个，之后可以随时调整层级。"
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {flat.map((item) => (
              <li
                key={item.id}
                className="group flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-ink-50/70"
              >
                <span
                  className="flex items-center gap-1.5 text-sm text-ink-800"
                  style={{ paddingLeft: item.depth * 20 }}
                >
                  {item.depth > 0 && <CornerDownRight size={14} className="text-ink-300" />}
                  {item.name}
                </span>
                {/* 操作按钮常驻但降透明度，hover / 键盘聚焦时显形，避免焦点落到不可见元素 */}
                <span className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <Button
                    variant="ghost"
                    size="sm"
                    title="编辑"
                    aria-label={`编辑分类 ${item.name}`}
                    onClick={() => {
                      const node = findNode(tree, item.id);
                      if (!node) return;
                      setForm({
                        id: node.id,
                        name: node.name,
                        slug: node.slug,
                        description: node.description ?? "",
                        parentId: node.parentId,
                      });
                    }}
                  >
                    <Pencil size={16} />
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    title="删除"
                    aria-label={`删除分类 ${item.name}`}
                    onClick={() => remove(item.id, item.name)}
                  >
                    <Trash2 size={16} />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="mb-4 text-sm font-medium text-ink-900">
          {isEditing ? "编辑分类" : "新建分类"}
        </h2>

        {error && (
          <p className="mb-3 rounded-panel border border-ink-300 bg-ink-50 px-3 py-2 text-xs text-ink-900">
            {error}
          </p>
        )}

        <div className="space-y-3">
          <Field label="名称" htmlFor="category-name">
            <Input
              id="category-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>

          <Field label="slug" hint="小写字母、数字与连字符" htmlFor="category-slug">
            <Input
              id="category-slug"
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              className="font-mono"
            />
          </Field>

          <Field label="父分类" htmlFor="category-parent">
            <Select
              id="category-parent"
              value={form.parentId ?? ""}
              onChange={(e) =>
                setForm({ ...form, parentId: e.target.value ? Number(e.target.value) : null })
              }
            >
              <option value="">（顶级分类）</option>
              {flat
                // 编辑时排除自身，避免选成自己的父级；更深的环由服务层的 wouldCreateCycle 兜住
                .filter((item) => item.id !== form.id)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {"　".repeat(item.depth)}
                    {item.name}
                  </option>
                ))}
            </Select>
          </Field>

          <Field label="描述" htmlFor="category-description">
            <Textarea
              id="category-description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
            />
          </Field>

          <div className="flex gap-2 pt-1">
            <Button
              variant="primary"
              size="sm"
              onClick={submit}
              disabled={pending || !form.name || !form.slug}
            >
              {pending ? "保存中…" : isEditing ? "保存" : "创建"}
            </Button>
            {isEditing && (
              <Button variant="secondary" size="sm" onClick={() => setForm(EMPTY_FORM)}>
                取消
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

/** 在树中按 id 查找节点，用于点「编辑」时回填表单 */
function findNode(nodes: CategoryNode[], id: number): CategoryNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}
