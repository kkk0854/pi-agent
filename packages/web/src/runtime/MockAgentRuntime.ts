/**
 * MockAgentRuntime（架构 §3.2 Mock 实现）：
 * MockPiSession 产出原始 JSONL 行 → PiFrameNormalizer → StreamCoalescer → RuntimeEvent，
 * 与真实链路完全同构（架构 §1.5）；能力矩阵恒为 mock 全量。
 */
import {
  PiFrameNormalizer,
  piCommands,
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
  type SessionEntry,
  type AgentMessage,
  type SlashCommand,
  type RpcSessionState,
  type Thinking,
  type QueueMode,
  type SessionTreeNode,
  type TreeResult,
  type ForkPoint,
  type ExtensionUIResponse,
} from '@pi-agent/shared';
import { MockPiSession } from './MockFrameProducer';
import { StreamCoalescer } from './StreamCoalescer';
import { Deferred } from './Deferred';

interface MockSession {
  appSessionId: string;
  producer: MockPiSession;
  normalizer: PiFrameNormalizer;
  coalescer: StreamCoalescer;
}

type ResponseData = Record<string, unknown> | unknown[] | unknown;

const MOCK_CAPS: RuntimeCapabilities = {
  mode: 'mock',
  reason: 'Mock 模式（pi 未安装或 host 未运行，功能演示与真实链路同构）',
  supports: {
    fork: true,
    tree: true,
    stats: true,
    commands: true,
    thinkingLevel: true,
    modelSwitch: true,
    compaction: true,
    autoRetry: true,
    extensionUI: true,
    bash: true,
    exportHtml: true,
    images: true,
    queueModes: true,
  },
};

export class MockAgentRuntime implements AgentRuntime {
  readonly kind = 'mock' as const;
  /** 能力矩阵：Mock 恒为全量支持，并明示降级原因（架构 §3.2） */
  readonly caps: RuntimeCapabilities = MOCK_CAPS;
  private cfg: RuntimeInitConfig | null = null;
  private readonly handlers = new Set<EventHandler>();
  private readonly sessions = new Map<string, MockSession>();
  private readonly pending = new Map<string, Deferred<ResponseData>>();
  private disposed = false;

  async init(cfg: RuntimeInitConfig): Promise<RuntimeCapabilities> {
    this.cfg = cfg;
    return MOCK_CAPS;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const s of this.sessions.values()) s.producer.dispose();
    this.sessions.clear();
    for (const d of this.pending.values()) {
      d.reject({ code: 'unknown', message: '运行时已关闭', recoverable: false });
    }
    this.pending.clear();
  }

  onEvent(h: EventHandler): () => void {
    this.handlers.add(h);
    return () => {
      this.handlers.delete(h);
    };
  }

  async probe(): Promise<PiProbeResult> {
    return { found: false, errorCode: 'not_found', message: 'Mock 模式：不使用本机 pi' };
  }

  /* ---------------- 会话生命周期 ---------------- */

  async openSession(req: OpenSessionRequest): Promise<SessionHandle> {
    if (this.disposed) throw { code: 'unknown', message: '运行时已关闭', recoverable: false } as never;
    const mock = this.cfg?.mock;
    const producer = new MockPiSession(
      {
        appSessionId: req.appSessionId,
        latencyMs: mock?.latencyMs ?? 40,
        script: mock?.script ?? 'tool-heavy',
        errorInjection: mock?.errorInjection ?? 'none',
        recordedLines: mock?.recordedLines,
      },
      { onLines: (lines) => this.onProducerLines(req.appSessionId, lines) },
    );

    const normalizer = new PiFrameNormalizer(req.appSessionId);
    normalizer.onResponse((frame) => {
      const d = this.pending.get(frame.id);
      if (d) {
        this.pending.delete(frame.id);
        if (frame.success) d.resolve(frame.data);
        else d.reject({ code: 'unknown', message: frame.error ?? 'mock 命令失败', recoverable: true });
      }
    });
    const coalescer = new StreamCoalescer((e) => this.dispatch(e), 48);
    this.sessions.set(req.appSessionId, { appSessionId: req.appSessionId, producer, normalizer, coalescer });

    // 握手与真实链路一致：get_state → response
    const state = await this.command<RpcSessionState>(req.appSessionId, piCommands.getState());
    this.dispatch({ t: 'session.status', sessionId: req.appSessionId, status: 'ready' });
    return {
      appSessionId: req.appSessionId,
      piSessionId: state?.sessionId,
      status: 'ready',
      caps: MOCK_CAPS,
    };
  }

  async closeSession(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.coalescer.dispose();
    s.producer.dispose();
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
    this.dispatch({ t: 'ui.title', sessionId, title: name });
  }

  async exportHtml(sessionId: string): Promise<string> {
    await this.command(sessionId, piCommands.exportHtml());
    return '';
  }

  /* ---------------- 轮次控制 ---------------- */

  async send(input: SendInput): Promise<SendAck> {
    const images: ImageAttachment[] = input.images ?? [];
    const cmd = piCommands.prompt(input.text, {
      ...(images.length > 0 ? { images } : {}),
      ...(input.behavior ? { streamingBehavior: input.behavior } : {}),
    });
    await this.command(input.sessionId, cmd);
    return { turnId: cmd.id, accepted: 'started' };
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
    return [
      { provider: 'mock', modelId: 'mock-sonnet', name: 'Mock Sonnet' },
      { provider: 'mock', modelId: 'mock-haiku', name: 'Mock Haiku' },
    ];
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
    this.dispatch({ t: 'compaction.start', sessionId, reason: 'manual' });
    this.dispatch({ t: 'compaction.end', sessionId, willRetry: false });
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

  /* ---------------- 内部 ---------------- */

  /** Mock 进程产出的原始行 → normalizer → coalescer → 订阅者（与 host 链路同构） */
  private onProducerLines(appSessionId: string, lines: string[]): void {
    const session = this.sessions.get(appSessionId);
    if (!session) return;
    for (const e of session.normalizer.pushMany(lines)) {
      session.coalescer.feed(e);
    }
  }

  private command<T = ResponseData>(
    sessionId: string,
    cmd: { id: string; type: string } & Record<string, unknown>,
  ): Promise<T> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return Promise.reject({ code: 'unknown', message: '会话未打开', recoverable: true });
    }
    const d = new Deferred<ResponseData>(Math.max((this.cfg?.connectTimeoutMs ?? 8000) * 4, 20_000));
    this.pending.set(cmd.id, d);
    session.producer.write(JSON.stringify(cmd));
    return d.promise.then((v) => v as T);
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
}
