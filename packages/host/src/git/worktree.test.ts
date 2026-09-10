/**
 * worktree 解析与净化单测（T04b · G-01/G-02）：porcelain 输出解析 + 分支名白名单。
 */
import { describe, expect, it } from 'vitest';
import { parseWorktreeList, sanitizeBranchName } from './worktree';

const SAMPLE = [
  'worktree D:/repo',
  'HEAD 8f3a1c2',
  'branch refs/heads/main',
  '',
  'worktree D:/repo/.worktrees/feat-x',
  'HEAD ab12cd3',
  'branch refs/heads/feat/x',
  '',
  'worktree C:/bare.git',
  'HEAD deadbeef',
  'bare',
  '',
  'worktree D:/repo/.worktrees/detached',
  'HEAD 1234567',
  'detached',
  '',
].join('\n');

describe('parseWorktreeList', () => {
  it('解析主 worktree + 分支 + bare/detached', () => {
    const items = parseWorktreeList(SAMPLE, 'D:/repo');
    expect(items).toHaveLength(4);

    const main = items.find((w) => w.isMain);
    expect(main?.path).toBe('D:/repo');
    expect(main?.branch).toBe('main');
    expect(main?.head).toBe('8f3a1c2');

    const feat = items.find((w) => w.branch === 'feat/x');
    expect(feat?.isMain).toBe(false);
    expect(feat?.head).toBe('ab12cd3');

    const bare = items.find((w) => w.path.includes('bare.git'));
    expect(bare?.branch).toBeNull();

    const detached = items.find((w) => w.path.includes('detached'));
    expect(detached?.branch).toBeNull();
  });

  it('cwd 不在列表中时路径最短者视为主', () => {
    const items = parseWorktreeList(
      ['worktree D:/repo/nested/wt-a', 'HEAD aaa', 'branch refs/heads/a', '',
       'worktree D:/short', 'HEAD bbb', 'branch refs/heads/b', ''].join('\n'),
      'X:/elsewhere',
    );
    expect(items.find((w) => w.isMain)?.path).toBe('D:/short');
  });

  it('空输出 → 空数组', () => {
    expect(parseWorktreeList('', 'D:/repo')).toEqual([]);
  });
});

describe('sanitizeBranchName', () => {
  it('保留合法字符', () => {
    expect(sanitizeBranchName('feat/login-page')).toBe('feat/login-page');
  });

  it('替换非法字符并去掉首尾点划线', () => {
    expect(sanitizeBranchName('feat 01 beta!')).toBe('feat-01-beta');
    expect(sanitizeBranchName('..bad..name..')).toBe('bad..name');
  });

  it('全非法（含纯中文）→ 回退 worktree', () => {
    expect(sanitizeBranchName('  我的功能!! ')).toBe('worktree');
    expect(sanitizeBranchName('!!!')).toBe('worktree');
    expect(sanitizeBranchName('')).toBe('worktree');
  });
});
