/**
 * 会话活动状态（K-01/K-02 看板依据）：
 * App 事件接线里对所有会话（含非当前会话）记录 running/ready，
 * 看板据此实时归类：待处理（有挂起审批）> 正在执行 > 已完成 > 空闲。
 */
import { create } from 'zustand';

export type SessionActivity = 'running' | 'ready' | null;

interface ActivityState {
  /** sessionId → 最近活动（null = 尚未运行过） */
  bySession: Record<string, SessionActivity>;
  mark(sessionId: string, activity: Exclude<SessionActivity, null>): void;
  remove(sessionId: string): void;
}

export const useActivityStore = create<ActivityState>()((set) => ({
  bySession: {},
  mark(sessionId, activity) {
    set((s) => ({ bySession: { ...s.bySession, [sessionId]: activity } }));
  },
  remove(sessionId) {
    set((s) => {
      const next = { ...s.bySession };
      delete next[sessionId];
      return { bySession: next };
    });
  },
}));
