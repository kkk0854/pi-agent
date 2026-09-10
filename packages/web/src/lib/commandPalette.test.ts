/**
 * commandPalette 纯函数单测（P-06 过滤逻辑）。
 */
import { describe, expect, it } from 'vitest';
import type { CommandItem } from './commandPalette';
import { filterCommands, groupCommands } from './commandPalette';

function make(items: { id: string; title: string; group: string; keywords?: string }[]): CommandItem[] {
  return items.map((i) => ({ ...i, run: () => undefined }));
}

describe('filterCommands', () => {
  const items = make([
    { id: 'new', title: '新建会话', group: '会话', keywords: 'new session' },
    { id: 'jump', title: '跳转到会话', group: '会话', keywords: 'jump go' },
    { id: 'dark', title: '切换到暗色主题', group: '主题', keywords: 'theme dark' },
    { id: 'diag', title: '运行诊断', group: '治理', keywords: 'doctor diagnose' },
  ]);

  it('空查询返回全量（保序）', () => {
    const out = filterCommands(items, '   ');
    expect(out.map((i) => i.id)).toEqual(['new', 'jump', 'dark', 'diag']);
  });

  it('单关键词中文命中', () => {
    expect(filterCommands(items, '会话').map((i) => i.id)).toEqual(['new', 'jump']);
  });

  it('英文 keyword 命中', () => {
    expect(filterCommands(items, 'doctor').map((i) => i.id)).toEqual(['diag']);
  });

  it('多词 AND 语义', () => {
    // “切 暗”需同时命中 title/group/keywords
    expect(filterCommands(items, '暗 主题').map((i) => i.id)).toEqual(['dark']);
    // 不存在的组合返回空
    expect(filterCommands(items, '会话 doctor')).toHaveLength(0);
  });
});

describe('groupCommands', () => {
  it('按 group 分组并保持组内顺序', () => {
    const groups = groupCommands(make([
      { id: 'a', title: 'A', group: '会话' },
      { id: 'b', title: 'B', group: '主题' },
      { id: 'c', title: 'C', group: '会话' },
    ]));
    expect(groups.map((g) => g.group)).toEqual(['会话', '主题']);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['a', 'c']);
  });
});
