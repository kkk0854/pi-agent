/** 设置切片：默认值来自 shared（zod 校验）；T02 起与 host settings.json 双向同步 */
import type { StateCreator } from 'zustand';
import type { AppState } from './index';
import { DEFAULT_SETTINGS, type Settings } from '@pi-agent/shared';

export interface SettingsSlice {
  settings: Settings;
  updateSettings(patch: Partial<Settings>): void;
  /** host 可达时整包替换（T02） */
  replaceSettings(settings: Settings): void;
}

export const createSettingsSlice: StateCreator<
  AppState,
  [],
  [],
  SettingsSlice
> = (set) => ({
  settings: { ...DEFAULT_SETTINGS },

  updateSettings(patch: Partial<Settings>): void {
    set((s) => ({ settings: { ...s.settings, ...patch } }));
  },
  replaceSettings(settings: Settings): void {
    set({ settings });
  },
});
