/**
 * HostAgentRuntime（架构 §3.2 真实实现）：
 * WebSocket（host 封套）→ 原始 JSONL 行 → PiFrameNormalizer → StreamCoalescer → RuntimeEvent。
 * - 无 ready 帧：openSession 后发 get_state，等 response 即握手完成（C-02）
 * - 命令 Deferred 配对（id ↔ response），带超时
 * - 会话通道断开 ≠ 会话结束：session.status closed/error 上抛为事件
 */
import {
  PiFrameNormalizer,
  piCommands,
  capabilitiesForVersion,
  type AgentRuntime,
  type EventHandler,
  type ForkResult,
  type ImageAttachment,
  type ModelRef,
  type OpenSessionRequest,
  type PiProbeResult,
  type RuntimeCapabilities,
  type RuntimeEvent,
  type RuntimeInitConfig,
  type SendAck,
  type SendInput,
  type SessionHandle,
  type SessionStats,
  type SessionTreeNode,
  type SessionEntry,
  type AgentMessage,
  type SlashCommand,
  type RpcSessionState,
  type Thinking,
  type QueueMode,
  type TreeResult,
  type ForkPoint,
  type ExtensionUIResponse,
  type RuntimeError,
  type HostEndpoint,
  type ChannelStatus,
  type HostWireFrame,
} from '@pi-agent/shared';
import { StreamCoalescer } from './StreamCoalescer';
import { Deferred } from './Deferred';

type ResponseData = Record<string, unknown> | unknown[] | unknown;

/** 打开会话的内部登记项 */
interface HostSession {
  appSessionId: string;
  normalizer: PiFrameNormalizer;
  coalescer: StreamCoalescer;
  piSessionId?: string;
  sessionFile?: string;
}

const REQUEST_TIMEOUT_MS = 20_000;

export class HostAgentRuntime implements AgentRuntime {
  readonly kind = 'host' as const;
  private cfg: RuntimeInitConfig | null = null;
  private endpoint: HostEndpoint | null = null;
  private ws: WebSocket | null = null;
  caps: RuntimeCapabilities = {
    mode: 'real',
    supports: {
      fork: false, tree: false, stats: false, commands: false, thinkingLevel: false,
      modelSwitch: false, compaction: false, autoRetry: false, extensionUI: true,
      bash: true, exportHtml: false, images: true, queueModes: false,
    },
  };
  private readonly handlers = new Set<EventHandler>();
  private readonly sessions = new Map<string, HostSession>();
  private readonly pending = new Map<string, Deferred<ResponseData>>();
  private readonly statusWaiters = new Map<string, ((s: ChannelStatus, err?: RuntimeError) => void)[]>();
  private wsReady: Promise<void> | null = null;
  private disposed = false;

  /** 能力矩阵快照（init 后由 applyProbeVersion 用 pi 版本刷新） */
  get capsSnapshot(): RuntimeCapabilities {
    return this.caps;
  }

