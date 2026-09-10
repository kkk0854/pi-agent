/**
 * HostBridge —— 宿主能力接口（Tauri 替换点，架构 §3.3）。
 * 按「Rust 可替换宿主」设计：kind='http'（Node host）/'tauri'/'noop'。
 */
import type { Unsubscribe } from '../runtime/events';
import type { RuntimeError } from '../runtime/errors';
import type {
  OpenSessionRequest,
  RuntimeCapabilities,
} from '../runtime/AgentRuntime';
import type { HostEndpoint } from './hostWire';
import type { Project, AppSession, Settings } from './workspace';

/** 宿主能力接口 */
export interface HostBridge {
  readonly kind: 'http' | 'tauri' | 'noop';
  init(cfg: HostEndpointConfig): Promise<void>;
  /** 会话通道（原始 JSONL 行） */
  readonly agent: AgentTransport;
  /** 项目/会话/自动化/用量/设置 CRUD */
  readonly workspace: WorkspaceApi;
  /** 受白名单约束的文件访问 */
  readonly fs: FsApi;
  /** 通知/剪贴板/外部打开/钥匙串/窗口控制 */
  readonly system: SystemApi;
  /** 本地路径 → 可播放 URL */
  readonly media: MediaApi;
}

export interface HostEndpointConfig {
  endpoint: HostEndpoint | null;
}

/* ---------- 会话通道（原始 JSONL 行双向透传） ---------- */

export type ChannelStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface AgentTransport {
  open(
    opts: OpenSessionRequest & { caps: RuntimeCapabilities },
    onLines: (lines: string[]) => void,
    onStatus: (s: ChannelStatus, err?: RuntimeError) => void,
  ): Promise<AgentChannel>;
}

export interface AgentChannel {
  readonly sessionId: string;
  readonly status: ChannelStatus;
  /** 序列化为单行 JSON + '\n' 写入 pi stdin */
  writeLine(obj: unknown): void;
  close(recycle?: boolean): Promise<void>;
}

/* ---------- 工作区 CRUD（REST DTO，host 按需扩展） ---------- */

export interface WorkspaceApi {
  listProjects(): Promise<Project[]>;
  addProject(input: { path: string; name?: string; trusted: boolean }): Promise<Project>;
  updateProject(id: string, patch: Partial<Project>): Promise<Project>;
  removeProject(id: string): Promise<void>;
  listSessions(opts?: { includeArchived?: boolean }): Promise<AppSession[]>;
  createSession(input: Partial<AppSession>): Promise<AppSession>;
  updateSession(id: string, patch: Partial<AppSession>): Promise<AppSession>;
  deleteSession(id: string): Promise<void>;
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
}

/* ---------- 文件访问 ---------- */

export interface DirEntry {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  size?: number;
}

export interface FileStat {
  size: number;
  mtimeMs: number;
  isDirectory: boolean;
}

export interface FsWatchEvent {
  type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
  path: string;
}

export interface FsApi {
  readText(p: string, maxBytes?: number): Promise<string>;
  writeText(p: string, content: string): Promise<void>;
  listDir(p: string): Promise<DirEntry[]>;
  searchFiles(root: string, q: string, limit?: number): Promise<string[]>;
  exists(p: string): Promise<boolean>;
  stat(p: string): Promise<FileStat>;
  openExternal(p: string): Promise<void>;
  showInFolder(p: string): Promise<void>;
  watch(p: string, cb: (e: FsWatchEvent) => void): Promise<Unsubscribe>;
}

/* ---------- 系统能力 ---------- */

export interface WindowControls {
  minimize(): void;
  maximize(): void;
  close(): void;
  setTitle(title: string): void;
}

export interface SystemApi {
  notify(input: { title: string; body: string; deepLink?: string }): Promise<void>;
  setClipboardText(t: string): Promise<void>;
  getSecret(k: string): Promise<string | null>;
  setSecret(k: string, v: string): Promise<void>;
  /** Tauri 阶段提供：minimize/maximize/close/setTitle */
  windowControls?: WindowControls;
  openLogsDir(): Promise<void>;
  openDataDir(): Promise<void>;
}

/* ---------- 媒体 ---------- */

export interface MediaApi {
  /** 本地绝对路径 → host 媒体 URL（GET /v1/media?t=&p=） */
  url(absPath: string): string;
  thumbnail(absPath: string): Promise<string>;
}
