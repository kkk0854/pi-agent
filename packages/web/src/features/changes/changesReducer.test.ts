/** changesReducer 纯函数单测（W-06..W-08） */
import { describe, it, expect } from 'vitest';
import {
  addChange,
  setChangeStatus,
  removeChange,
  acceptAll,
  rejectAll,
  clearResolved,
} from './changesReducer';

describe('changesReducer', () => {
  it('addChange 新增一条 pending', () => {
    const next = addChange([], { path: 'a.ts', original: 'old', modified: 'new' });
    expect(next).toHaveLength(1);
    expect(next[0]!.status).toBe('pending');
    expect(next[0]!.id).toBeTruthy();
  });

  it('addChange 同 path 未拒绝则就地更新，不重复', () => {
    let files = addChange([], { path: 'a.ts', original: 'old', modified: 'new' });
    files = addChange(files, { path: 'a.ts', original: 'old', modified: 'edited' });
    expect(files).toHaveLength(1);
    expect(files[0]!.modified).toBe('edited');
  });

  it('addChange 同 path 已 rejected 则新增', () => {
    let files = addChange([], { path: 'a.ts', original: 'old', modified: 'new' });
    files = setChangeStatus(files, files[0]!.id, 'rejected');
    files = addChange(files, { path: 'a.ts', original: 'old', modified: 'again' });
    expect(files).toHaveLength(2);
  });

  it('setChangeStatus 改变状态', () => {
    const files = addChange([], { path: 'a.ts', original: 'old', modified: 'new' });
    const next = setChangeStatus(files, files[0]!.id, 'accepted');
    expect(next[0]!.status).toBe('accepted');
  });

  it('removeChange 移除条目', () => {
    const files = addChange([], { path: 'a.ts', original: 'old', modified: 'new' });
    expect(removeChange(files, files[0]!.id)).toHaveLength(0);
  });

  it('acceptAll / rejectAll 批量', () => {
    let files = addChange([], { path: 'a.ts', original: 'o', modified: 'm' });
    files = addChange(files, { path: 'b.ts', original: 'o', modified: 'm' });
    expect(acceptAll(files).every((f) => f.status === 'accepted')).toBe(true);
    expect(rejectAll(files).every((f) => f.status === 'rejected')).toBe(true);
  });

  it('clearResolved 仅保留 pending', () => {
    let files = addChange([], { path: 'a.ts', original: 'o', modified: 'm' });
    files = setChangeStatus(files, files[0]!.id, 'accepted');
    files = addChange(files, { path: 'b.ts', original: 'o', modified: 'm' });
    const cleared = clearResolved(files);
    expect(cleared).toHaveLength(1);
    expect(cleared[0]!.path).toBe('b.ts');
  });

  it('original 可为 null（未捕获原始内容）', () => {
    const files = addChange([], { path: 'a.ts', original: null, modified: 'm' });
    expect(files[0]!.original).toBeNull();
  });
});
