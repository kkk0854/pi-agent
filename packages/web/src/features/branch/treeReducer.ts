/**
 * 分支树 / fork 点的纯函数归约（F-01..F-05）：
 * - flattenTree：SessionTreeNode 树 → 扁平列表（渲染前序遍历，带 depth 用于缩进）。
 * - findForkPoint：按 entryId 取 fork 点。
 * - defaultForkPoint：默认选中（首个，通常是「会话开始」）。
 * 纯函数，便于单测（fork/tree reducer 单测覆盖）。
 */
import type { ForkPoint, SessionTreeNode } from '@pi-agent/shared';

export interface FlatTreeNode {
  id: string;
  parentId: string | null;
  label: string;
  type: string;
  depth: number;
}

/** 前序遍历展开为带 depth 的扁平列表（用于缩进渲染与单选） */
export function flattenTree(tree: SessionTreeNode[], depth = 0, acc: FlatTreeNode[] = []): FlatTreeNode[] {
  for (const node of tree) {
    acc.push({
      id: String(node.id),
      parentId: node.parentId != null ? String(node.parentId) : null,
      label: String(node.label ?? node.id),
      type: String(node.type ?? 'session'),
      depth,
    });
    const children = Array.isArray(node.children) ? node.children : [];
    flattenTree(children, depth + 1, acc);
  }
  return acc;
}

/** 树 → 可选项（label 按 depth 缩进），用于下拉导航 */
export function treeToOptions(tree: SessionTreeNode[]): { value: string; label: string }[] {
  return flattenTree(tree).map((n) => ({
    value: n.id,
    label: `${'  '.repeat(n.depth)}${n.label}`,
  }));
}

/** 按 entryId 取 fork 点（F-02） */
export function findForkPoint(points: ForkPoint[], entryId: string): ForkPoint | undefined {
  return points.find((p) => p.entryId === entryId);
}

/** 默认 fork 点：优先第一个，其次按其 label 含「开始」者，均无则 undefined */
export function defaultForkPoint(points: ForkPoint[]): ForkPoint | undefined {
  if (points.length === 0) return undefined;
  return points.find((p) => /开始|root|start/i.test(p.label)) ?? points[0]!;
}

/** 计算分叉后新建会话标题（F-03 截断上下文的可读标识） */
export function forkTitle(parentTitle: string | undefined, entryLabel: string | undefined): string {
  const base = parentTitle && parentTitle.length > 0 ? parentTitle : '会话';
  if (entryLabel && entryLabel.length > 0) return `分叉：${base} @ ${entryLabel}`;
  return `分叉：${base}`;
}
