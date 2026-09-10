/**
 * 工作区模型（Project / AppSession / Automation / UsageBucket / Settings）。
 * 持久化为 appData 下的 JSON 文件（host 负责读写），本文件只定义契约与默认值。
 */
import { z } from 'zod';

/* ---------- 项目 ---------- */

export interface Project {
  id: string;
  name: string;
  path: string;
  /** 目录信任确认（P-02）：未信任不启动写权限 */
  trusted: boolean;
  createdAt: string;
  lastOpenedAt?: string;
  /** 路径异常标记（P-04） */
  status: 'ok' | 'missing' | 'no-access';
}

/* ---------- 会话 ---------- */

export type AppSessionStatus =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'running'
  | 'awaitingInput'
  | 'compacting'
  | 'retrying'
  | 'error'
  | 'closed';

export interface AppSession {
  id: string;
  /** null = 落入默认工作区（P-05） */
  projectId: string | null;
  title: string;
  status: AppSessionStatus;
  /** pi 会话双 ID（C-05） */
  piSessionId?: string;
  piSessionPath?: string;
  /** 恢复时优先 switch_session（C-03） */
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
  archived?: boolean;
  parentSessionId?: string;
  /** 绑定的 git worktree 路径（G-01；未绑定为 undefined） */
  worktreePath?: string;
}

/* ---------- 自动化 ---------- */

export interface AutomationSchedule {
  kind: 'daily' | 'weekly' | 'interval' | 'once';
  /** HH:mm */
  time?: string;
  /** 0-6（周日=0） */
  weekday?: number;
  intervalMinutes?: number;
  /** 一次性任务的 ISO 时间 */
  at?: string;
}

export interface AutomationRun {
  at: string;
  result: 'ok' | 'error' | 'skipped';
  detail?: string;
}

export interface Automation {
  id: string;
  title: string;
  prompt: string;
  projectId: string | null;
  schedule: AutomationSchedule;
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
  /** U-01 表单可指定模型（host 投递时尽力附加；未指定走会话默认） */
  model?: { provider: string; modelId: string };
  /** U-01 表单可指定思考级别（off..max；未指定走会话默认） */
  thinking?: string;
  /** 运行历史 ring ~50（U-05，诚实记录，不虚构退出后仍跑过） */
  history: AutomationRun[];
}

/* ---------- 用量 ---------- */

export interface UsageBucket {
  /** YYYY-MM-DD */
  date: string;
  /** 0-23（可选，时段热力图用） */
  hour?: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  sessions: number;
}

/* ---------- 设置 ---------- */

export const SettingsSchema = z.object({
  language: z.literal('zh-CN').default('zh-CN'),
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  /** V-07：遥测默认关闭，启用必须 opt-in */
  telemetryEnabled: z.boolean().default(false),
  /** N-02 并发上限 */
  maxConcurrentAgents: z.number().int().min(1).max(10).default(3),
  /** N-03 空闲回收（ms） */
  idleRecycleMs: z.number().int().min(60_000).default(1_800_000),
  /** 握手超时（ms，无 ready 帧，靠 get_state） */
  connectTimeoutMs: z.number().int().min(1_000).default(8_000),
  /** A-14 审批超时（ms） */
  uiRequestTimeoutMs: z.number().int().min(5_000).default(30_000),
  /** A-14 超时策略（默认保守拒绝） */
  approvalTimeoutPolicy: z.enum(['deny', 'allow']).default('deny'),
  /** N-09 stall 提示阈值（ms） */
  stallWarnMs: z.number().int().min(10_000).default(60_000),
  /** R-04 手动指定 pi 路径 */
  piPath: z.string().optional(),
  /** 运行时强制模式（R-05）：auto 探测 / real / mock */
  runtimeMode: z.enum(['auto', 'real', 'mock']).default('auto'),
  /**
   * 会话默认模型（host 兜底注入）：pi 0.85 在部分环境下不会遵循其
   * settings.json 的 defaultProvider，会落到未配置 key 的 provider（如 deepseek 401），
   * 因此 host 在 session.open 未显式指定 model 时以此兜底。
   */
  defaultModel: z
    .object({ provider: z.string().min(1), modelId: z.string().min(1) })
    .optional(),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});
