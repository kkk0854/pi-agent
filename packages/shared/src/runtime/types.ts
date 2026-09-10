/**
 * 共享基础类型（架构 §2.2 · types.ts）：
 * pi RPC 协议相关领域类型。帧的「宽松」类型见 frames.ts。
 */

/** 思考级别（与 pi 协议一致，含 0.85 实测的 max） */
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** 流式内容块类型 */
export type BlockKind = 'text' | 'thinking' | 'toolCall';

/** 图片附件（走 prompt.images） */
export interface ImageAttachment {
  /** 本地路径（host 侧读取）或 dataUrl（浏览器侧） */
  path?: string;
  mime: string;
  dataUrl?: string;
}

/** 模型引用 */
export interface ModelRef {
  provider: string;
  modelId: string;
  name?: string;
}

/** 斜杠命令（get_commands 返回） */
export interface SlashCommand {
  name: string;
  description?: string;
  kind: 'extension' | 'prompt' | 'skill' | 'builtin';
}

/** get_state 回执的会话状态（RpcSessionState，pi rpc-types.d.ts） */
export interface RpcSessionState {
  model?: { provider?: string; id?: string; name?: string; [key: string]: unknown };
  thinkingLevel: ThinkingLevel;
  isStreaming: boolean;
  isCompacting: boolean;
  steeringMode: 'all' | 'one-at-a-time';
  followUpMode: 'all' | 'one-at-a-time';
  sessionFile?: string;
  sessionId: string;
  sessionName?: string;
  autoCompactionEnabled: boolean;
  messageCount: number;
  pendingMessageCount: number;
}

/** 上下文占用（SessionStats.contextUsage） */
export interface ContextUsage {
  tokens?: number;
  contextWindow?: number;
  percentUsed?: number;
  [key: string]: unknown;
}

/** get_session_stats 回执（tokens / cost / contextUsage） */
export interface SessionStats {
  sessionFile?: string;
  sessionId?: string;
  userMessages?: number;
  assistantMessages?: number;
  toolCalls?: number;
  toolResults?: number;
  totalMessages?: number;
  tokens?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost?: number;
  contextUsage?: ContextUsage;
  [key: string]: unknown;
}

/** get_tree 回执的会话条目树节点（结构宽松，字段以实测为准） */
export interface SessionTreeNode {
  id: string;
  parentId?: string | null;
  label?: string;
  type?: string;
  children?: SessionTreeNode[];
  [key: string]: unknown;
}

/** 会话条目（get_entries / entry_appended，结构宽松） */
export interface SessionEntry {
  id: string;
  type?: string;
  [key: string]: unknown;
}

/** Agent 消息（get_messages 返回，结构宽松） */
export interface AgentMessage {
  id?: string;
  role: string;
  content?: unknown;
  [key: string]: unknown;
}
