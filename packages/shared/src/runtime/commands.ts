/**
 * pi 命令构造器（35 种命令 + 命令名常量）。
 * 全部命令形如 { id, type, ...payload }，id 用于响应关联（Deferred 配对）。
 */
import { newId } from '../util/id';
import type { ImageAttachment, ThinkingLevel } from './types';

/** 与 pi RPC 协议一致的命令名（snake_case） */
export const PI_COMMANDS = [
  'prompt',
  'steer',
  'follow_up',
  'abort',
  'clear_queue',
  'new_session',
  'get_state',
  'get_messages',
  'set_model',
  'cycle_model',
  'get_available_models',
  'set_thinking_level',
  'cycle_thinking_level',
  'get_available_thinking_levels',
  'set_steering_mode',
  'set_follow_up_mode',
  'compact',
  'set_auto_compaction',
  'set_auto_retry',
  'abort_retry',
  'bash',
  'abort_bash',
  'get_session_stats',
  'export_html',
  'switch_session',
  'fork',
  'clone',
  'get_fork_messages',
  'get_entries',
  'get_tree',
  'get_last_assistant_text',
  'set_session_name',
  'get_commands',
  'extension_ui_response',
] as const;

export type PiCommandType = (typeof PI_COMMANDS)[number];

export interface PiOutboundCommand {
  id: string;
  type: PiCommandType;
  [key: string]: unknown;
}

/** 通用构造器：缺失 id 时自动生成 */
export function createPiCommand(
  type: PiCommandType,
  payload: Record<string, unknown> = {},
  id: string = newId(),
): PiOutboundCommand {
  return { id, type, ...payload };
}

export interface PromptOptions {
  images?: ImageAttachment[];
  /** 流式中调用 prompt 必须显式给出（协议约束 3） */
  streamingBehavior?: 'steer' | 'followUp';
}

/** 逐命令构造器集合（一行一个命令） */
export const piCommands = {
  prompt: (message: string, opts?: PromptOptions, id?: string): PiOutboundCommand =>
    createPiCommand(
      'prompt',
      {
        message,
        ...(opts?.images ? { images: opts.images } : {}),
        ...(opts?.streamingBehavior ? { streamingBehavior: opts.streamingBehavior } : {}),
      },
      id,
    ),
  steer: (message: string, images?: ImageAttachment[], id?: string): PiOutboundCommand =>
    createPiCommand('steer', { message, ...(images ? { images } : {}) }, id),
  followUp: (message: string, images?: ImageAttachment[], id?: string): PiOutboundCommand =>
    createPiCommand('follow_up', { message, ...(images ? { images } : {}) }, id),
  abort: (id?: string): PiOutboundCommand => createPiCommand('abort', {}, id),
  clearQueue: (id?: string): PiOutboundCommand => createPiCommand('clear_queue', {}, id),
  newSession: (parentSession?: string, id?: string): PiOutboundCommand =>
    createPiCommand('new_session', parentSession ? { parentSession } : {}, id),
  getState: (id?: string): PiOutboundCommand => createPiCommand('get_state', {}, id),
  getMessages: (id?: string): PiOutboundCommand => createPiCommand('get_messages', {}, id),
  setModel: (provider: string, modelId: string, id?: string): PiOutboundCommand =>
    createPiCommand('set_model', { provider, modelId }, id),
  cycleModel: (id?: string): PiOutboundCommand => createPiCommand('cycle_model', {}, id),
  getAvailableModels: (id?: string): PiOutboundCommand =>
    createPiCommand('get_available_models', {}, id),
  setThinkingLevel: (level: ThinkingLevel, id?: string): PiOutboundCommand =>
    createPiCommand('set_thinking_level', { level }, id),
  cycleThinkingLevel: (id?: string): PiOutboundCommand =>
    createPiCommand('cycle_thinking_level', {}, id),
  getAvailableThinkingLevels: (id?: string): PiOutboundCommand =>
    createPiCommand('get_available_thinking_levels', {}, id),
  setSteeringMode: (mode: 'all' | 'one-at-a-time', id?: string): PiOutboundCommand =>
    createPiCommand('set_steering_mode', { mode }, id),
  setFollowUpMode: (mode: 'all' | 'one-at-a-time', id?: string): PiOutboundCommand =>
    createPiCommand('set_follow_up_mode', { mode }, id),
  compact: (customInstructions?: string, id?: string): PiOutboundCommand =>
    createPiCommand('compact', customInstructions ? { customInstructions } : {}, id),
  setAutoCompaction: (enabled: boolean, id?: string): PiOutboundCommand =>
    createPiCommand('set_auto_compaction', { enabled }, id),
  setAutoRetry: (enabled: boolean, id?: string): PiOutboundCommand =>
    createPiCommand('set_auto_retry', { enabled }, id),
  abortRetry: (id?: string): PiOutboundCommand => createPiCommand('abort_retry', {}, id),
  bash: (command: string, excludeFromContext?: boolean, id?: string): PiOutboundCommand =>
    createPiCommand('bash', { command, ...(excludeFromContext ? { excludeFromContext } : {}) }, id),
  abortBash: (id?: string): PiOutboundCommand => createPiCommand('abort_bash', {}, id),
  getSessionStats: (id?: string): PiOutboundCommand => createPiCommand('get_session_stats', {}, id),
  exportHtml: (outputPath?: string, id?: string): PiOutboundCommand =>
    createPiCommand('export_html', outputPath ? { outputPath } : {}, id),
  switchSession: (sessionPath: string, id?: string): PiOutboundCommand =>
    createPiCommand('switch_session', { sessionPath }, id),
  fork: (entryId: string, id?: string): PiOutboundCommand =>
    createPiCommand('fork', { entryId }, id),
  clone: (id?: string): PiOutboundCommand => createPiCommand('clone', {}, id),
  getForkMessages: (id?: string): PiOutboundCommand => createPiCommand('get_fork_messages', {}, id),
  getEntries: (since?: number, id?: string): PiOutboundCommand =>
    createPiCommand('get_entries', since !== undefined ? { since } : {}, id),
  getTree: (id?: string): PiOutboundCommand => createPiCommand('get_tree', {}, id),
  getLastAssistantText: (id?: string): PiOutboundCommand =>
    createPiCommand('get_last_assistant_text', {}, id),
  setSessionName: (name: string, id?: string): PiOutboundCommand =>
    createPiCommand('set_session_name', { name }, id),
  getCommands: (id?: string): PiOutboundCommand => createPiCommand('get_commands', {}, id),
  /** 应答扩展 UI 请求（宿主必须回，否则扩展流程卡死） */
  extensionUiResponse: (
    requestId: string,
    resp: { value?: string; confirmed?: boolean; cancelled?: boolean },
    id?: string,
  ): PiOutboundCommand =>
    createPiCommand(
      'extension_ui_response',
      {
        id: requestId,
        ...(resp.value !== undefined ? { value: resp.value } : {}),
        ...(resp.confirmed !== undefined ? { confirmed: resp.confirmed } : {}),
        ...(resp.cancelled !== undefined ? { cancelled: resp.cancelled } : {}),
      },
      id,
    ),
};
