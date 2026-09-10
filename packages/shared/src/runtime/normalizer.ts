/**
 * PiFrameNormalizer（架构 §3.5）：原始 pi JSONL 行 → RuntimeEvent。
 * 真实 pi 与 Mock 产出完全同构的原始行，共用本实现（架构 §1.5）。
 *
 * 关键点：
 * - message_update 内嵌 assistantMessageEvent 按 contentIndex 分块累积（block.start/delta/end）
 * - agent_end 非终态；agent_settled 才是一轮终态
 * - extension_ui_request 文本先剥离 ANSI（A-12）；statusText 省略即视为清除该 statusKey
 * - 无法识别的帧 → raw + error{code:'protocol_unknown'}，前向兼容不崩
 */
import { newId } from '../util/id';
import { hasAnsi, stripAnsi } from '../util/ansi';
import type {
  AnyPiFrame,
  PiAgentEventFrame,
  PiAssistantMessageEvent,
  PiExtensionUiRequestFrame,
  PiMessageRef,
  PiResponseFrame,
} from './frames';
import type { RuntimeEvent } from './events';
import type { BlockKind, RpcSessionState, SessionStats } from './types';
import type {
  ExtensionUIRequest,
  UiNotifyLevel,
  UiWidgetPlacement,
} from '../protocol/permissions';

/** 命令响应处理器（Deferred 配对在 T02 的运行时层完成） */
export type PiResponseHandler = (frame: PiResponseFrame) => void;

/** assistantMessageEvent 前缀 → 内容块类型 */
const KIND_BY_EVENT_PREFIX: Record<string, BlockKind> = {
  text: 'text',
  thinking: 'thinking',
  toolcall: 'toolCall',
};

const NOTIFY_LEVELS: ReadonlySet<string> = new Set(['info', 'warning', 'error']);
const COMPACTION_REASONS: ReadonlySet<string> = new Set(['manual', 'threshold', 'overflow']);

export class PiFrameNormalizer {
  private readonly sessionId: string;
  private readonly responseHandlers = new Set<PiResponseHandler>();
  private currentTurnId: string | null = null;
  private lastMessageId: string | null = null;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /** 注册命令响应处理器，返回退订函数 */
  onResponse(handler: PiResponseHandler): () => void {
    this.responseHandlers.add(handler);
    return () => {
      this.responseHandlers.delete(handler);
    };
  }

  /** 解析单行（原始 JSONL），返回归一化事件（可能为空） */
  push(line: string): RuntimeEvent[] {
    const trimmed = line.trim();
    if (trimmed.length === 0) return [];
    let frame: AnyPiFrame;
    try {
      frame = JSON.parse(trimmed) as AnyPiFrame;
    } catch {
      return [this.raw(line), this.protocolError('收到无法解析为 JSON 的原始行')];
    }
    if (typeof frame !== 'object' || frame === null || typeof frame.type !== 'string') {
      return [this.raw(line), this.protocolError('帧缺少 type 字段，无法识别')];
    }
    return this.handleFrame(frame, line);
  }

  /** 批量解析 */
  pushMany(lines: string[]): RuntimeEvent[] {
    const events: RuntimeEvent[] = [];
    for (const line of lines) {
      events.push(...this.push(line));
    }
    return events;
  }

  /* ---------------- 内部实现 ---------------- */

  private raw(line: string): RuntimeEvent {
    return { t: 'raw', sessionId: this.sessionId, line };
  }

  private protocolError(message: string): RuntimeEvent {
    return {
      t: 'error',
      sessionId: this.sessionId,
      code: 'protocol_unknown',
      message,
      recoverable: true,
    };
  }

  private handleFrame(frame: AnyPiFrame, line: string): RuntimeEvent[] {
    // PiAgentEventFrame.type 为宽 string，需显式收窄
    if (frame.type === 'response') {
      return this.handleResponse(frame as PiResponseFrame, line);
    }
    if (frame.type === 'extension_ui_request') {
      return this.handleUiRequest(frame as PiExtensionUiRequestFrame, line);
    }
    return this.handleAgentEvent(frame as PiAgentEventFrame, line);
  }

  /* 命令回执：派发响应处理器；get_state / get_session_stats 额外发结构化事件 */
  private handleResponse(frame: PiResponseFrame, line: string): RuntimeEvent[] {
    for (const handler of this.responseHandlers) {
      try {
        handler(frame);
      } catch {
        // 处理器异常不影响主流程（归一化保持前向兼容）
      }
    }
    const events: RuntimeEvent[] = [];
    if (frame.success && frame.command === 'get_state') {
      events.push({
        t: 'session.state',
        sessionId: this.sessionId,
        state: frame.data as RpcSessionState,
      });
    } else if (frame.success && frame.command === 'get_session_stats') {
      events.push({
        t: 'stats.updated',
        sessionId: this.sessionId,
        stats: frame.data as SessionStats,
      });
    } else {
      // 命令失败与其他成功回执都保留原始帧（诊断面板可见）
      events.push(this.raw(line));
    }
    return events;
  }

