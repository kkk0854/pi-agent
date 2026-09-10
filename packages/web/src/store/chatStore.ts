/**
 * 聊天领域模型与 store（③视图层领域状态）：
 * ChatMessage/ChatBlock 由 RuntimeEvent 归一化而来；applyChatEvent 为纯函数（可单测）。
 * 关键约定：内容块按 block.start/delta/end 增量累积（禁止整段替换，架构 §3.4）。
 */
import { create } from 'zustand';
import type { RuntimeEvent, SessionStatus, SessionEntry } from '@pi-agent/shared';
import type { ExtensionUIRequest } from '@pi-agent/shared';

/* ---------- 模型 ---------- */

export type ChatBlock =
  | { kind: 'text'; blockIndex: number; text: string; done: boolean }
  | { kind: 'thinking'; blockIndex: number; text: string; done: boolean }
  | {
      kind: 'toolCall';
      blockIndex: number;
      toolCallId: string;
      toolName: string;
      args: unknown;
      partial?: unknown;
      result?: unknown;
      isError: boolean;
      done: boolean;
    };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  blocks: ChatBlock[];
  done: boolean;
  /** 对应 pi 会话条目 id（entry_appended 挂载；「从此处分叉」精确定位用，T04b） */
  entryId?: string;
}

export interface ChatError {
  code: string;
  message: string;
  recoverable: boolean;
}

/* ---------- 事件归约（纯函数） ---------- */

export function applyChatEvent(messages: ChatMessage[], e: RuntimeEvent): ChatMessage[] {
  switch (e.t) {
    case 'message.start': {
      return [...messages, { id: e.messageId, role: 'assistant', blocks: [], done: false }];
    }
    case 'block.start': {
      return mapMessages(messages, e.messageId, (msg) => {
        if (msg.blocks.some((b) => b.blockIndex === e.blockIndex)) return msg;
        const block: ChatBlock =
          e.kind === 'toolCall'
            ? {
                kind: 'toolCall',
                blockIndex: e.blockIndex,
                toolCallId: `pending-${e.blockIndex}-${msg.blocks.length}`,
                toolName: '…',
                args: null,
                isError: false,
                done: false,
              }
            : { kind: e.kind, blockIndex: e.blockIndex, text: '', done: false };
        return { ...msg, blocks: [...msg.blocks, block] };
      });
    }
    case 'block.delta': {
      return mapMessages(messages, e.messageId, (msg) => ({
        ...msg,
        blocks: msg.blocks.map((b) => {
          if (b.blockIndex !== e.blockIndex) return b;
          if (b.kind === 'text' || b.kind === 'thinking') {
            return { ...b, text: b.text + e.delta };
          }
          return b;
        }),
      }));
    }
    case 'block.end': {
      return mapMessages(messages, e.messageId, (msg) => ({
        ...msg,
        blocks: msg.blocks.map((b) => (b.blockIndex === e.blockIndex ? { ...b, done: true } : b)),
      }));
    }
    case 'message.end': {
      return mapMessages(messages, e.messageId, (msg) => ({ ...msg, done: true }));
    }
    case 'tool.start': {
      // 工具事件独立于 message_update 块流：优先补全占位块，否则追加/新建消息
      return withOpenMessage(messages, (msg) => {
        const exact = msg.blocks.find(
          (b) => b.kind === 'toolCall' && b.toolCallId === e.toolCallId,
        );
        if (exact) {
          return mapBlocks(msg, e.toolCallId, (b) => ({ ...b, toolName: e.toolName, args: e.args }));
        }
        const placeholder = msg.blocks.find(
          (b) => b.kind === 'toolCall' && b.toolName === '…',
        );
        if (placeholder && placeholder.kind === 'toolCall') {
          return mapBlocks(msg, placeholder.toolCallId, (b) => ({
            ...b,
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            args: e.args,
          }));
        }
        return {
          ...msg,
          blocks: [
            ...msg.blocks,
            {
              kind: 'toolCall' as const,
              blockIndex: -1,
              toolCallId: e.toolCallId,
              toolName: e.toolName,
              args: e.args,
              isError: false,
              done: false,
            },
          ],
        };
      });
    }
    case 'tool.update': {
      return messages.map((msg) => {
        const block = msg.blocks.find(
          (b) => b.kind === 'toolCall' && b.toolCallId === e.toolCallId,
        );
        if (!block) return msg;
        return mapBlocks(msg, e.toolCallId, (b) => ({ ...b, partial: e.partialResult }));
      });
    }
    case 'tool.end': {
      return messages.map((msg) => {
        const block = msg.blocks.find(
          (b) => b.kind === 'toolCall' && b.toolCallId === e.toolCallId,
        );
        if (!block) return msg;
        return mapBlocks(msg, e.toolCallId, (b) => ({
          ...b,
          result: e.result,
          isError: e.isError,
          done: true,
        }));
      });
    }    case 'agent.settled': {
      // 一轮终态：所有未完成块与消息收口
      return messages.map((msg) => ({
        ...msg,
        done: true,
        blocks: msg.blocks.map((b) => ({ ...b, done: true })),
      }));
    }
    case 'entry.appended': {
      // T04b：把 pi 会话条目 id 挂到对应消息（优先 entry 内嵌 message.id，
      // 否则回退最近一条 assistant 消息）——「从此处分叉」的精确定位
      const entryId = e.entry.id;
      const targetId = extractEntryMessageId(e.entry) ?? lastAssistantMessageId(messages);
      if (!entryId || !targetId) return messages;
      return messages.map((m) => (m.id === targetId ? { ...m, entryId } : m));
    }
    default:
      return messages;
  }
}

