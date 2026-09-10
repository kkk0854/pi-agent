/**
 * 变更（W-06..W-08）纯函数归约：便于单测，与 React/store 解耦。
 * ChangeFile 由"文件被修改"这一事实驱动；original 可能为 null（未捕获原始内容）。
 */
export type ChangeStatus = 'pending' | 'accepted' | 'rejected';

export interface ChangeFile {
  id: string;
  /** 文件绝对路径或项目相对路径 */
  path: string;
  /** 原始内容（未修改）；null = 未捕获原始内容 */
  original: string | null;
  /** 修改后内容 */
  modified: string;
  status: ChangeStatus;
}

export interface ChangeInput {
  path: string;
  original: string | null;
  modified: string;
  /** 可选：显式指定 id（同一 path 复用） */
  id?: string;
}

function genId(): string {
  return `chg-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** 新增/更新一条变更：同一 path 未拒绝的条目会被就地更新 */
export function addChange(files: ChangeFile[], input: ChangeInput): ChangeFile[] {
  const id = input.id ?? genId();
  const existing = files.find((f) => f.path === input.path && f.status !== 'rejected');
  if (existing) {
    return files.map((f) =>
      f.id === existing.id
        ? { ...f, modified: input.modified, original: input.original, status: 'pending' }
        : f,
    );
  }
  return [...files, { id, path: input.path, original: input.original, modified: input.modified, status: 'pending' }];
}

/** 设置单条状态（accept/reject/restore 的底层） */
export function setChangeStatus(files: ChangeFile[], id: string, status: ChangeStatus): ChangeFile[] {
  return files.map((f) => (f.id === id ? { ...f, status } : f));
}

/** 移除单条 */
export function removeChange(files: ChangeFile[], id: string): ChangeFile[] {
  return files.filter((f) => f.id !== id);
}

/** 批量接受 */
export function acceptAll(files: ChangeFile[]): ChangeFile[] {
  return files.map((f) => ({ ...f, status: 'accepted' as const }));
}

/** 批量拒绝 */
export function rejectAll(files: ChangeFile[]): ChangeFile[] {
  return files.map((f) => ({ ...f, status: 'rejected' as const }));
}

/** 仅保留待处理条目（清掉已决） */
export function clearResolved(files: ChangeFile[]): ChangeFile[] {
  return files.filter((f) => f.status === 'pending');
}
