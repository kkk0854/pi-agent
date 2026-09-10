/**
 * RuntimeEvent —— 前端唯一事件源（架构 §3.4，冻结契约）。
 * 由 PiFrameNormalizer 从原始 pi JSONL 帧归一化而来，真实/Mock 共用。
 */
import type { RuntimeErrorCode } from './errors';
import type { BlockKind, RpcSessionState, SessionEntry, SessionStats } from './types';
import type { ExtensionUIRequest } from '../protocol/permissions';

/** 会话状态机（通道状态 ChannelStatus 与其分离，见 hostBridge.ts） */
export type SessionStatus =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'running'
  | 'awaitingInput'
  | 'compacting'
  | 'retrying'
  | 'error'
  | 'closed';

export type RuntimeEvent =
  /* 会话与轮次 */
  | { t: 'session.status'; sessionId: string; status: SessionStatus; detail?: string }
  | { t: 'session.state'; sessionId: string; state: RpcSessionState }
  | { t: 'agent.start'; sessionId: string; turnId: string }
  /** 非终态：后面可能还有重试/压缩/排队 */
  | { t: 'agent.end'; sessionId: string; turnId: string }
  /** 一轮彻底结束，UI 只有它到达才收回「运行中」 */
  | { t: 'agent.settled'; sessionId: string; turnId: string; willRetry?: boolean }
  | { t: 'turn.start'; sessionId: string; turnId: string }
  | { t: 'turn.end'; sessionId: string; turnId: string; toolResults?: unknown[] }

  /* 流式内容（contentIndex 分块累积，禁止整段替换） */
  | { t: 'message.start'; sessionId: string; messageId: string; role: 'assistant' }
  | {
      t: 'block.start';
      sessionId: string;
      messageId: string;
      blockIndex: number;
      kind: 'text' | 'thinking' | 'toolCall';
    }
  | {
      t: 'block.delta';
      sessionId: string;
      messageId: string;
      blockIndex: number;
      kind: BlockKind;
      delta: string;
    }
  | { t: 'block.end'; sessionId: string; messageId: string; blockIndex: number; kind: BlockKind }
  | { t: 'message.end'; sessionId: string; messageId: string }

  /* 工具 */
  | { t: 'tool.start'; sessionId: string; toolCallId: string; toolName: string; args: unknown }
  | { t: 'tool.update'; sessionId: string; toolCallId: string; partialResult: unknown }
  | {
      t: 'tool.end';
      sessionId: string;
      toolCallId: string;
      result: unknown;
      isError: boolean;
      durationMs?: number;
    }

  /* 扩展 UI（审批/选择/输入/即发即忘；文本已剥离 ANSI） */
  | { t: 'ui.request'; sessionId: string; req: ExtensionUIRequest }
  /** text 为空串即视为清除该 statusKey（实测：statusText 省略即清除） */
  | { t: 'ui.status'; sessionId: string; statusKey: string; text: string; ansi?: boolean }
  | { t: 'ui.notify'; sessionId: string; message: string; level?: 'info' | 'warning' | 'error' }
  | {
      t: 'ui.widget';
      sessionId: string;
      key: string;
      lines: string[];
      placement?: 'aboveEditor' | 'belowEditor';
    }
  | { t: 'ui.title'; sessionId: string; title: string }
  | { t: 'ui.setEditorText'; sessionId: string; text: string }

  /* 队列 / 压缩 / 重试 / 条目 */
  | { t: 'queue.update'; sessionId: string; steering: unknown[]; followUp: unknown[] }
  | { t: 'compaction.start'; sessionId: string; reason: 'manual' | 'threshold' | 'overflow' }
  | {
      t: 'compaction.end';
      sessionId: string;
      aborted?: boolean;
      willRetry?: boolean;
      summary?: string;
    }
  | { t: 'retry.start'; sessionId: string; attempt: number; maxAttempts: number; delayMs: number }
  | { t: 'retry.end'; sessionId: string; success: boolean }
  | { t: 'entry.appended'; sessionId: string; entry: SessionEntry }
  | { t: 'session.info'; sessionId: string; name?: string; sessionFile?: string }
  | { t: 'bash.output'; sessionId: string; id?: string; delta: string }

  /* 统计与诊断 */
  | { t: 'stats.updated'; sessionId: string; stats: SessionStats }
  | { t: 'error'; sessionId?: string; code: RuntimeErrorCode; message: string; recoverable: boolean }
  /** 诊断面板保留原始帧（不得直写日志，见架构 §8.7） */
  | { t: 'raw'; sessionId?: string; line: string };

export type EventHandler = (e: RuntimeEvent) => void;
export type Unsubscribe = () => void;
