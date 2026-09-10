/**
 * TauriHostBridge（T05）：HostBridge 的桌面壳实现。
 * - 运行时检测 window.__TAURI_INTERNALS__ 自动切换；Web 版行为完全不变
 * - 本版仅替换三个能力：system.windowControls / system.notify / system.secret（invoke 直达 Rust）
 * - 其余（agent 通道 / workspace / fs / media）仍走 HTTP sidecar（Z-01），与 Web 版同一套管道：
 *   agent 由既有 HostAgentRuntime（WS）承担；本桥的 agent 为诚实骨架（抛 bridge_unsupported）
 * - 桌面事件：approval:deeplink → 切到对应会话（A-09）；host:endpoint-changed → 重载（崩溃重启后端点变化）
 */
import type {
  AgentChannel,
  AgentTransport,
  DirEntry,
  FsApi,
  FsWatchEvent,
  HostBridge,
  HostEndpoint,
  HostEndpointConfig,
  MediaApi,
  OpenSessionRequest,
  RuntimeCapabilities,
  Settings,
  SystemApi,
  WindowControls,
  WorkspaceApi,
} from '@pi-agent/shared';
import { HostApiError, HostClient } from '../lib/hostClient';
import { useAppStore } from '../store';
import { isTauri, tauriInvoke, tauriListen } from './tauriIpc';

/* ---------- system 能力（Rust 命令直达） ---------- */

function desktopWindowControls(): WindowControls {
  return {
    minimize: () => void tauriInvoke('window_minimize').catch(() => undefined),
    maximize: () => void tauriInvoke('window_toggle_maximize').catch(() => undefined),
    close: () => void tauriInvoke('window_close_to_tray').catch(() => undefined),
    setTitle: (title: string) => {
      document.title = title;
      void tauriInvoke('window_set_title', { title }).catch(() => undefined);
    },
  };
}

function desktopSystem(): SystemApi {
  return {
    notify: async (input: { title: string; body: string; deepLink?: string }) => {
      await tauriInvoke('notify', {
        title: input.title,
        body: input.body,
        sessionId: input.deepLink ?? null,
      });
    },
    setClipboardText: async (text: string) => {
      await navigator.clipboard.writeText(text);
    },
    getSecret: async (key: string) => tauriInvoke<string | null>('secret_get', { key }),
    setSecret: async (key: string, value: string) => {
      await tauriInvoke('secret_set', { key, value });
    },
    windowControls: desktopWindowControls(),
    openLogsDir: () => tauriInvoke('open_logs_dir').then(() => undefined),
    openDataDir: () => tauriInvoke('open_data_dir').then(() => undefined),
  };
}

/* ---------- HTTP 委托：workspace / fs / media（走 sidecar REST，与 Web 版一致） ---------- */

function httpWorkspace(client: HostClient): WorkspaceApi {
  return {
    listProjects: () => client.listProjects(),
    addProject: (input) => client.addProject(input),
    updateProject: (id, patch) => client.updateProject(id, patch),
    removeProject: async (id) => {
      await client.removeProject(id);
    },
    listSessions: (opts) => client.listSessions(opts?.includeArchived ?? false),
    createSession: (input) => client.createSession(input),
    updateSession: (id, patch) => client.updateSession(id, patch),
    deleteSession: async (id) => {
      await client.deleteSession(id);
    },
    getSettings: () => client.getSettings(),
    saveSettings: async (settings: Settings) => {
      await client.saveSettings(settings);
    },
  };
}

