/**
 * AgentRuntime —— 运行时冻结契约（架构 §3.2）。
 * 业务层只依赖本接口；HostAgentRuntime / MockAgentRuntime（T02）为两个实现。
 */
import type { Unsubscribe, EventHandler, SessionStatus } from './events';
import type {
  RpcSessionState,
  SessionStats,
  SessionTreeNode,
  SessionEntry,
  AgentMessage,
  SlashCommand,
  ModelRef,
  ThinkingLevel,
  ImageAttachment,
} from './types';
import type { ExtensionUIResponse, PermissionTier } from '../protocol/permissions';
import type { HostEndpoint } from '../protocol/hostWire';

/* ---------- 基础枚举 ---------- */
export type RuntimeKind = 'host' | 'mock';
/** pi 0.85 实测含 max 档 */
export type Thinking = ThinkingLevel;
export type QueueMode = 'all' | 'one-at-a-time';
// SessionStatus 由 events.ts 统一定义并导出（避免桶文件重名歧义）

/* ---------- 能力矩阵（R-06 降级依据） ---------- */
export interface RuntimeCapabilities {
  mode: 'real' | 'mock';
  piVersion?: string;
  piPath?: string;
  /** 降级原因（UI 明示「Mock 模式」） */
  reason?: string;
  supports: {
    fork: boolean;
    tree: boolean;
    stats: boolean;
    commands: boolean;
    thinkingLevel: boolean;
    modelSwitch: boolean;
    compaction: boolean;
    autoRetry: boolean;
    extensionUI: boolean;
    bash: boolean;
    exportHtml: boolean;
    images: boolean;
    queueModes: boolean;
  };
}

/* ---------- 初始化 ---------- */
export interface RuntimeInitConfig {
  /** R-05 强制模式 */
  mode: 'auto' | 'real' | 'mock';
  /** { httpUrl, wsUrl, token, pid } */
  host?: HostEndpoint;
  /** R-04 手动指定 pi 路径 */
  piPath?: string;
  /** N-02 默认 3 */
  maxConcurrentAgents: number;
  /** N-03 默认 1_800_000 */
  idleRecycleMs: number;
  /** 默认 8_000（无 ready 帧，靠 get_state 握手） */
  connectTimeoutMs: number;
  /** A-06/A-14 审批超时兜底，默认 30_000 */
  uiRequestTimeoutMs: number;
  /** A-14 默认 'deny'（保守） */
  approvalTimeoutPolicy: 'deny' | 'allow';
  /** N-09 默认 60_000 */
  stallWarnMs: number;
  /** Mock 延迟/错误注入/剧本 */
  mock?: MockProfile;
}

export interface MockProfile {
  latencyMs: number;
  script: 'tool-heavy' | 'plain' | 'approval' | 'compact' | 'error' | 'recorded';
  /** 回放真实会话录制的原始行 */
  recordedLines?: string[];
  errorInjection?: 'none' | 'tool-fail' | 'crash' | 'auth';
}

/* ---------- 会话 ---------- */
export interface OpenSessionRequest {
  /** App 侧会话 ID（与 pi sessionId 双 ID，C-05） */
  appSessionId: string;
  /** 未绑定项目 → 默认工作区 */
  projectPath?: string;
  worktreePath?: string;
  /** 恢复：--session <path> */
  piSessionPath?: string;
  /** 恢复：--session-id */
  piSessionId?: string;
  title?: string;
  model?: { provider: string; modelId: string };
  thinking?: Thinking;
  /** 只读档：['read','grep','find','ls']（W-05） */
  tools?: string[];
  /** 影响 --tools / --approve */
  permissionTier: PermissionTier;
  extraArgs?: string[];
}

export interface SessionHandle {
  appSessionId: string;
  piSessionId?: string;
  sessionFile?: string;
  status: SessionStatus;
  caps: RuntimeCapabilities;
}