  /* 扩展 UI 请求：按 method 分派为 ui.* 事件 */
  private handleUiRequest(frame: PiExtensionUiRequestFrame, line: string): RuntimeEvent[] {
    const sid = this.sessionId;
    switch (frame.method) {
      case 'select':
      case 'confirm':
      case 'input':
      case 'editor': {
        const req: ExtensionUIRequest = {
          id: frame.id,
          method: frame.method,
          title: stripAnsi(str(frame.title)),
          message: stripAnsi(str(frame.message)),
          options: Array.isArray(frame.options)
            ? frame.options.map((o) => stripAnsi(String(o)))
            : undefined,
          placeholder: strOrUndef(frame.placeholder),
          prefill: strOrUndef(frame.prefill),
          timeout: typeof frame.timeout === 'number' ? frame.timeout : undefined,
        };
        return [{ t: 'ui.request', sessionId: sid, req }];
      }
      case 'notify': {
        const levelRaw = str(frame.notifyType) || 'info';
        const level: UiNotifyLevel = NOTIFY_LEVELS.has(levelRaw)
          ? (levelRaw as UiNotifyLevel)
          : 'info';
        return [
          { t: 'ui.notify', sessionId: sid, message: stripAnsi(str(frame.message)), level },
        ];
      }
      case 'setStatus': {
        // statusText 省略即视为清除该 statusKey（剥离后为空串）
        const rawText = str(frame.statusText);
        return [
          {
            t: 'ui.status',
            sessionId: sid,
            statusKey: str(frame.statusKey) || 'default',
            text: stripAnsi(rawText),
            ansi: hasAnsi(rawText),
          },
        ];
      }
      case 'setWidget': {
        const placementRaw = str(frame.placement);
        const placement: UiWidgetPlacement =
          placementRaw === 'belowEditor' ? 'belowEditor' : 'aboveEditor';
        return [
          {
            t: 'ui.widget',
            sessionId: sid,
            key: str(frame.widgetKey) || 'default',
            lines: Array.isArray(frame.widgetLines)
              ? frame.widgetLines.map((l) => stripAnsi(String(l)))
              : [],
            placement,
          },
        ];
      }
      case 'setTitle':
        return [{ t: 'ui.title', sessionId: sid, title: stripAnsi(str(frame.title)) }];
      case 'set_editor_text':
        return [{ t: 'ui.setEditorText', sessionId: sid, text: str(frame.text) }];
      default:
        return [this.raw(line)];
    }
  }

  /* 事件流：AgentSessionEvent / AgentEvent */
  private handleAgentEvent(frame: PiAgentEventFrame, line: string): RuntimeEvent[] {
    const sid = this.sessionId;
    switch (frame.type) {
      case 'agent_start': {
        this.currentTurnId = newId();
        return [{ t: 'agent.start', sessionId: sid, turnId: this.currentTurnId }];
      }
      case 'turn_start': {
        if (this.currentTurnId === null) this.currentTurnId = newId();
        return [{ t: 'turn.start', sessionId: sid, turnId: this.currentTurnId }];
      }
      case 'turn_end': {
        const turnId = this.currentTurnId ?? newId();
        return [{ t: 'turn.end', sessionId: sid, turnId, toolResults: frame.toolResults }];
      }
      case 'message_start':
        return this.handleMessageBoundary(frame, 'message.start');
      case 'message_end':
        return this.handleMessageBoundary(frame, 'message.end');
      case 'message_update':
        return this.handleMessageUpdate(frame, line);
      case 'tool_execution_start': {
        if (typeof frame.toolCallId !== 'string') return [this.raw(line)];
        return [
          {
            t: 'tool.start',
            sessionId: sid,
            toolCallId: frame.toolCallId,
            toolName: str(frame.toolName) || 'unknown',
            args: frame.args,
          },
        ];
      }
      case 'tool_execution_update': {
        if (typeof frame.toolCallId !== 'string') return [this.raw(line)];
        return [
          {
            t: 'tool.update',
            sessionId: sid,
            toolCallId: frame.toolCallId,
            partialResult: frame.partialResult,
          },
        ];
      }
      case 'tool_execution_end': {
        if (typeof frame.toolCallId !== 'string') return [this.raw(line)];
        return [
          {
            t: 'tool.end',
            sessionId: sid,
            toolCallId: frame.toolCallId,
            result: frame.result,
            isError: frame.isError === true,
          },
        ];
      }
      case 'agent_end': {
        // 非终态：UI 仍显示「运行中」
        const turnId = this.currentTurnId ?? newId();
        return [{ t: 'agent.end', sessionId: sid, turnId }];
      }
      case 'agent_settled': {
        // 一轮彻底结束；此后重置轮次
        const turnId = this.currentTurnId ?? newId();
        this.currentTurnId = null;
        return [
          { t: 'agent.settled', sessionId: sid, turnId, willRetry: frame.willRetry === true },
        ];
      }
      case 'queue_update': {
        return [
          {
            t: 'queue.update',
            sessionId: sid,
            steering: Array.isArray(frame.steering) ? frame.steering : [],
            followUp: Array.isArray(frame.followUp) ? frame.followUp : [],
          },
        ];
      }
      case 'compaction_start': {
        const reasonRaw = str(frame.reason);
        const reason = COMPACTION_REASONS.has(reasonRaw)
          ? (reasonRaw as 'manual' | 'threshold' | 'overflow')
          : 'manual';
        return [{ t: 'compaction.start', sessionId: sid, reason }];
      }
      case 'compaction_end': {
        return [
          {
            t: 'compaction.end',
            sessionId: sid,
            aborted: frame.aborted === true,
            willRetry: frame.willRetry === true,
            summary: strOrUndef(frame.summary),
          },
        ];
      }
      case 'auto_retry_start': {
        return [
          {
            t: 'retry.start',
            sessionId: sid,
            attempt: num(frame.attempt, 1),
            maxAttempts: num(frame.maxAttempts, 0),
            delayMs: num(frame.delayMs, 0),
          },
        ];
      }
      case 'auto_retry_end': {
        return [{ t: 'retry.end', sessionId: sid, success: frame.success === true }];
      }
      case 'entry_appended': {
        const entry = frame.entry;
        const entryId =
          entry !== null && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string'
            ? (entry as { id: string }).id
            : newId();
        return [
          {
            t: 'entry.appended',
            sessionId: sid,
            entry: { id: entryId, ...(entry as Record<string, unknown> | null | undefined) },
          },
        ];
      }
      case 'session_info_changed': {
        return [
          {
            t: 'session.info',
            sessionId: sid,
            name: strOrUndef(frame.name),
            sessionFile: strOrUndef(frame.sessionFile),
          },
        ];
      }
      case 'bash_execution_update': {
        return [
          { t: 'bash.output', sessionId: sid, id: strOrUndef(frame.id), delta: str(frame.delta) },
        ];
      }
      default:
        return [this.raw(line), this.protocolError(`未知事件类型：${frame.type}`)];
    }
  }

