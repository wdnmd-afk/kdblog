"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Folder,
  FolderOpen,
  FolderTree,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import {
  createCategoryAction,
  deleteCategoryAction,
  updateCategoryAction,
} from "@/server/actions/category";
import type { CategoryNode } from "@/server/services/category";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  IconButton,
  Input,
  Select,
  Textarea,
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
import { TreeToggle, useTreeState } from "@/components/tree-table";
import { Drawer } from "@/components/overlay";
import { useFeedback } from "@/components/feedback";

/**
 * 分类管理器。
 *
 * 此前的实现把「列表」与「表单」并排放在同一屏：表单常驻右侧占掉 320px，
 * 而分类的字段只有四个、编辑频率又低，等于用三分之一的宽度换一个几乎不用的面板，
 * 层级本身却被挤在剩下的窄列里看不清。
 *
 * 现在改为「整宽树形表格 + 抽屉表单」：
 * - 层级关系是这个页面的主体信息，给它整个宽度
 * - 新建/编辑走抽屉，打开时才占空间，且字段可以从容排布
 *
 * 仍然不做拖拽调层级（理由见 components/tree-table.tsx）：改父级用表单里的下拉。
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
  const { toast, confirm } = useFeedback();
  const [pending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  /** null 表示抽屉关闭；抽屉的开关与表单内容是同一份状态，避免关闭瞬间字段闪回 */
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => filterTree(tree, query.trim().toLowerCase()), [tree, query]);

  /**
   * 搜索时强制展开：过滤后的树只保留「命中项 + 其祖先」，
   * 若某个祖先恰好处于折叠状态，命中项就会被藏起来。
   */
  const { rows, toggle, collapseAll, expandAll, hasBranches, allCollapsed } = useTreeState(
    filtered,
    { forceExpand: query.trim().length > 0 }
  );

  const isEditing = form?.id !== undefined;

  function openCreate(parentId: number | null = null) {
    setError(null);
    setForm({ ...EMPTY_FORM, parentId });
  }

  function openEdit(node: CategoryNode) {
    setError(null);
    setForm({
      id: node.id,
      name: node.name,
      slug: node.slug,
      description: node.description ?? "",
      parentId: node.parentId,
    });
  }

  function submit() {
    if (!form) return;
    setError(null);

    startTransition(async () => {
      const payload = {
        name: form.name,
        slug: form.slug,
        description: form.description || undefined,
        parentId: form.parentId,
      };

      const result = form.id
        ? await updateCategoryAction(form.id, payload)
        : await createCategoryAction(payload);

      if (!result.ok) {
        // 字段级错误合并成一行展示：分类表单只有四个字段，逐字段标注的收益不大
        setError(
          result.fieldErrors
            ? Object.values(result.fieldErrors).flat().join("；")
            : result.error
        );
        return;
      }

      toast(form.id ? "分类已更新" : `分类「${form.name}」已创建`, "success");
      setForm(null);
      router.refresh();
    });
  }

  /**
   * 删除分类。
   *
   * 分类删除不是软删，但后果有限（文章只是失去分类归属），
   * 因此确认文案说明影响即可，不必像彻底删除内容那样强调不可恢复。
   */
  async function remove(node: CategoryNode) {
    const ok = await confirm({
      title: `删除分类「${node.name}」？`,
      description:
        node.postCount > 0
          ? `该分类下 ${node.postCount} 篇文章会变为「未分类」，文章本身不受影响。`
          : "该分类下没有文章。",
      confirmLabel: "删除",
      danger: true,
    });
    if (!ok) return;

    startTransition(async () => {
      const result = await deleteCategoryAction(node.id);
      if (result.ok) {
        toast(`分类「${node.name}」已删除`, "success");
        router.refresh();
      } else {
        toast(result.error, "error");
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
            placeholder="搜索分类"
            label="搜索分类"
          />

          <span className="ml-auto flex items-center gap-1.5">
            {/* 只有存在层级时才给展开/折叠：全是顶级分类时这个按钮点了没反应，等于死键 */}
            {hasBranches && (
              <Button
                size="sm"
                onClick={allCollapsed ? expandAll : collapseAll}
                title={allCollapsed ? "展开全部层级" : "折叠全部层级"}
              >
                {allCollapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
                {allCollapsed ? "展开全部" : "折叠全部"}
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={() => openCreate()}>
              <Plus size={14} />
              新建分类
            </Button>
          </span>
        </TableToolbar>

        <Table>
          <TableHead>
            <tr>
              <Th>名称</Th>
              <Th className="hidden sm:table-cell">slug</Th>
              <Th align="right">文章</Th>
              <Th align="right">
                {/* 操作列的表头留空但保留 scope：列本身需要被读屏软件计数 */}
                <span className="sr-only">操作</span>
              </Th>
            </tr>
          </TableHead>

          <TableBody>
            {rows.length === 0 ? (
              <TableEmptyRow colSpan={4}>
                {query ? (
                  <EmptyState
                    icon={<FolderTree size={20} />}
                    title={`没有匹配「${query}」的分类`}
                    description="换个关键词，或清空搜索查看全部。"
                  />
                ) : (
                  <EmptyState
                    icon={<FolderTree size={20} />}
                    title="还没有分类"
                    description="分类支持多级嵌套，建好之后可以随时调整层级。"
                    action={
                      <Button variant="primary" size="sm" onClick={() => openCreate()}>
                        <Plus size={14} />
                        新建分类
                      </Button>
                    }
                  />
                )}
              </TableEmptyRow>
            ) : (
              rows.map(({ node, depth, hasChildren, collapsed, descendantCount }) => (
                <Tr key={node.id}>
                  <Td className="text-ink-900">
                    <span className="flex items-center gap-1.5">
                      <TreeToggle
                        depth={depth}
                        hasChildren={hasChildren}
                        collapsed={collapsed}
                        label={node.name}
                        onToggle={() => toggle(node.id)}
                      />

                      {/* 图标区分分支与叶子：折叠的分支用闭合文件夹，是 Finder 的约定 */}
                      {hasChildren ? (
                        collapsed ? (
                          <Folder size={14} className="shrink-0 text-ink-400" />
                        ) : (
                          <FolderOpen size={14} className="shrink-0 text-ink-400" />
                        )
                      ) : (
                        <Folder size={14} className="shrink-0 text-ink-300" />
                      )}

                      <span className={cx("truncate", depth === 0 && "font-medium")}>
                        {node.name}
                      </span>

                      {/* 折叠时提示内含多少项，否则用户不知道折起来的是一项还是二十项 */}
                      {collapsed && descendantCount > 0 && (
                        <Badge tone="outline" className="shrink-0 tabular-nums">
                          {descendantCount}
                        </Badge>
                      )}
                    </span>
                  </Td>

                  <Td className="hidden font-mono text-xs text-ink-500 sm:table-cell">
                    {node.slug}
                  </Td>

                  <Td align="right" className="tabular-nums text-ink-500">
                    {node.postCount || <span className="text-ink-300">—</span>}
                  </Td>

                  <Td align="right">
                    <RowActions>
                      <IconButton
                        label={`在「${node.name}」下新建子分类`}
                        title="新建子分类"
                        onClick={() => openCreate(node.id)}
                      >
                        <Plus size={15} />
                      </IconButton>
                      <IconButton
                        label={`编辑分类 ${node.name}`}
                        title="编辑"
                        onClick={() => openEdit(node)}
                      >
                        <Pencil size={15} />
                      </IconButton>
                      {/**
                       * 有子分类时禁用删除而不是让它报错：服务层会拒绝（避免孤儿节点），
                       * 与其点了才弹失败提示，不如提前说明原因。
                       */}
                      <IconButton
                        label={`删除分类 ${node.name}`}
                        title={hasChildren ? "请先删除或移走子分类" : "删除"}
                        variant="danger"
                        disabled={pending || hasChildren}
                        onClick={() => remove(node)}
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
        open={form !== null}
        onClose={() => setForm(null)}
        title={isEditing ? "编辑分类" : "新建分类"}
        description={
          isEditing ? "改动会立即应用到已归属该分类的文章" : "可以先建好层级，之后再写文章"
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setForm(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={submit}
              disabled={pending || !form?.name.trim() || !form?.slug.trim()}
            >
              {pending ? "保存中…" : isEditing ? "保存" : "创建"}
            </Button>
          </div>
        }
      >
        {form && (
          <div className="space-y-4">
            {error && (
              <p
                role="alert"
                className="rounded-panel border border-danger-200 bg-danger-50 px-3 py-2 text-[13px] leading-relaxed text-danger-700"
              >
                {error}
              </p>
            )}

            <Field label="名称" htmlFor="category-name">
              <Input
                id="category-name"
                data-autofocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例：技术笔记"
              />
            </Field>

            <Field label="slug" hint="小写字母、数字与连字符" htmlFor="category-slug">
              <Input
                id="category-slug"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                className="font-mono"
                placeholder="tech-notes"
              />
            </Field>

            <Field label="父分类" hint="留空为顶级" htmlFor="category-parent">
              <Select
                id="category-parent"
                value={form.parentId ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    parentId: e.target.value ? Number(e.target.value) : null,
                  })
                }
              >
                <option value="">（顶级分类）</option>
                {flat
                  /**
                   * 排除自身与自己的后代：把节点挂到自己的子树下会形成环。
                   * 服务层的 wouldCreateCycle 仍会兜底，但选项里就不该出现
                   * 一个选了必然报错的条目。
                   */
                  .filter((item) => !isSelfOrDescendant(tree, form.id, item.id))
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {"　".repeat(item.depth)}
                      {item.name}
                    </option>
                  ))}
              </Select>
            </Field>

            <Field label="描述" hint="选填" htmlFor="category-description">
              <Textarea
                id="category-description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                placeholder="这个分类收录什么内容"
              />
            </Field>
          </div>
        )}
      </Drawer>
    </>
  );
}

// ---------------------------------------------------------------------------
// 树的辅助计算
// ---------------------------------------------------------------------------

/**
 * 按关键词过滤树，保留命中项及其所有祖先。
 *
 * 只保留命中项会让层级断裂——子分类脱离父级单独出现，用户无法判断它属于哪里。
 * 因此父级即使自己不匹配，只要有后代匹配就一并保留。
 */
function filterTree(nodes: CategoryNode[], keyword: string): CategoryNode[] {
  if (!keyword) return nodes;

  return nodes.flatMap((node) => {
    const children = filterTree(node.children, keyword);
    const hit =
      node.name.toLowerCase().includes(keyword) || node.slug.toLowerCase().includes(keyword);

    if (!hit && children.length === 0) return [];
    // 命中的节点保留完整子树，仅因后代命中而保留的节点只带上命中的分支
    return [{ ...node, children: hit ? node.children : children }];
  });
}

/** candidateId 是否为 selfId 本身或其后代。selfId 为空（新建）时恒为 false */
function isSelfOrDescendant(
  nodes: CategoryNode[],
  selfId: number | undefined,
  candidateId: number
): boolean {
  if (selfId === undefined) return false;
  if (selfId === candidateId) return true;

  const self = findNode(nodes, selfId);
  if (!self) return false;

  const walk = (list: CategoryNode[]): boolean =>
    list.some((n) => n.id === candidateId || walk(n.children));
  return walk(self.children);
}

function findNode(nodes: CategoryNode[], id: number): CategoryNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}
