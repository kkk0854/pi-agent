/**
 * 权限切片（A-05，Q14 已采信）：
 * 全局默认恒为 ③ 逐次询问（不可改）；项目级 / 会话级可覆盖。
 * 优先级：会话 > 项目 > 全局。
 */
import type { StateCreator } from 'zustand';
import type { AppState } from './index';
import { GLOBAL_DEFAULT_TIER, type PermissionTier } from '@pi-agent/shared';

export interface PermissionSlice {
  /** 恒为 'ask'（A-01：yolo 不得作为全局默认） */
  globalTier: PermissionTier;
  projectTiers: Record<string, PermissionTier>;
  sessionTiers: Record<string, PermissionTier>;
  setProjectTier(projectId: string, tier: PermissionTier): void;
  setSessionTier(sessionId: string, tier: PermissionTier): void;
  clearSessionTier(sessionId: string): void;
  /** 解析生效档位（会话 > 项目 > 全局） */
  effectiveTier(sessionId: string | null, projectId: string | null): PermissionTier;
}

export const createPermissionSlice: StateCreator<
  AppState,
  [],
  [],
  PermissionSlice
> = (set, get) => ({
  globalTier: GLOBAL_DEFAULT_TIER,
  projectTiers: {},
  sessionTiers: {},

  setProjectTier(projectId: string, tier: PermissionTier): void {
    set((s) => ({ projectTiers: { ...s.projectTiers, [projectId]: tier } }));
  },
  setSessionTier(sessionId: string, tier: PermissionTier): void {
    set((s) => ({ sessionTiers: { ...s.sessionTiers, [sessionId]: tier } }));
  },
  clearSessionTier(sessionId: string): void {
    set((s) => {
      const next = { ...s.sessionTiers };
      delete next[sessionId];
      return { sessionTiers: next };
    });
  },
  effectiveTier(sessionId: string | null, projectId: string | null): PermissionTier {
    const s = get();
    if (sessionId && s.sessionTiers[sessionId]) return s.sessionTiers[sessionId]!;
    if (projectId && s.projectTiers[projectId]) return s.projectTiers[projectId]!;
    return s.globalTier;
  },
});