  /* message_start / message_end：仅 assistant 消息进入渲染流 */
  private handleMessageBoundary(
    frame: PiAgentEventFrame,
    kind: 'message.start' | 'message.end',
  ): RuntimeEvent[] {
    const msg: PiMessageRef | undefined = frame.message;
    const role = typeof msg?.role === 'string' && msg.role.length > 0 ? msg.role : 'assistant';
    if (role !== 'assistant') return [];
    if (kind === 'message.start') {
      // pi 的 assistant 帧通常不带 id：message.start 必须生成新 id（每条消息唯一），
      // 后续 update/end 帧经 lastMessageId 关联到同一条消息。
      // 若直接复用 lastMessageId，多 turn 会话的所有消息会共享同一 id（React key 冲突）。
      const explicitId = msg && typeof msg.id === 'string' && msg.id.length > 0 ? msg.id : null;
      const messageId = explicitId ?? newId();
      this.lastMessageId = messageId;
      return [{ t: 'message.start', sessionId: this.sessionId, messageId, role: 'assistant' }];
    }
    const messageId = this.resolveMessageId(msg);
    return [{ t: 'message.end', sessionId: this.sessionId, messageId }];
  }

  /* message_update 内嵌 assistantMessageEvent → block.start/delta/end */
  private handleMessageUpdate(frame: PiAgentEventFrame, line: string): RuntimeEvent[] {
    const ev: PiAssistantMessageEvent | undefined = frame.assistantMessageEvent;
    if (!ev || typeof ev.type !== 'string') return [this.raw(line)];
    const messageId = this.resolveMessageId(frame.message);
    const type = ev.type;

    if (type === 'start' || type === 'done') return [];
    if (type === 'error') {
      return [
        {
          t: 'error',
          sessionId: this.sessionId,
          code: 'unknown',
          message: stripAnsi(str(ev.message) || 'assistant 流式事件错误'),
          recoverable: true,
        },
      ];
    }

    const underscore = type.indexOf('_');
    const prefix = underscore === -1 ? type : type.slice(0, underscore);
    const suffix = underscore === -1 ? '' : type.slice(underscore + 1);
    const kind = KIND_BY_EVENT_PREFIX[prefix];
    if (!kind) return [this.raw(line)];

    const blockIndex = typeof ev.contentIndex === 'number' ? ev.contentIndex : 0;
    if (suffix === 'start') {
      return [{ t: 'block.start', sessionId: this.sessionId, messageId, blockIndex, kind }];
    }
    if (suffix === 'delta') {
      return [
        {
          t: 'block.delta',
          sessionId: this.sessionId,
          messageId,
          blockIndex,
          kind,
          delta: typeof ev.delta === 'string' ? ev.delta : '',
        },
      ];
    }
    if (suffix === 'end') {
      return [{ t: 'block.end', sessionId: this.sessionId, messageId, blockIndex, kind }];
    }
    return [this.raw(line)];
  }

  private resolveMessageId(msg: PiMessageRef | undefined): string {
    if (msg && typeof msg.id === 'string' && msg.id.length > 0) {
      this.lastMessageId = msg.id;
      return msg.id;
    }
    if (this.lastMessageId !== null) return this.lastMessageId;
    const generated = newId();
    this.lastMessageId = generated;
    return generated;
  }
}

/* ---------------- 小工具 ---------------- */

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function strOrUndef(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
