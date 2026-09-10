/** 运行时元信息切片：模式徽章（Mock 模式）与降级原因、host 在线状态 */
import type { StateCreator } from 'zustand';
import type { AppState } from './index';

export interface MetaSlice {
  /** 当前生效运行时（null = 尚未初始化完成） */
  runtimeMode: 'real' | 'mock' | null;
  runtimeReason: string | null;
  hostOnline: boolean;
  setRuntimeMeta(mode: 'real' | 'mock', reason: string | null, hostOnline: boolean): void;
}

export const createMetaSlice: StateCreator<AppState, [], [], MetaSlice> = (set) => ({
  runtimeMode: null,
  runtimeReason: null,
  hostOnline: false,

  setRuntimeMeta(mode, reason, hostOnline): void {
    set({ runtimeMode: mode, runtimeReason: reason, hostOnline });
  },
});
