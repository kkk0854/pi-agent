/// <reference types="vite/client" />
import type { HostEndpoint } from '@pi-agent/shared';

declare global {
  interface Window {
    /** host 端点（dev 由 vite 插件注入；Tauri 阶段由壳注入；离线为 null） */
    __PI_AGENT_HOST__: HostEndpoint | null;
    /**
     * T05 桌面壳注入（Rust initialization_script，先于页面脚本执行）：
     * 优先级高于 __PI_AGENT_HOST__（dist 构建期注入的端点是陈旧快照）。
     * Web 环境恒为 undefined，读取处需用 `??` 回退。
     */
    __PI_AGENT_HOST_OVERRIDE__?: HostEndpoint | null;
    /** Tauri 2 运行时注入（桌面壳内才有；Web 浏览器无） */
    __TAURI_INTERNALS__?: {
      invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
      transformCallback(cb: (event: unknown) => void, once?: boolean): number;
    };
  }
}

export {};
