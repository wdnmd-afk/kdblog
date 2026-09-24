"use client";

import { useCallback, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

import { cx } from "./ui";

/**
 * 树形表格。
 *
 * 为什么需要它：分类是自引用树，此前的实现只用 paddingLeft 做缩进，
 * 层级关系全靠肉眼对齐猜测——三层以上就分不清某项属于哪个父级，
 * 而且无法折叠，分类多了整页都是平铺的行。
 *
 * 设计取舍：
 *
 * 1. **缩进 + 折叠三角，不做拖拽排序**。拖拽要引入 dnd 库、处理触屏长按、
 *    还要设计"放到某项之间"与"放进某项内部"的区别，成本远超收益——
 *    改父级用表单里的下拉即可，分类调层级是低频操作。
 *
 * 2. **不画树形连接线（├─ 这类竖线）**。苹果的 Finder 列表视图同样只有缩进
 *    与折叠三角，没有连接线：连接线在层级浅时是噪音，深时又会糊成一片。
 *
 * 3. **折叠状态默认全展开且不持久化**。分类量小（几十个），一眼看全整棵树比
 *    记住上次折叠到哪更有用；持久化要引入 localStorage 与"新分类该展开吗"
 *    这类边界判断，不值得。
 *
 * 4. **展开状态用「已折叠集合」而非「已展开集合」**。这样新增的分类天然是展开的，
 *    不必在数据变化时同步补进集合里。
 */

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 树节点的最小约束：调用方的数据只要能给出 id 与 children 即可 */
export interface TreeNodeLike {
  id: number;
  children: TreeNodeLike[];
}

/** 渲染时传给调用方的行信息 */
export interface TreeRow<T> {
  node: T;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
  /** 该节点及其所有后代的数量（不含自身），用于折叠时提示「内含 N 项」 */
  descendantCount: number;
}

// ---------------------------------------------------------------------------
// 展开/折叠状态
// ---------------------------------------------------------------------------

/**
 * 树的折叠状态与可见行计算。
 *
 * 抽成 hook 而非塞进组件：分类页需要在工具栏里放「全部展开/折叠」按钮，
 * 那需要在表格外部拿到并操作同一份状态。
 */
export function useTreeState<T extends TreeNodeLike>(
  tree: T[],
  options: {
    /**
     * 无视折叠状态、强制全展开。
     *
     * 给搜索用：过滤后的树只剩「命中项 + 其祖先」，此时若某个祖先恰好是折叠的，
     * 命中项就会被藏起来——用户明明搜到了却看不见。这里不清空 collapsedIds，
     * 而是渲染时绕过它，清空搜索后用户原先的折叠状态还在。
     */
    forceExpand?: boolean;
  } = {}
) {
  const { forceExpand = false } = options;
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set());

  const toggle = useCallback((id: number) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      // Set 必须换新对象，原地 add/delete 不会触发重渲染
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    // 只折叠有子节点的项：把叶子放进集合里没有意义，还会让 hasCollapsed 判断失真
    const ids = new Set<number>();
    const walk = (nodes: T[]) => {
      for (const node of nodes) {
        if (node.children.length > 0) {
          ids.add(node.id);
          walk(node.children as T[]);
        }
      }
    };
    walk(tree);
    setCollapsedIds(ids);
  }, [tree]);

  const expandAll = useCallback(() => setCollapsedIds(new Set()), []);

  /**
   * 拍平成可见行。
   *
   * 折叠的节点自身仍然可见，只是不再递归它的子树——
   * 这是折叠的定义，容易写错成把节点本身也跳过。
   */
  const rows = useMemo(() => {
    const out: TreeRow<T>[] = [];

    const walk = (nodes: T[], depth: number) => {
      for (const node of nodes) {
        const children = node.children as T[];
        // forceExpand 时不读 collapsedIds，但也不清空它——搜索结束后原折叠状态还在
        const collapsed = !forceExpand && collapsedIds.has(node.id);
        out.push({
          node,
          depth,
          hasChildren: children.length > 0,
          collapsed,
          descendantCount: countDescendants(node),
        });
        if (!collapsed) walk(children, depth + 1);
      }
    };

    walk(tree, 0);
    return out;
  }, [tree, collapsedIds, forceExpand]);

  /** 树里是否存在可折叠项，用于决定「全部展开/折叠」按钮是否可用 */
  const hasBranches = useMemo(() => tree.some((n) => n.children.length > 0), [tree]);

  return {
    rows,
    toggle,
    collapseAll,
    expandAll,
    hasBranches,
    allCollapsed: hasBranches && rows.every((r) => !r.hasChildren || r.collapsed),
  };
}

function countDescendants(node: TreeNodeLike): number {
  return node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0);
}

// ---------------------------------------------------------------------------
// 展开按钮与缩进
// ---------------------------------------------------------------------------

/** 每级缩进宽度。20px 略大于三角图标本身，层级才看得出台阶感 */
const INDENT_STEP = 22;

/**
 * 首列的层级前缀：缩进 + 折叠三角。
 *
 * 叶子节点渲染一个等宽占位而不是什么都不放，否则叶子与分支的文字起点会错开，
 * 同一层级的名称对不齐。
 *
 * 三角用 rotate 而非换图标：换图标会在切换瞬间闪一下，
 * 旋转是连续变化，也符合苹果 Finder 的动效。
 */
export function TreeToggle({
  depth,
  hasChildren,
  collapsed,
  label,
  onToggle,
}: {
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
  /** 无障碍名称，需说明操作的是哪一项 */
  label: string;
  onToggle: () => void;
}) {
  return (
    <span
      className="flex shrink-0 items-center"
      style={{ paddingLeft: depth * INDENT_STEP }}
    >
      {hasChildren ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? `展开 ${label}` : `折叠 ${label}`}
          aria-expanded={!collapsed}
          className={cx(
            "flex size-5 cursor-pointer items-center justify-center rounded text-ink-400",
            "transition-colors duration-150 hover:bg-ink-200/70 hover:text-ink-700",
            "outline-none focus-visible:ring-2 focus-visible:ring-accent-500/45"
          )}
        >
          <ChevronRight
            size={14}
            className={cx(
              "transition-transform duration-200 motion-reduce:transition-none",
              !collapsed && "rotate-90"
            )}
          />
        </button>
      ) : (
        // 叶子占位：宽度与按钮一致，保证同层文字左边缘对齐
        <span aria-hidden="true" className="size-5" />
      )}
    </span>
  );
}
