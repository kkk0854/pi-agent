/**
 * 分叉编排（F-01..F-05）：将「fork 命令 → 新 AppSession → 切到新会话」串成一步。
 * - 调用 runtime.fork(sessionId, entryId) 拿到派生 pi 会话标识（F-03 上下文截断由 pi 侧完成）。
 * - 经 workspace.createSession 落一条新 AppSession（host 或本地兜底），并把派生 pi 会话
 *   标识写回（piSessionId / piSessionPath），使 ChatView 打开时 switch_session 正确附着（C-03）。
 * - 最后 setCurrentSession 触发会话装载。
 */
import type { AppSession } from '@pi-agent/shared';
import { getRuntime, getWorkspace } from '../../runtime/runtimeRef';
import { useAppStore } from '../../store';

export interface ForkContext {
  sessionId: string;
  projectId: string | null;
  currentTitle?: string;
}

/**
 * 从指定 entryId 分叉出一条新会话。
 * @returns 新 AppSession 的 id（已置为当前会话）
 */
export async function forkFromEntry(ctx: ForkContext, entryId: string): Promise<string> {
  const runtime = getRuntime();
  if (!runtime) throw new Error('运行时尚未就绪，无法分叉');
  const result = await runtime.fork(ctx.sessionId, entryId);

  const now = new Date().toISOString();
  const base: Partial<AppSession> = {
    projectId: ctx.projectId,
    title: `分叉 · ${ctx.currentTitle ?? '会话'}`,
    status: 'idle',
    piSessionId: result.piSessionId,
    piSessionPath: result.sessionFile,
    parentSessionId: ctx.sessionId,
    createdAt: now,
    updatedAt: now,
  };

  const workspace = getWorkspace();
  if (!workspace) throw new Error('工作区不可用，无法创建分叉会话');
  const created = await workspace.createSession(base);

  const store = useAppStore.getState();
  store.upsertSession(created);
  store.setCurrentSession(created.id);
  return created.id;
}