/** 从 entry 里提取内嵌消息 id（message.id / messageId 两种形态） */
function extractEntryMessageId(entry: SessionEntry): string | null {
  const msg = entry['message'];
  if (msg !== null && typeof msg === 'object' && typeof (msg as { id?: unknown }).id === 'string') {
    return (msg as { id: string }).id;
  }
  const mid = entry['messageId'];
  if (typeof mid === 'string' && mid.length > 0) return mid;
  return null;
}

/** 最近一条 assistant 消息 id（entry 无内嵌消息时的回退挂载点） */
function lastAssistantMessageId(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'assistant') return messages[i]!.id;
  }
  return null;
}

function mapMessages(
  messages: ChatMessage[],
  messageId: string,
  fn: (msg: ChatMessage) => ChatMessage,
): ChatMessage[] {
  const idx = messages.findIndex((m) => m.id === messageId);
  if (idx === -1) return messages;
  const next = [...messages];
  next[idx] = fn(next[idx]!);
  return next;
}

function mapBlocks(msg: ChatMessage, toolCallId: string, fn: (b: ChatBlock) => ChatBlock): ChatMessage {
  return {
    ...msg,
    blocks: msg.blocks.map((b) =>
      b.kind === 'toolCall' && b.toolCallId === toolCallId ? fn(b) : b,
    ),
  };
}

/** 取最后一条未完成的 assistant 消息（无则新建）后执行 fn */
function withOpenMessage(messages: ChatMessage[], fn: (msg: ChatMessage) => ChatMessage): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (last && last.role === 'assistant' && !last.done) {
    const next = [...messages];
    next[next.length - 1] = fn(last);
    return next;
  }
  return [...messages, fn({ id: `a-${Date.now()}`, role: 'assistant', blocks: [], done: false })];
}

/* ---------- Store ---------- */

export interface ChatStore {
  sessionId: string | null;
  messages: ChatMessage[];
  status: SessionStatus | null;
  /** extension_ui_request 审批/输入请求（同一时刻至多一个，A-06） */
  pendingRequest: ExtensionUIRequest | null;
  /** 状态条 key → text */
  statusText: Record<string, string>;
  error: ChatError | null;
  /** 最后一条用户输入（重新生成用） */
  lastUserText: string | null;

  setSession(sessionId: string | null): void;
  appendUserMessage(text: string): void;
  applyEvent(e: RuntimeEvent): void;
  setPendingRequest(req: ExtensionUIRequest | null): void;
  clearError(): void;
}

export const useChatStore = create<ChatStore>()((set) => ({
  sessionId: null,
  messages: [],
  status: null,
  pendingRequest: null,
  statusText: {},
  error: null,
  lastUserText: null,

  setSession(sessionId: string | null): void {
    set({
      sessionId,
      messages: [],
      status: sessionId ? 'connecting' : null,
      pendingRequest: null,
      statusText: {},
      error: null,
      lastUserText: null,
    });
  },

  appendUserMessage(text: string): void {
    set((s) => ({
      messages: [...s.messages, { id: `u-${Date.now()}`, role: 'user', blocks: [{ kind: 'text' as const, blockIndex: 0, text, done: true }], done: true }],
      lastUserText: text,
    }));
  },

  applyEvent(e: RuntimeEvent): void {
    set((s) => {
      // 事件与会话不匹配时忽略（切会话竞态防护）
      if (e.t === 'error') {
        if (e.sessionId && e.sessionId !== s.sessionId) return s;
        return { error: { code: e.code, message: e.message, recoverable: e.recoverable } };
      }
      if ('sessionId' in e && e.sessionId !== s.sessionId) return s;

      switch (e.t) {
        case 'session.status':
          return { status: e.status };
        case 'ui.request':
          return { pendingRequest: e.req };
        case 'ui.status': {
          const next = { ...s.statusText };
          if (e.text.length === 0) delete next[e.statusKey];
          else next[e.statusKey] = e.text;
          return { statusText: next };
        }
        case 'agent.start':
        case 'turn.start':
          return { status: 'running' };
        case 'agent.settled':
          return { status: 'ready', messages: applyChatEvent(s.messages, e) };
        case 'message.start':
        case 'block.start':
        case 'block.delta':
        case 'block.end':
        case 'message.end':
        case 'tool.start':
        case 'tool.update':
        case 'tool.end':
        case 'entry.appended':
          return { messages: applyChatEvent(s.messages, e) };
        default:
          return s;
      }
    });
  },

  setPendingRequest(req: ExtensionUIRequest | null): void {
    set({ pendingRequest: req });
  },

  clearError(): void {
    set({ error: null });
  },
}));