function httpFs(client: HostClient): FsApi {
  return {
    readText: async (p: string, maxBytes?: number) => (await client.readFile(p, maxBytes)).content,
    writeText: async (p: string, content: string) => {
      await client.writeFile(p, content);
    },
    listDir: async (p: string): Promise<DirEntry[]> => {
      const qs = new URLSearchParams({ path: p });
      return client.request<{ name: string; path: string; kind: 'file' | 'dir'; size?: number }[]>(
        `/v1/fs/list?${qs.toString()}`,
      );
    },
    searchFiles: (root: string, q: string, limit?: number) => client.searchFiles(root, q, limit),
    exists: async (p: string) => {
      try {
        await client.request<unknown>(`/v1/fs/stat?path=${encodeURIComponent(p)}`);
        return true;
      } catch (e) {
        if (e instanceof HostApiError && e.status === 404) return false;
        throw e;
      }
    },
    stat: async (p: string) => {
      const r = await client.request<{ size: number; mtimeMs: number; isDirectory: boolean }>(
        `/v1/fs/stat?path=${encodeURIComponent(p)}`,
      );
      return { size: r.size, mtimeMs: r.mtimeMs, isDirectory: r.isDirectory };
    },
    openExternal: (p: string) => tauriInvoke('open_external', { path: p }).then(() => undefined),
    showInFolder: (p: string) => tauriInvoke('open_external', { path: p }).then(() => undefined),
    // 骨架：web 版同样经 WS sys 通道 fs.changed（T04b）承担监听；桥内独立 watch 留后续
    watch: async (_p: string, _cb: (e: FsWatchEvent) => void) => () => undefined,
  };
}

function httpMedia(client: HostClient): MediaApi {
  return {
    url: (absPath: string) => client.mediaUrl(absPath),
    // 骨架：缩略图服务未实现（诚实报错，调用方展示占位）
    thumbnail: async () => {
      throw new Error('thumbnail 尚未实现（Z-08 同批骨架）');
    },
  };
}

/** agent 通道骨架：聊天链路沿用 HostAgentRuntime（sidecar WS），本桥不重复实现 */
function skeletonAgent(): AgentTransport {
  const open = async (
    _opts: OpenSessionRequest & { caps: RuntimeCapabilities },
  ): Promise<AgentChannel> => {
    throw {
      code: 'bridge_unsupported',
      message: 'TauriHostBridge v1 的 agent 通道为骨架：聊天链路沿用 sidecar WS 运行时',
    };
  };
  return { open };
}

/* ---------- TauriHostBridge ---------- */

export class TauriHostBridge implements HostBridge {
  readonly kind = 'tauri' as const;
  private endpoint: HostEndpoint | null;
  private client: HostClient | null;

  constructor(endpoint: HostEndpoint | null) {
    this.endpoint = endpoint;
    this.client = endpoint !== null ? new HostClient(endpoint) : null;
  }

  async init(cfg: HostEndpointConfig): Promise<void> {
    this.endpoint = cfg.endpoint;
    this.client = cfg.endpoint !== null ? new HostClient(cfg.endpoint) : null;

    // A-09：通知点击（窗口聚焦）→ 深链切到对应会话
    tauriListen('approval:deeplink', (payload) => {
      const sid = typeof payload === 'string' ? payload : null;
      if (sid) useAppStore.getState().setCurrentSession(sid);
    });
    // Z-01 崩溃重启 → 端点可能变化：Rust 已重注入 override，前端重载引导
    tauriListen('host:endpoint-changed', () => {
      window.location.reload();
    });
  }

  get agent(): AgentTransport {
    return skeletonAgent();
  }

  get workspace(): WorkspaceApi {
    if (!this.client) throw new Error('host 不可达（sidecar 未就绪）');
    return httpWorkspace(this.client);
  }

  get fs(): FsApi {
    if (!this.client) throw new Error('host 不可达（sidecar 未就绪）');
    return httpFs(this.client);
  }

  get system(): SystemApi {
    return desktopSystem();
  }

  get media(): MediaApi {
    if (!this.client) throw new Error('host 不可达（sidecar 未就绪）');
    return httpMedia(this.client);
  }
}

/* ---------- 模块级单例（非 hook 上下文可用，供 TitleBar / approvalFlow 取用） ---------- */

let singleton: TauriHostBridge | null = null;

/** 装配桌面桥（仅 isTauri() 时由 App bootstrap 调用；Web 版零行为） */
export function installDesktopBridge(endpoint: HostEndpoint | null): TauriHostBridge {
  if (!singleton) {
    singleton = new TauriHostBridge(endpoint);
    void singleton.init({ endpoint });
  }
  return singleton;
}

/** 取桌面 system 能力（非 Tauri 返回 null；TitleBar 据此渲染窗控插槽） */
export function desktopSystemApi(): SystemApi | null {
  return isTauri() ? (singleton?.system ?? desktopSystem()) : null;
}
