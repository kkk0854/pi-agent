/**
 * 媒体查看器全局状态（D-03/D-04/D-07）：
 * 任意组件（工具卡片 / 消息 / 分叉面板）发现媒体路径后调用 open()，由 App 层的
 * <MediaLightbox /> 统一渲染。kind 可显式传入（已知类型时），否则按路径判别。
 */
import { create } from 'zustand';
import { classifyMedia, type MediaKind } from '../../lib/mediaUrl';

export interface MediaTarget {
  /** 本地绝对路径（优先走回环媒体 URL）或 http(s) URL */
  path: string;
  kind: MediaKind;
  title?: string;
}

interface MediaStore {
  target: MediaTarget | null;
  /** 打开媒体；kind 省略时按路径判别 */
  open(path: string, opts?: { kind?: MediaKind; title?: string }): void;
  close(): void;
}

export const useMediaStore = create<MediaStore>((set) => ({
  target: null,
  open(path: string, opts?: { kind?: MediaKind; title?: string }): void {
    const kind = opts?.kind ?? classifyMedia(path);
    set({ target: { path, kind, title: opts?.title } });
  },
  close(): void {
    set({ target: null });
  },
}));
