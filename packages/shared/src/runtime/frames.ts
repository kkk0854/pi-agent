/**
 * pi 原始帧的「宽松」TS 类型（frames.ts）。
 * 只保证判别所需的最小形状，其余字段透传（协议演进不破前端）。
 */

/** 命令回执帧 */
export interface PiResponseFrame {
  type: 'response';
  id: string;
  command?: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

/** message_start / message_update / message_end 中的消息引用 */
export interface PiMessageRef {
  id?: string;
  role?: string;
  content?: unknown;
  [key: string]: unknown;
}

/** AssistantMessageEvent（嵌在 message_update 内，流式渲染主通道） */
export interface PiAssistantMessageEvent {
  type: string;
  contentIndex?: number;
  delta?: string;
  partial?: unknown;
  message?: string;
  [key: string]: unknown;
}

/** AgentSessionEvent / AgentEvent 帧（事件流） */
export interface PiAgentEventFrame {
  type: string;
  /** message_* 事件携带 */
  message?: PiMessageRef;
  assistantMessageEvent?: PiAssistantMessageEvent;
  /** tool_execution_* 携带 */
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  partialResult?: unknown;
  result?: unknown;
  isError?: boolean;
  /** turn_end / agent_end 携带 */
  toolResults?: unknown[];
  messages?: unknown[];
  /** agent_settled / compaction_end 携带 */
  willRetry?: boolean;
  /** queue_update 携带 */
  steering?: unknown[];
  followUp?: unknown[];
  /** compaction_start 携带 */
  reason?: string;
  aborted?: boolean;
  summary?: string;
  /** auto_retry_start 携带 */
  attempt?: number;
  maxAttempts?: number;
  delayMs?: number;
  /** auto_retry_end 携带 */
  success?: boolean;
  /** entry_appended 携带 */
  entry?: unknown;
  /** session_info_changed 携带 */
  name?: string;
  sessionFile?: string;
  /** bash_execution_update 携带 */
  delta?: string;
  [key: string]: unknown;
}

/** 扩展 UI 请求帧（扩展向宿主索要交互） */
export interface PiExtensionUiRequestFrame {
  type: 'extension_ui_request';
  id: string;
  method: string;
  title?: string;
  message?: string;
  options?: unknown[];
  placeholder?: string;
  prefill?: string;
  timeout?: number;
  notifyType?: string;
  statusKey?: string;
  statusText?: string;
  widgetKey?: string;
  widgetLines?: string[];
  placement?: string;
  text?: string;
  [key: string]: unknown;
}

/** 任意 pi 出站帧（宽松联合，供 normalizer 判别） */
export type AnyPiFrame = PiResponseFrame | PiExtensionUiRequestFrame | PiAgentEventFrame;