  async init(cfg: RuntimeInitConfig): Promise<RuntimeCapabilities> {
    this.cfg = cfg;
    if (!cfg.host) {
      throw this.rtErr('unknown', 'HostAgentRuntime 需要提供 host 端点');
    }
    this.endpoint = cfg.host;
    await this.ensureWs(cfg.connectTimeoutMs);
    // 能力矩阵：由 pi 版本决定（探测经 health 完成，见 probe()）
    return this.caps;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const d of this.pending.values()) {
      d.reject({ code: 'unknown', message: '运行时已关闭', recoverable: false });
    }
    this.pending.clear();
    this.ws?.close(1000, 'client dispose');
    this.ws = null;
  }

  onEvent(h: EventHandler): () => void {
    this.handlers.add(h);
    return () => {
      this.handlers.delete(h);
    };
  }

  /** R-04：探测 pi 可用性（health 的 pi 字段，host 启动时已探测） */
  async probe(): Promise<PiProbeResult> {
    if (!this.endpoint) return { found: false, message: 'host 未连接' };
    try {
      const info = await this.fetchHealth();
      if (info.pi.found) {
        return {
          found: true,
          path: info.pi.path ?? undefined,
          version: info.pi.version ?? undefined,
          message: `已找到 pi ${info.pi.version ?? ''}`,
        };
      }
      return { found: false, errorCode: 'not_found', message: 'host 报告未找到 pi' };
    } catch {
      return { found: false, errorCode: 'not_found', message: '无法访问 host 健康检查' };
    }
  }

  /* ---------------- 会话生命周期 ---------------- */

  async openSession(req: OpenSessionRequest): Promise<SessionHandle> {
    await this.ensureWs(this.cfg?.connectTimeoutMs ?? 8000);
    // 通道打开：等待 host 的首个 session.status（connecting=受理 / error=失败）
    this.pendingOpen = req;
    const status = await this.waitChannelStatus(req.appSessionId, this.cfg?.connectTimeoutMs ?? 8000)
      .finally(() => {
        this.pendingOpen = null;
      });
    if (status.status === 'error') {
      throw status.err ?? this.rtErr('agent_crash', '通道打开失败');
    }

    // 登记 normalizer / coalescer
    const normalizer = new PiFrameNormalizer(req.appSessionId);
    const coalescer = new StreamCoalescer((e) => this.dispatch(e), 48);
    const unResponse = normalizer.onResponse((frame) => {
      const d = this.pending.get(frame.id);
      if (d) {
        this.pending.delete(frame.id);
        if (frame.success) d.resolve(frame.data);
        else d.reject({ code: 'unknown', message: frame.error ?? '命令执行失败', recoverable: true });
      }
    });
    void unResponse;
    const session: HostSession = { appSessionId: req.appSessionId, normalizer, coalescer };
    this.sessions.set(req.appSessionId, session);

    // 握手：get_state → response（无 ready 帧，C-02）
    const state = await this.command<RpcSessionState>(req.appSessionId, piCommands.getState());
    session.piSessionId = state?.sessionId;
    session.sessionFile = state?.sessionFile;

    this.dispatch({ t: 'session.status', sessionId: req.appSessionId, status: 'ready' });
    return {
      appSessionId: req.appSessionId,
      piSessionId: session.piSessionId,
      sessionFile: session.sessionFile,
      status: 'ready',
      caps: this.caps,
    };
  }

  async closeSession(sessionId: string, opts: { recycle?: boolean } = {}): Promise<void> {
    this.sendWire({ ch: sessionId, type: 'session.close', payload: { recycle: opts.recycle ?? true } });
    this.sessions.get(sessionId)?.coalescer.dispose();
    this.sessions.delete(sessionId);
    this.dispatch({ t: 'session.status', sessionId, status: 'closed' });
  }

  async switchSession(sessionId: string, sessionPath: string): Promise<void> {
    await this.command(sessionId, piCommands.switchSession(sessionPath));
  }

  async fork(sessionId: string, entryId: string): Promise<ForkResult> {
    const data = await this.command<ForkResult>(sessionId, piCommands.fork(entryId));
    return data;
  }

  async cloneSession(sessionId: string): Promise<ForkResult> {
    const data = await this.command<ForkResult>(sessionId, piCommands.clone());
    return data;
  }

  async setSessionName(sessionId: string, name: string): Promise<void> {
    await this.command(sessionId, piCommands.setSessionName(name));
  }

  async exportHtml(sessionId: string, outputPath?: string): Promise<string> {
    const data = await this.command<{ path?: string }>(sessionId, piCommands.exportHtml(outputPath));
    return data?.path ?? '';
  }

  /* ---------------- 轮次控制 ---------------- */

  async send(input: SendInput): Promise<SendAck> {
    const images = input.images ?? [];
    const cmd = piCommands.prompt(input.text, {
      ...(images.length > 0 ? { images } : {}),
      // 协议约束 3：流式中调用 prompt 必须显式给 streamingBehavior
      ...(input.behavior ? { streamingBehavior: input.behavior } : {}),
    });
    const data = await this.command<{ accepted?: 'started' | 'queued' }>(input.sessionId, cmd);
    return { turnId: cmd.id, accepted: data?.accepted ?? 'started' };
  }

  async steer(sessionId: string, text: string, images?: ImageAttachment[]): Promise<void> {
    await this.command(sessionId, piCommands.steer(text, images));
  }

  async followUp(sessionId: string, text: string, images?: ImageAttachment[]): Promise<void> {
    await this.command(sessionId, piCommands.followUp(text, images));
  }

  async abort(sessionId: string): Promise<void> {
    await this.command(sessionId, piCommands.abort());
  }

  async abortBash(sessionId: string): Promise<void> {
    await this.command(sessionId, piCommands.abortBash());
  }

  async clearQueue(sessionId: string): Promise<void> {
    await this.command(sessionId, piCommands.clearQueue());
  }

  async bash(sessionId: string, command: string, excludeFromContext?: boolean): Promise<void> {
    await this.command(sessionId, piCommands.bash(command, excludeFromContext));
  }

  /* ---------------- 模型 / 思考 / 上下文 ---------------- */

  async setModel(sessionId: string, provider: string, modelId: string): Promise<void> {
    await this.command(sessionId, piCommands.setModel(provider, modelId));
  }

  async cycleModel(sessionId: string): Promise<void> {
    await this.command(sessionId, piCommands.cycleModel());
  }

  async getAvailableModels(): Promise<ModelRef[]> {
    // 无活动会话时返回空（模型列表依赖会话上下文）
    const sid = this.sessions.keys().next().value;
    if (!sid) return [];
    const data = await this.command<ModelRef[]>(sid, piCommands.getAvailableModels());
    return Array.isArray(data) ? data : [];
  }

  async setThinkingLevel(sessionId: string, level: Thinking): Promise<void> {
    await this.command(sessionId, piCommands.setThinkingLevel(level));
  }

  async cycleThinkingLevel(sessionId: string): Promise<void> {
    await this.command(sessionId, piCommands.cycleThinkingLevel());
  }

  async setSteeringMode(sessionId: string, mode: QueueMode): Promise<void> {
    await this.command(sessionId, piCommands.setSteeringMode(mode));
  }

  async setFollowUpMode(sessionId: string, mode: QueueMode): Promise<void> {
    await this.command(sessionId, piCommands.setFollowUpMode(mode));
  }

  async compact(sessionId: string, customInstructions?: string): Promise<void> {
    await this.command(sessionId, piCommands.compact(customInstructions));
  }

  async setAutoCompaction(sessionId: string, enabled: boolean): Promise<void> {
    await this.command(sessionId, piCommands.setAutoCompaction(enabled));
  }

  async setAutoRetry(sessionId: string, enabled: boolean): Promise<void> {
    await this.command(sessionId, piCommands.setAutoRetry(enabled));
  }

  async abortRetry(sessionId: string): Promise<void> {
    await this.command(sessionId, piCommands.abortRetry());
  }

  /* ---------------- 扩展 UI 应答 ---------------- */

  async respondExtensionUI(sessionId: string, requestId: string, resp: ExtensionUIResponse): Promise<void> {
    await this.command(sessionId, piCommands.extensionUiResponse(requestId, resp));
  }

  /* ---------------- 查询 ---------------- */

  async getState(sessionId: string): Promise<RpcSessionState> {
    const data = await this.command<RpcSessionState>(sessionId, piCommands.getState());
    return data;
  }

  async getSessionStats(sessionId: string): Promise<SessionStats> {
    const data = await this.command<SessionStats>(sessionId, piCommands.getSessionStats());
    return data;
  }

  async getCommands(sessionId: string): Promise<SlashCommand[]> {
    const data = await this.command<SlashCommand[]>(sessionId, piCommands.getCommands());
    return Array.isArray(data) ? data : [];
  }

  async getMessages(sessionId: string): Promise<AgentMessage[]> {
    const data = await this.command<AgentMessage[]>(sessionId, piCommands.getMessages());
    return Array.isArray(data) ? data : [];
  }

  async getEntries(sessionId: string, since?: number): Promise<SessionEntry[]> {
    const data = await this.command<SessionEntry[]>(sessionId, piCommands.getEntries(since));
    return Array.isArray(data) ? data : [];
  }

  async getTree(sessionId: string): Promise<TreeResult> {
    const data = await this.command<{ tree?: SessionTreeNode[]; leafId?: string }>(
      sessionId,
      piCommands.getTree(),
    );
    return { tree: Array.isArray(data?.tree) ? data.tree : [] };
  }

  async getForkMessages(sessionId: string): Promise<ForkPoint[]> {
    const data = await this.command<ForkPoint[]>(sessionId, piCommands.getForkMessages());
    return Array.isArray(data) ? data : [];
  }

  async getLastAssistantText(sessionId: string): Promise<string> {
    const data = await this.command<{ text?: string }>(sessionId, piCommands.getLastAssistantText());
    return typeof data?.text === 'string' ? data.text : '';
  }

  /* ---------------- 内部：WS 传输 ---------------- */

  private rtErr(code: RuntimeError['code'], message: string): RuntimeError {
    return { code, message, recoverable: code !== 'auth_failed' };
  }

  private ensureWs(timeoutMs: number): Promise<void> {
    if (this.wsReady && this.ws?.readyState === WebSocket.OPEN) return this.wsReady;
    if (this.disposed) return Promise.reject(this.rtErr('unknown', '运行时已关闭'));
    this.wsReady = new Promise<void>((resolve, reject) => {
      if (!this.endpoint) {
        reject(this.rtErr('unknown', '缺少 host 端点'));
        return;
      }
      const ws = new WebSocket(`${this.endpoint.wsUrl}?t=${encodeURIComponent(this.endpoint.token)}`);
      const timer = setTimeout(() => {
        reject(this.rtErr('connect_timeout', '连接 host WS 超时'));
        ws.close();
      }, timeoutMs);
      ws.onopen = () => {
        // hello 帧到达后再 resolve（ws.ts 建连即发 hello）
        const onMsg = (ev: MessageEvent): void => {
          try {
            const frame = JSON.parse(String(ev.data)) as HostWireFrame;
            if (frame.ch === 'sys' && frame.type === 'hello') {
              clearTimeout(timer);
              ws.removeEventListener('message', onMsg);
              this.ws = ws;
              this.attachWsHandlers(ws);
              resolve();
            }
          } catch {
            /* 非 JSON 忽略 */
          }
        };
        ws.addEventListener('message', onMsg);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(this.rtErr('network', '无法连接 host WS'));
      };
    });
    return this.wsReady;
  }

  private attachWsHandlers(ws: WebSocket): void {
    ws.onmessage = (ev: MessageEvent) => {
      let frame: HostWireFrame;
      try {
        frame = JSON.parse(String(ev.data)) as HostWireFrame;
      } catch {
        return;
      }
      this.handleWireFrame(frame);
    };
    ws.onclose = () => {
      // 通道全断：所有会话上抛 closed（通道断 ≠ 会话结束，host 进程仍在）
      if (!this.disposed) {
        for (const sid of this.sessions.keys()) {
          this.dispatch({ t: 'session.status', sessionId: sid, status: 'closed' });
        }
      }
      this.ws = null;
      this.wsReady = null;
    };
    // 心跳：每 20s ping
    const beat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ ch: 'sys', type: 'ping' }));
      } else {
        clearInterval(beat);
      }
    }, 20_000);
  }

  private handleWireFrame(frame: HostWireFrame): void {
    if (frame.ch === 'sys') return;
    const sid = frame.ch;
    switch (frame.type) {
      case 'session.lines': {
        const payload = frame.payload as { lines?: string[] } | null;
        const lines = Array.isArray(payload?.lines) ? payload.lines : [];
        const session = this.sessions.get(sid);
        if (session) {
          // 事件一律交给 coalescer 发射（它内部保证冲刷顺序与 ~48ms 合并窗口）
          for (const e of session.normalizer.pushMany(lines)) {
            session.coalescer.feed(e);
          }
        }
        return;
      }
      case 'session.status': {
        const payload = frame.payload as { status?: ChannelStatus; detail?: string; code?: string } | null;
        const status = payload?.status;
        if (!status) return;
        const err: RuntimeError | undefined =
          status === 'error'
            ? this.wireErrToRuntime(payload?.code, payload?.detail)
            : undefined;
        // 状态等待者（openSession 握手前）
        const waiters = this.statusWaiters.get(sid);
        if (waiters) {
          this.statusWaiters.delete(sid);
          for (const w of waiters) w(status, err);
        }
        if (status === 'open' || status === 'closed') {
          this.dispatch({
            t: 'session.status',
            sessionId: sid,
            status: status === 'open' ? 'ready' : 'closed',
            detail: payload?.detail,
          });
        } else if (status === 'error') {
          this.dispatch({
            t: 'session.status',
            sessionId: sid,
            status: 'error',
            detail: payload?.detail,
          });
          this.dispatch({
            t: 'error',
            sessionId: sid,
            code: err?.code ?? 'agent_crash',
            message: payload?.detail ?? '通道错误',
            recoverable: err?.recoverable ?? true,
          });
        }
        return;
      }
      case 'error': {
        const payload = frame.payload as { code?: string; message?: string } | null;
        this.dispatch({
          t: 'error',
          sessionId: sid,
          code: this.wireErrToRuntime(payload?.code).code,
          message: payload?.message ?? 'host 错误',
          recoverable: true,
        });
        return;
      }
      default:
        return;
    }
  }

  private wireErrToRuntime(code?: string, detail?: string): RuntimeError {
    switch (code) {
      case 'cli_not_found':
        return this.rtErr('cli_not_found', detail ?? '未找到 pi');
      case 'busy':
        return this.rtErr('timeout', detail ?? '已达并发上限');
      case 'unauthorized':
        return this.rtErr('auth_failed', detail ?? '令牌无效');
      case 'bad_request':
      case 'not_found':
      case 'internal':
        return this.rtErr('agent_crash', detail ?? 'host 内部错误');
      default:
        return this.rtErr('agent_crash', detail ?? '未知 host 错误');
    }
  }

  private sendWire(frame: HostWireFrame): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  /** 打开会话时等待首个通道状态帧 */
  private waitChannelStatus(
    appSessionId: string,
    timeoutMs: number,
  ): Promise<{ status: ChannelStatus; err?: RuntimeError }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.statusWaiters.delete(appSessionId);
        reject(this.rtErr('connect_timeout', '等待通道状态超时'));
      }, timeoutMs);
      const waiters = this.statusWaiters.get(appSessionId) ?? [];
      waiters.push((status, err) => {
        clearTimeout(timer);
        resolve({ status, err });
      });
      this.statusWaiters.set(appSessionId, waiters);
      // 受理请求：host 会立即回 connecting 或 error
      this.sendWire({ ch: appSessionId, type: 'session.open', payload: this.buildOpenPayload() });
    });
  }

  private pendingOpen: OpenSessionRequest | null = null;

  /** openSession 的载荷需要在 waitChannelStatus 前挂起（见 openSession 调用顺序） */
  private buildOpenPayload(): unknown {
    return this.pendingOpen;
  }

  private command<T = ResponseData>(sessionId: string, cmd: { id: string; type: string } & Record<string, unknown>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const d = new Deferred<ResponseData>(REQUEST_TIMEOUT_MS);
      this.pending.set(cmd.id, d);
      d.promise.then(
        (v) => resolve(v as T),
        (e: RuntimeError) => reject(e),
      );
      this.sendWire({ ch: sessionId, type: 'session.write', payload: { line: JSON.stringify(cmd) } });
    });
  }

  private dispatch(e: RuntimeEvent): void {
    for (const h of this.handlers) {
      try {
        h(e);
      } catch {
        // 订阅者异常不影响其他订阅者
      }
    }
  }

  private async fetchHealth(): Promise<{ pi: { found: boolean; version?: string | null; path?: string | null } }> {
    if (!this.endpoint) throw new Error('no endpoint');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    try {
      const res = await fetch(`${this.endpoint.httpUrl}/v1/health`, {
        headers: { 'x-pi-agent-token': this.endpoint.token },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`health ${res.status}`);
      return (await res.json()) as { pi: { found: boolean; version?: string | null; path?: string | null } };
    } finally {
      clearTimeout(timer);
    }
  }

  /** init 后由 createRuntime 调用：用 pi 版本刷新能力矩阵 */
  applyProbeVersion(version?: string): void {
    this.caps = capabilitiesForVersion(version, 'real');
  }
}
