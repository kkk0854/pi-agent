/**
 * treeReducer 纯函数单测（fork/tree reducer 覆盖要求）。
 */
import { describe, expect, it } from 'vitest';
import type { ForkPoint, SessionTreeNode } from '@pi-agent/shared';
import { defaultForkPoint, findForkPoint, flattenTree, forkTitle, treeToOptions } from './treeReducer';

const TREE: SessionTreeNode[] = [
  {
    id: 'root',
    parentId: null,
    label: '主会话',
    type: 'root',
    children: [
      { id: 'a', parentId: 'root', label: '方案 A', type: 'session' },
      {
        id: 'b',
        parentId: 'root',
        label: '方案 B',
        type: 'session',
        children: [{ id: 'b1', parentId: 'b', label: 'B-子', type: 'session' }],
      },
    ],
  },
];

describe('flattenTree', () => {
  it('前序遍历按 depth 展开', () => {
    const flat = flattenTree(TREE);
    expect(flat.map((n) => `${n.depth}:${n.id}`)).toEqual(['0:root', '1:a', '1:b', '2:b1']);
  });
});

describe('treeToOptions', () => {
  it('生成带缩进的可选项', () => {
    const opts = treeToOptions(TREE);
    expect(opts).toContainEqual({ value: 'b1', label: expect.stringContaining('B-子') });
  });
});

describe('findForkPoint / defaultForkPoint', () => {
  const points: ForkPoint[] = [
    { entryId: 'e1', label: '会话开始' },
    { entryId: 'e2', label: '第 3 条消息后' },
  ];
  it('按 entryId 命中', () => {
    expect(findForkPoint(points, 'e2')?.label).toBe('第 3 条消息后');
  });
  it('默认选中「开始」', () => {
    expect(defaultForkPoint(points)?.entryId).toBe('e1');
  });
  it('空集返回 undefined', () => {
    expect(defaultForkPoint([])).toBeUndefined();
  });
});

describe('forkTitle', () => {
  it('带 entry label', () => {
    expect(forkTitle('主会话', '会话开始')).toBe('分叉：主会话 @ 会话开始');
  });
  it('缺省父标题回退', () => {
    expect(forkTitle(undefined, undefined)).toBe('分叉：会话');
  });
});