export interface SendInput {
  sessionId: string;
  text: string;
  images?: ImageAttachment[];
  /** 运行时发送必须显式（协议约束 3：流式中调用 prompt 必须给 streamingBehavior） */
  behavior?: 'steer' | 'followUp';
}
export interface SendAck {
  turnId: string;
  accepted: 'started' | 'queued';
}

export interface ForkResult {
  appSessionId: string;
  piSessionId?: string;
  sessionFile?: string;
}
export interface TreeResult {
  tree: SessionTreeNode[];
  leafId?: string;
}
export interface ForkPoint {
  entryId: string;
  label: string;
  preview?: string;
}

export interface PiProbeResult {
  found: boolean;
  path?: string;
  version?: string;
  errorCode?: 'not_found' | 'auth' | 'network' | 'crash' | 'unknown';
  /** 中文可读 */
  message: string;
}

/* ---------- 主接口 ---------- */
export interface AgentRuntime {
  readonly kind: RuntimeKind;
  readonly caps: RuntimeCapabilities;

  /* 生命周期 */
  init(cfg: RuntimeInitConfig): Promise<RuntimeCapabilities>;
  dispose(): Promise<void>;
  /** (e: RuntimeEvent) => void 的订阅，返回退订函数 */
  onEvent(h: EventHandler): Unsubscribe;
  /** R-04：探测 pi 是否可用 */
  probe(): Promise<PiProbeResult>;

  /* 会话生命周期 */
  openSession(req: OpenSessionRequest): Promise<SessionHandle>;
  closeSession(sessionId: string, opts?: { recycle?: boolean }): Promise<void>;
  switchSession(sessionId: string, sessionPath: string): Promise<void>;
  fork(sessionId: string, entryId: string): Promise<ForkResult>;
  cloneSession(sessionId: string): Promise<ForkResult>;
  setSessionName(sessionId: string, name: string): Promise<void>;
  exportHtml(sessionId: string, outputPath?: string): Promise<string>;

  /* 轮次控制 */
  send(input: SendInput): Promise<SendAck>;
  steer(sessionId: string, text: string, images?: ImageAttachment[]): Promise<void>;
  followUp(sessionId: string, text: string, images?: ImageAttachment[]): Promise<void>;
  abort(sessionId: string): Promise<void>;
  abortBash(sessionId: string): Promise<void>;
  clearQueue(sessionId: string): Promise<void>;
  bash(sessionId: string, command: string, excludeFromContext?: boolean): Promise<void>;

  /* 模型 / 思考 / 上下文 */
  setModel(sessionId: string, provider: string, modelId: string): Promise<void>;
  cycleModel(sessionId: string): Promise<void>;
  getAvailableModels(): Promise<ModelRef[]>;
  setThinkingLevel(sessionId: string, level: Thinking): Promise<void>;
  cycleThinkingLevel(sessionId: string): Promise<void>;
  setSteeringMode(sessionId: string, mode: QueueMode): Promise<void>;
  setFollowUpMode(sessionId: string, mode: QueueMode): Promise<void>;
  compact(sessionId: string, customInstructions?: string): Promise<void>;
  setAutoCompaction(sessionId: string, enabled: boolean): Promise<void>;
  setAutoRetry(sessionId: string, enabled: boolean): Promise<void>;
  abortRetry(sessionId: string): Promise<void>;

  /* 扩展 UI 应答（A-02/A-06，禁止 window.alert/confirm/prompt） */
  respondExtensionUI(sessionId: string, requestId: string, resp: ExtensionUIResponse): Promise<void>;

  /* 查询 */
  getState(sessionId: string): Promise<RpcSessionState>;
  getSessionStats(sessionId: string): Promise<SessionStats>;
  getCommands(sessionId: string): Promise<SlashCommand[]>;
  getMessages(sessionId: string): Promise<AgentMessage[]>;
  getEntries(sessionId: string, since?: number): Promise<SessionEntry[]>;
  getTree(sessionId: string): Promise<TreeResult>;
  getForkMessages(sessionId: string): Promise<ForkPoint[]>;
  getLastAssistantText(sessionId: string): Promise<string>;
}
