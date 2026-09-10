/**
 * tauriIpc（T05）：不经 @tauri-apps/api 依赖，直接走 Tauri 2 注入的
 * window.__TAURI_INTERNALS__（invoke + transformCallback）。浏览器环境恒返回 null，
 * 调用方以 isTauri() 分支——Web 版行为完全不变（Z-06 前提：同一份前端产物）。
 */

interface TauriInternals {
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  transformCallback(cb: (event: unknown) => void, once?: boolean): number;
}

function internals(): TauriInternals | null {
  return window.__TAURI_INTERNALS__ ?? null;
}

/** 是否运行在 Tauri 桌面壳内 */
export function isTauri(): boolean {
  return internals() !== null;
}

/** 调用 Rust 命令（非 Tauri 环境抛错；调用方应先 isTauri() 分支） */
export function tauriInvoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const t = internals();
  if (!t) return Promise.reject(new Error('Tauri IPC 不可用（浏览器环境）'));
  return t.invoke<T>(cmd, args);
}

/**
 * 订阅 Tauri 事件（plugin:event|listen 协议）。
 * 返回解绑函数；非 Tauri 环境返回 no-op。
 */
export function tauriListen(event: string, cb: (payload: unknown) => void): () => void {
  const t = internals();
  if (!t) return () => undefined;
  const handler = t.transformCallback((raw: unknown) => {
    // 事件回调入参形如 { event, id, payload }
    const payload = (raw as { payload?: unknown } | null)?.payload;
    cb(payload);
  }, false);
  void t
    .invoke('plugin:event|listen', { event, target: { kind: 'Any' }, handler })
    .catch(() => undefined);
  return () => {
    void t.invoke('plugin:event|unlisten', { event, eventId: handler }).catch(() => undefined);
  };
}
