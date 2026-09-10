/** 会话切片：会话列表、当前会话（T02 由 framesink 驱动状态机） */
import type { StateCreator } from 'zustand';
import type { AppState } from './index';
import type { AppSession } from '@pi-agent/shared';

export interface SessionSlice {
  sessions: AppSession[];
  currentSessionId: string | null;
  setCurrentSession(sessionId: string | null): void;
  upsertSession(session: AppSession): void;
  removeSession(sessionId: string): void;
}

export const createSessionSlice: StateCreator<
  AppState,
  [],
  [],
  SessionSlice
> = (set) => ({
  sessions: [],
  currentSessionId: null,

  setCurrentSession(sessionId: string | null): void {
    set({ currentSessionId: sessionId });
  },
  upsertSession(session: AppSession): void {
    set((s) => {
      const exists = s.sessions.some((item) => item.id === session.id);
      return {
        sessions: exists
          ? s.sessions.map((item) => (item.id === session.id ? session : item))
          : [...s.sessions, session],
      };
    });
  },
  removeSession(sessionId: string): void {
    set((s) => ({
      sessions: s.sessions.filter((item) => item.id !== sessionId),
      currentSessionId: s.currentSessionId === sessionId ? null : s.currentSessionId,
    }));
  },
});
