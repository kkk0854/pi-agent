/** UI 切片：主题、三栏布局（S-01 可拖可记忆）、折叠状态、模态栈（骨架） */
import type { StateCreator } from 'zustand';
import type { AppState } from './index';
import { loadLocal, saveLocal } from '../lib/persistLocal';

export type ThemePreference = 'light' | 'dark' | 'system';
/** 主区视图（T03：聊天 / 看板 K-01 / 设置） */
export type MainView = 'chat' | 'kanban' | 'settings';

export interface UiSlice {
  theme: ThemePreference;
  /** 主区当前视图 */
  mainView: MainView;
  /** 左栏宽度（px，S-01 拖拽记忆） */
  sidebarWidth: number;
  /** 右栏宽度（px） */
  rightAsideWidth: number;
  sidebarCollapsed: boolean;
  rightAsideCollapsed: boolean;
  setTheme(theme: ThemePreference): void;
  setMainView(view: MainView): void;
  setSidebarWidth(width: number): void;
  setRightAsideWidth(width: number): void;
  toggleSidebar(): void;
  toggleRightAside(): void;
}

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 480;
const RIGHT_MIN = 240;
const RIGHT_MAX = 560;

export const createUiSlice: StateCreator<AppState, [], [], UiSlice> = (set) => ({
  theme: loadLocal<ThemePreference>('ui.theme', 'system'),
  mainView: 'chat',
  sidebarWidth: loadLocal<number>('ui.sidebarWidth', 260),
  rightAsideWidth: loadLocal<number>('ui.rightAsideWidth', 320),
  sidebarCollapsed: loadLocal<boolean>('ui.sidebarCollapsed', false),
  rightAsideCollapsed: loadLocal<boolean>('ui.rightAsideCollapsed', false),

  setTheme(theme: ThemePreference): void {
    saveLocal('ui.theme', theme);
    set({ theme });
  },
  setMainView(view: MainView): void {
    set({ mainView: view });
  },
  setSidebarWidth(width: number): void {
    const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)));
    saveLocal('ui.sidebarWidth', w);
    set({ sidebarWidth: w });
  },
  setRightAsideWidth(width: number): void {
    const w = Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, Math.round(width)));
    saveLocal('ui.rightAsideWidth', w);
    set({ rightAsideWidth: w });
  },
  toggleSidebar(): void {
    set((s) => {
      saveLocal('ui.sidebarCollapsed', !s.sidebarCollapsed);
      return { sidebarCollapsed: !s.sidebarCollapsed };
    });
  },
  toggleRightAside(): void {
    set((s) => {
      saveLocal('ui.rightAsideCollapsed', !s.rightAsideCollapsed);
      return { rightAsideCollapsed: !s.rightAsideCollapsed };
    });
  },
});
