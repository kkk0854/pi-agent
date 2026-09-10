/**
 * Zustand root（切片合并，架构 §8.3 严格三层中的②领域层）。
 * ① 传输层（AgentRuntime）与③视图层（features/*）不在此文件。
 */
import { create } from 'zustand';
import { createUiSlice, type UiSlice, type ThemePreference } from './uiStore';
import { createSessionSlice, type SessionSlice } from './sessionStore';
import { createProjectSlice, type ProjectSlice } from './projectStore';
import { createPermissionSlice, type PermissionSlice } from './permissionStore';
import { createSettingsSlice, type SettingsSlice } from './settingsStore';
import { createMetaSlice, type MetaSlice } from './metaStore';

export type AppState = UiSlice & SessionSlice & ProjectSlice & PermissionSlice & SettingsSlice & MetaSlice;

export const useAppStore = create<AppState>()((...args) => ({
  ...createUiSlice(...args),
  ...createSessionSlice(...args),
  ...createProjectSlice(...args),
  ...createPermissionSlice(...args),
  ...createSettingsSlice(...args),
  ...createMetaSlice(...args),
}));

export type {
  UiSlice,
  ThemePreference,
  SessionSlice,
  ProjectSlice,
  PermissionSlice,
  SettingsSlice,
  MetaSlice,
};
