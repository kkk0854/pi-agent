/**
 * PiBridge（架构 §2.3 runtime/PiBridge.ts）：
 * WS 封套 { ch, type, payload } ↔ SessionManager 双向桥接。
 *
 * 上行（web → host）：
 * - session.open  { OpenSessionRequest } → spawn pi，广播 session.status
 * - session.write { line }               → 写 pi stdin（host 不解析，仅透传）
 * - session.close { recycle }            → 回收/分离进程
 * 下行（host → web）：
 * - session.lines  { lines }  原始 JSONL 行批量（严格 \n 分帧后原样中继）
 * - session.status { status } 通道/进程状态（含错误码，引导前端）
 */
import type { HostWireFrame, OpenSessionRequest } from '@pi-agent/shared';
import type { SpawnError } from '../pi/spawn';
import type { SessionManager } from './SessionManager';

export interface BridgeLogger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface PiBridgeOptions {
  sessions: SessionManager;
  /** 下行广播（WS hub，本地单用户模型：所有已认证客户端可见） */
  broadcast(frame: HostWireFrame): void;
  logger: BridgeLogger;
  /**
   * 默认模型兜底（host settings.defaultModel）：session.open 未显式指定模型时注入，
   * 避免 pi 落到未配置 key 的默认 provider。
   */
  defaultModel?: { provider: string; modelId: string };
}

export class PiBridge {
  private readonly sessions: SessionManager;
  private readonly broadcast: (frame: HostWireFrame) => void;
  private readonly logger: BridgeLogger;
  private readonly defaultModel?: { provider: string; modelId: string };

  constructor(opts: PiBridgeOptions) {
    this.sessions = opts.sessions;
    this.broadcast = opts.broadcast;
    this.logger = opts.logger;
    this.defaultModel = opts.defaultModel;
  }

  /** WS 层收到的会话帧入口（ch = appSessionId） */
  handleFrame(frame: HostWireFrame): void {
    const ch = frame.ch;
    if (!ch || ch === 'sys') {
      this.sendError(frame.ch, 'bad_request', '缺少会话通道标识 ch');
      return;
    }
    switch (frame.type) {
      case 'session.open':
        this.open(ch, frame.payload);
        return;
      case 'session.write':
        this.write(ch, frame.payload);
        return;
      case 'session.close':
        void this.close(ch, frame.payload);
        return;
      default:
        this.sendError(ch, 'not_found', `未知会话帧类型：${frame.type}`);
    }
  }

  /** host 退出前回收全部会话进程 */
  async dispose(): Promise<void> {
    await this.sessions.dispose();
  }

  /* ---------- 上行 ---------- */

  private open(ch: string, payload: unknown): void {
    const req = this.parseOpenRequest(payload);
    if (!req) {
      this.sendError(ch, 'bad_request', 'session.open 缺少合法的 OpenSessionRequest 载荷');
      return;
    }
    // 默认模型兜底：请求未显式指定时用 host settings.defaultModel
    const merged: OpenSessionRequest =
      req.model || !this.defaultModel ? req : { ...req, model: this.defaultModel };
    this.pushStatus(ch, 'connecting');
    try {
      this.sessions.open(ch, merged);
      this.logger.info('pi 会话请求已受理', {
        appSessionId: ch,
        cwd: merged.projectPath,
        model: merged.model ? `${merged.model.provider}/${merged.model.modelId}` : '（pi 默认）',
      });
    } catch (err) {
      const spawnErr = err as SpawnError;
      const code = typeof spawnErr?.code === 'string' ? spawnErr.code : 'agent_crash';
      this.logger.warn('pi 会话打开失败', { appSessionId: ch, code, message: spawnErr?.message });
      this.pushStatus(ch, 'error', spawnErr?.message ?? String(err), code);
    }
  }

  private write(ch: string, payload: unknown): void {
    const line =
      payload !== null && typeof payload === 'object' && typeof (payload as { line?: unknown }).line === 'string'
        ? (payload as { line: string }).line
        : null;
    if (line === null) {
      this.sendError(ch, 'bad_request', 'session.write 需要 { line: string } 载荷');
      return;
    }
    const ok = this.sessions.write(ch, line);
    if (!ok) {
      // 会话不存在 / 进程已死：通知前端走重连引导
      const record = this.sessions.get(ch);
      this.pushStatus(
        ch,
        'error',
        record ? `会话状态 ${record.status}，无法写入` : '会话不存在或已关闭，请重新连接',
        'agent_crash',
      );
    }
  }

  private async close(ch: string, payload: unknown): Promise<void> {
    const recycle =
      payload !== null && typeof payload === 'object' && typeof (payload as { recycle?: unknown }).recycle === 'boolean'
        ? (payload as { recycle: boolean }).recycle
        : true;
    await this.sessions.close(ch, { recycle });
    this.pushStatus(ch, 'closed', recycle ? '进程已回收' : '通道已分离，进程保留');
  }

  /* ---------- 下行（供 index.ts 装配 SessionManager 回调） ---------- */

  onSessionLines(appSessionId: string, lines: string[]): void {
    this.broadcast({
      ch: appSessionId,
      type: 'session.lines',
      payload: { lines },
    });
  }

  onSessionExit(
    appSessionId: string,
    payload: { code: number | null; signal: NodeJS.Signals | null; error: { code: string; message: string } | null },
  ): void {
    if (payload.error) {
      this.pushStatus(appSessionId, 'error', payload.error.message, payload.error.code);
    } else {
      this.pushStatus(appSessionId, 'closed', `进程退出（code=${payload.code ?? 'null'}）`);
    }
  }

  /* ---------- 内部 ---------- */

  private parseOpenRequest(payload: unknown): OpenSessionRequest | null {
    if (payload === null || typeof payload !== 'object') return null;
    const obj = payload as Record<string, unknown>;
    if (typeof obj['appSessionId'] !== 'string' || obj['appSessionId'].length === 0) return null;
    // permissionTier 必填（影响 --tools 组装）
    if (typeof obj['permissionTier'] !== 'string') return null;
    return payload as OpenSessionRequest;
  }

  private pushStatus(
    ch: string,
    status: 'connecting' | 'open' | 'closed' | 'error',
    detail?: string,
    code?: string,
  ): void {
    const payload: { status: typeof status; detail?: string; code?: string } = { status };
    if (detail !== undefined) payload.detail = detail;
    if (code !== undefined) payload.code = code;
    this.broadcast({ ch, type: 'session.status', payload });
  }

  private sendError(ch: string, code: string, message: string): void {
    this.broadcast({ ch, type: 'error', payload: { code, message } });
  }
}
