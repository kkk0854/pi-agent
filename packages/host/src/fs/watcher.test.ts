/**
 * fs watcher 纯函数单测（T04b · chokidar 配套）：summarizeEvents 去重/相对化/截断。
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { summarizeEvents, type WatcherEvent } from './watcher';

describe('summarizeEvents', () => {
  const root = 'C:/proj';

  it('去重同一路径的多次事件', () => {
    const events: WatcherEvent[] = [
      { path: 'C:/proj/a.ts', kind: 'add' },
      { path: 'C:/proj/a.ts', kind: 'change' },
      { path: 'C:/proj/b.ts', kind: 'change' },
    ];
    const out = summarizeEvents(events, root);
    expect(out.root).toBe(root);
    expect(out.paths.sort()).toEqual(['a.ts', 'b.ts']);
  });

  it('root 外路径保留绝对路径（相对化失败不丢信息）', () => {
    const out = summarizeEvents([{ path: 'D:/other/x.ts', kind: 'change' }], root);
    // Windows 上 path.resolve 会归一化分隔符：与 resolve 后的输入比较
    expect(out.paths).toEqual([path.resolve('D:/other/x.ts')]);
  });

  it('cap 截断（默认 50）', () => {
    const events: WatcherEvent[] = Array.from({ length: 60 }, (_, i) => ({
      path: `C:/proj/f${i}.ts`,
      kind: 'change' as const,
    }));
    const out = summarizeEvents(events, root);
    expect(out.paths).toHaveLength(50);
    // 自定义 cap
    expect(summarizeEvents(events, root, 5).paths).toHaveLength(5);
  });
});
