/**
 * web ↔ host 的线协议（WS 帧封套 + REST DTO + 错误码）。
 * host 只做透传原始行，不做协议解析（架构 §1.5）。
 */

/** host 端点信息（写入 {appData}/pi-agent/host.json，0600） */
export interface HostEndpoint {
  httpUrl: string;
  wsUrl: string;
  token: string;
  pid: number;
  version?: string;
  startedAt?: string;
}

/** GET /v1/health 响应 */
export interface HealthInfo {
  ok: boolean;
  version: string;
  pi: {
    found: boolean;
    version?: string | null;
    path?: string | null;
  };
  connectLockBusy?: boolean;
  endpoints?: {
    httpUrl: string;
    wsUrl: string;
  };
}

/** WS 帧封套：{ ch, type, payload } */
export interface HostWireFrame {
  /** 通道标识：会话通道为 appSessionId，控制通道为 'sys' */
  ch: string;
  type: string;
  payload?: unknown;
}

/** 线协议错误码 */
export type HostWireErrorCode =
  | 'unauthorized'
  | 'bad_request'
  | 'not_found'
  | 'busy'
  | 'internal';

export interface HostWireError {
  code: HostWireErrorCode;
  message: string;
}

/** host 会话通道下行帧：原始 pi JSONL 行批量（host 不解析） */
export interface SessionLinesPayload {
  /** 原始 JSONL 行（已按 \n 分帧） */
  lines: string[];
}

/** host 会话通道上行帧：写一行到 pi stdin（host 不解析，仅透传） */
export interface SessionWritePayload {
  /** 单行 JSON 字符串（不含换行） */
  line: string;
}

/** 会话通道状态（host 推送；通道断 ≠ 会话结束） */
export type ChannelStatusPayload = {
  status: 'connecting' | 'open' | 'closed' | 'error';
  detail?: string;
  /** status='error' 时的细分错误码（cli_not_found / busy / agent_crash …） */
  code?: string;
};

export const HOST_WIRE_VERSION = 1;
