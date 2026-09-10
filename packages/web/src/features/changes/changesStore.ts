/**
 * 变更 store（W-06..W-08）：收集本轮被修改的文件，供右栏「变更」Tab 与 DiffPanel 使用。
 * 状态更新走 changesReducer 纯函数；accept/reject/restore 只改内存态，
 * "还原文件"需要宿主写入接口（T04b 项），演示模式下 restore 等同于标记 rejected 并提示。
 */
import { create } from 'zustand';
import {
  acceptAll,
  addChange,
  clearResolved,
  rejectAll,
  removeChange,
  setChangeStatus,
  type ChangeFile,
  type ChangeInput,
  type ChangeStatus,
} from './changesReducer';

export type { ChangeStatus, ChangeFile } from './changesReducer';

interface ChangesStore {
  files: ChangeFile[];
  /** 写盘前快照（path → original 内容；审批流在写工具 confirm 到达时写入） */
  snapshots: Record<string, string>;
  setSnapshot(path: string, content: string): void;
  /** 取走快照（取后即删，避免陈旧 original 复用） */
  takeSnapshot(path: string): string | null;
  /** 新增/更新一条变更 */
  add(input: ChangeInput): void;
  accept(id: string): void;
  reject(id: string): void;
  /** 还原：通过 host PUT /v1/fs/write 写回 original（走审批与信任目录校验） */
  restore(id: string): void;
  remove(id: string): void;
  acceptAll(): void;
  rejectAll(): void;
  clearResolved(): void;
  clear(): void;
}

function applyStatus(id: string, status: ChangeStatus): (files: ChangeFile[]) => ChangeFile[] {
  return (files) => setChangeStatus(files, id, status);
}

export const useChangesStore = create<ChangesStore>((set, get) => ({
  files: [],
  snapshots: {},
  setSnapshot(path: string, content: string): void {
    set((s) => ({ snapshots: { ...s.snapshots, [path]: content } }));
  },
  takeSnapshot(path: string): string | null {
    const content = get().snapshots[path];
    if (content === undefined) return null;
    set((s) => {
      const next = { ...s.snapshots };
      delete next[path];
      return { snapshots: next };
    });
    return content;
  },
  add(input: ChangeInput): void {
    set((s) => ({ files: addChange(s.files, input) }));
  },
  accept(id: string): void {
    set((s) => ({ files: applyStatus(id, 'accepted')(s.files) }));
  },
  reject(id: string): void {
    set((s) => ({ files: applyStatus(id, 'rejected')(s.files) }));
  },
  restore(id: string): void {
    // 还原语义由 ChangesPanel 负责（写回 original 需 workspace.writeFile）；
    // store 只负责状态收口：还原即丢弃修改（rejected）
    set((s) => ({ files: applyStatus(id, 'rejected')(s.files) }));
  },
  remove(id: string): void {
    set((s) => ({ files: removeChange(s.files, id) }));
  },
  acceptAll(): void {
    set((s) => ({ files: acceptAll(s.files) }));
  },
  rejectAll(): void {
    set((s) => ({ files: rejectAll(s.files) }));
  },
  clearResolved(): void {
    set((s) => ({ files: clearResolved(s.files) }));
  },
  clear(): void {
    set({ files: [] });
  },
}));
