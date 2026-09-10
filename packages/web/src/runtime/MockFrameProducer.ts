/**
 * MockFrameProducer（架构 §3.6）：在浏览器内模拟一个 pi 进程。
 * 产出与真实 pi 完全同构的原始 JSONL 行（response / agent 事件 / extension_ui_request），
 * 走同一条 PiFrameNormalizer → StreamCoalescer 链路（架构 §1.5）。
 *
 * 剧本：tool-heavy（思考+工具+正文）/ plain / approval（extension_ui_request 审批）
 * / compact / error / recorded（回放真实录制行）。
 * 错误注入：tool-fail / crash / auth。
 */
import { newId, type MockProfile, type RpcSessionState } from '@pi-agent/shared';

export type MockScript = MockProfile['script'];
export type MockErrorInjection = NonNullable<MockProfile['errorInjection']>;

export interface MockSessionConfig {
  appSessionId: string;
  latencyMs: number;
  script: MockScript;
  errorInjection: MockErrorInjection;
  recordedLines?: string[];
}

export interface MockSessionCallbacks {
  /** 原始 JSONL 行批量下行（与 host 中继行为一致） */
  onLines(lines: string[]): void;
}

const line = (obj: unknown): string => JSON.stringify(obj);

function responseFrame(id: string, command: string, success: boolean, data?: unknown): string {
  if (success) return line({ type: 'response', id, command, success, data });
  return line({ type: 'response', id, command, success: false, error: 'mock 模拟错误' });
}

function mockState(): RpcSessionState {
  return {
    model: { provider: 'mock', id: 'mock-sonnet', name: 'Mock Sonnet' },
    thinkingLevel: 'medium',
    isStreaming: false,
    isCompacting: false,
    steeringMode: 'all',
    followUpMode: 'all',
    sessionId: 'mock-pi-session-0001',
    autoCompactionEnabled: true,
    messageCount: 2,
    pendingMessageCount: 0,
  };
}

const MOCK_COMMANDS = [
  { name: 'compact', description: '压缩上下文', kind: 'builtin' },
  { name: 'review', description: '审查当前变更', kind: 'prompt' },
  { name: 'explain', description: '解释选中代码', kind: 'prompt' },
];

const MOCK_MODELS = [
  { provider: 'mock', modelId: 'mock-sonnet', name: 'Mock Sonnet' },
  { provider: 'mock', modelId: 'mock-haiku', name: 'Mock Haiku' },
];

export class MockPiSession {
  private readonly cfg: MockSessionConfig;
  private readonly cb: MockSessionCallbacks;
  /** 代际号：abort/dispose 后旧链路全部作废 */
  private generation = 0;
  private turnRunning = false;
  private pendingApprovalId: string | null = null;

  constructor(cfg: MockSessionConfig, cb: MockSessionCallbacks) {
    this.cfg = cfg;
    this.cb = cb;
  }

  /** 收到一行上行命令（web 端运行时写入） */
  write(raw: string): void {
    let cmd: { id?: string; type?: string; [k: string]: unknown };
    try {
      cmd = JSON.parse(raw) as typeof cmd;
    } catch {
      return;
    }
    const id = typeof cmd.id === 'string' ? cmd.id : newId();
    switch (cmd.type) {
      case 'get_state':
        this.emit([responseFrame(id, 'get_state', true, mockState())]);
        return;
      case 'get_session_stats':
        this.emit([
          responseFrame(
            id,
            'get_session_stats',
            true,
            {
              sessionId: 'mock-pi-session-0001',
              userMessages: 1,
              assistantMessages: 1,
              toolCalls: this.cfg.script === 'tool-heavy' ? 1 : 0,
              tokens: { input: 1200, output: 800, cacheRead: 300, cacheWrite: 0, total: 2000 },
              cost: 0.0042,
              contextUsage: { tokens: 2000, contextWindow: 200000, percentUsed: 1 },
            },
          ),
        ]);
        return;
      case 'get_commands':
        this.emit([responseFrame(id, 'get_commands', true, MOCK_COMMANDS)]);
        return;
      case 'get_available_models':
        this.emit([responseFrame(id, 'get_available_models', true, MOCK_MODELS)]);
        return;
      case 'get_available_thinking_levels':
        this.emit([
          responseFrame(id, 'get_available_thinking_levels', true, ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
        ]);
        return;
      case 'prompt':
        void this.runTurn(String(cmd.message ?? ''), id);
        return;
      case 'abort': {
        // 作废当前轮次链路，立即终态
        this.generation++;
        this.turnRunning = false;
        this.pendingApprovalId = null;
        this.emit([
          responseFrame(id, 'abort', true, { ok: true }),
          line({ type: 'agent_settled', willRetry: false }),
        ]);
        return;
      }
      case 'compact':
        this.emit([responseFrame(id, 'compact', true, { ok: true })]);
        return;
      case 'extension_ui_response': {
        // 审批应答：解除挂起，继续剧本
        this.pendingApprovalId = null;
        this.emit([responseFrame(id, 'extension_ui_response', true, { ok: true })]);
        return;
      }
      case 'get_tree': {
        // 分支树：以当前会话为根，挂若干历史/派生节点（F-05）
        this.emit([responseFrame(id, 'get_tree', true, this.mockTree())]);
        return;
      }
      case 'get_fork_messages': {
        // 可 fork 的消息点（F-02）
        this.emit([responseFrame(id, 'get_fork_messages', true, this.mockForkPoints())]);
        return;
      }
      case 'fork': {
        // 从指定 entryId 分叉：返回新会话标识（F-03）
        const entryId = typeof cmd.entryId === 'string' ? cmd.entryId : 'entry-root';
        this.emit([responseFrame(id, 'fork', true, this.mockForkResult(entryId))]);
        return;
      }
      case 'clone': {
        // 克隆当前会话
        this.emit([responseFrame(id, 'clone', true, this.mockForkResult('entry-root'))]);
        return;
      }
      default:
        // 其余命令统一成功回执（协议同构即可）
        this.emit([responseFrame(id, String(cmd.type ?? 'unknown'), true, { ok: true })]);
    }
  }

  /** 停止模拟（会话关闭） */
  dispose(): void {
    this.generation++;
  }

  /** 分支树（F-05）：当前会话为根，派生若干历史节点 */
  private mockTree(): { tree: unknown[]; leafId: string } {
    const leaf = `node-${newId()}`;
    return {
      tree: [
        {
          id: 'node-root',
          parentId: null,
          label: '主会话',
          type: 'root',
          children: [
            { id: 'node-a', parentId: 'node-root', label: '方案 A（已完成）', type: 'session' },
            {
              id: 'node-b',
              parentId: 'node-root',
              label: '方案 B（进行中）',
              type: 'session',
              children: [{ id: leaf, parentId: 'node-b', label: 'B 的子分支', type: 'session' }],
            },
          ],
        },
      ],
      leafId: leaf,
    };
  }

  /** 可 fork 的消息点（F-02） */
  private mockForkPoints(): { entryId: string; label: string; preview?: string }[] {
    return [
      { entryId: 'entry-root', label: '会话开始', preview: '（根节点）从空白上下文开始' },
      { entryId: `entry-${newId()}`, label: '第 3 条消息后', preview: ' user: 帮我重构这个模块…' },
      { entryId: `entry-${newId()}`, label: '工具调用之前', preview: ' assistant: 我先读一下入口文件…' },
    ];
  }

  /** fork/clone 结果（F-03）：派生新会话标识 */
  private mockForkResult(entryId: string): { appSessionId: string; piSessionId?: string; sessionFile?: string } {
    const pid = `fork-${newId()}`;
    return {
      appSessionId: pid,
      piSessionId: pid,
      sessionFile: `/mock/sessions/${pid}.jsonl`,
      // entryId 透传，便于前端核对截断点（验收 M10）
      ...(entryId ? { entryId } : {}),
    };
  }

  /* ---------------- 内部：轮次剧本 ---------------- */

  private emit(lines: string[]): void {
    this.cb.onLines(lines);
  }

  /** 已作废（abort/dispose/新一轮）则停止后续发射 */
  private stale(gen: number): boolean {
    return gen !== this.generation;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.max(ms, 0)));
  }

  private async runTurn(userText: string, promptId: string): Promise<void> {
    // 流式中再 prompt → 直接接受（模拟 followUp 排队由 queue_update 表达，这里简化）
    if (this.turnRunning) {
      this.emit([line({ type: 'queue_update', steering: [], followUp: [{ message: userText }] })]);
      return;
    }
    this.turnRunning = true;
    const gen = ++this.generation;
    const step = this.cfg.latencyMs;

    this.emit([
      responseFrame(promptId, 'prompt', true, { accepted: 'started' }),
      line({ type: 'agent_start' }),
      line({ type: 'turn_start' }),
    ]);
    await this.sleep(step);
    if (this.stale(gen)) return;

    // —— recorded 剧本：逐行回放真实录制的原始行 ——
    if (this.cfg.script === 'recorded' && (this.cfg.recordedLines?.length ?? 0) > 0) {
      await replayRecordedLines(
        this.cfg.recordedLines!,
        this.cfg.latencyMs,
        (batch) => this.emit(batch),
        () => this.stale(gen),
      );
      if (this.stale(gen)) return;
      this.emit([line({ type: 'agent_settled', willRetry: false })]);
      this.turnRunning = false;
      return;
    }

    const messageId = `mock-msg-${newId()}`;
    const script = this.cfg.script;

    // —— 审批剧本：先弹 extension_ui_request，等应答或超时自动放行 ——
    // 与内置审批扩展同构：title 为识别标记，message 为 JSON 载荷（前端 PermissionEngine 判定）
    if (script === 'approval') {
      const approvalId = `mock-ui-${newId()}`;
      this.pendingApprovalId = approvalId;
      this.emit([
        line({
          type: 'extension_ui_request',
          id: approvalId,
          method: 'confirm',
          title: 'pi-agent-permissions',
          message: JSON.stringify({
            toolName: 'write',
            toolCallId: `mock-tool-${newId()}`,
            input: { path: 'src/example.ts', content: 'export const demo = 1\n' },
            summary: 'write path=src/example.ts',
          }),
          timeout: Math.max(1500, this.cfg.latencyMs * 4),
        }),
      ]);
      // 等待应答；超时自动放行（演示链路不卡死）
      // 等待时长与 latencyMs 挂钩：latencyMs=0（单测）时只等 300ms
      const waitMs = Math.max(300, this.cfg.latencyMs * 3);
      const ticks = Math.max(1, Math.ceil(waitMs / 100));
      for (let i = 0; i < ticks && this.pendingApprovalId === approvalId; i++) {
        await this.sleep(100);
        if (this.stale(gen)) return;
      }
      if (this.pendingApprovalId === approvalId) this.pendingApprovalId = null;
    }

    // —— 压缩剧本 ——
    if (script === 'compact') {
      this.emit([line({ type: 'compaction_start', reason: 'threshold' })]);
      await this.sleep(step);
      if (this.stale(gen)) return;
      this.emit([
        line({ type: 'compaction_end', willRetry: false, summary: '已压缩 2 轮对话为摘要' }),
      ]);
      await this.sleep(step);
      if (this.stale(gen)) return;
    }

    this.emit([line({ type: 'message_start', message: { id: messageId, role: 'assistant' } })]);

    // —— 思考块（contentIndex 0） ——
    if (script === 'tool-heavy' || script === 'approval' || script === 'error') {
      await this.emitBlock(gen, messageId, 0, 'thinking', [
        '用户想让我',
        '查看项目结构，先列目录再读入口文件。',
      ]);
      if (this.stale(gen)) return;
    }

    // —— 工具块（tool_execution_* 独立事件流） ——
    if (script === 'tool-heavy' || script === 'error') {
      const toolCallId = `mock-tool-${newId()}`;
      const fail = this.cfg.errorInjection === 'tool-fail' || script === 'error';
      this.emit([line({ type: 'tool_execution_start', toolCallId, toolName: 'read', args: { path: 'src/index.ts' } })]);
      await this.sleep(step);
      if (this.stale(gen)) return;
      this.emit([line({ type: 'tool_execution_update', toolCallId, partialResult: { lines: 42 } })]);
      await this.sleep(step);
      if (this.stale(gen)) return;
      this.emit([
        fail
          ? line({ type: 'tool_execution_end', toolCallId, result: { error: 'EACCES: 权限不足（mock 注入）' }, isError: true })
          : line({ type: 'tool_execution_end', toolCallId, result: { content: 'export function main() {}' }, isError: false }),
      ]);
      await this.sleep(step);
      if (this.stale(gen)) return;
    }

    // —— 正文块（contentIndex 排在思考之后） ——
    const textIndex = script === 'tool-heavy' || script === 'approval' || script === 'error' ? 1 : 0;
    let body: string;
    switch (script) {
      case 'tool-heavy':
        body = '已读取入口文件：导出了 `main` 函数，逻辑集中在参数校验。\n\n```ts\nexport function main() {}\n```';
        break;
      case 'approval':
        body = '好的，已按你的确认修改 `src/example.ts`。这是一个 Mock 演示回复。';
        break;
      case 'compact':
        body = '上下文压缩完成，摘要已写入。这是 Mock 演示回复。';
        break;
      case 'error':
        body = '工具调用失败了（见上方红色卡片）。这是 Mock 错误演示。';
        break;
      default:
        body = `收到：「${userText}」。这是一条 Mock 流式回复，与真实 pi 走完全相同的归一化链路。`;
    }
    // 分词发射，模拟流式
    const chunks = body.match(/[\s\S]{1,12}/g) ?? [body];
    await this.emitBlock(gen, messageId, textIndex, 'text', chunks);
    if (this.stale(gen)) return;

    // —— 错误注入：crash / auth 以 assistant 流错误表达 ——
    if (this.cfg.errorInjection === 'crash' || this.cfg.errorInjection === 'auth') {
      this.emit([
        line({
          type: 'message_update',
          message: { id: messageId, role: 'assistant' },
          assistantMessageEvent: {
            type: 'error',
            message:
              this.cfg.errorInjection === 'auth'
                ? '401 unauthorized: API key invalid (mock 注入)'
                : 'ECONNREFUSED: 无法连接模型服务 (mock 注入)',
          },
        }),
      ]);
    }

    this.emit([
      line({ type: 'message_end', message: { id: messageId, role: 'assistant' } }),
      line({ type: 'turn_end', toolResults: [] }),
      line({ type: 'agent_end' }),
      line({ type: 'agent_settled', willRetry: false }),
    ]);
    this.turnRunning = false;
  }

  /** 按块发射 start/delta…/end（与真实 assistantMessageEvent 同构） */
  private async emitBlock(
    gen: number,
    messageId: string,
    contentIndex: number,
    kind: 'text' | 'thinking',
    chunks: string[],
  ): Promise<void> {
    const step = this.cfg.latencyMs;
    const evt = (type: string, extra: Record<string, unknown> = {}): string =>
      line({
        type: 'message_update',
        message: { id: messageId, role: 'assistant' },
        assistantMessageEvent: { type, contentIndex, ...extra },
      });
    this.emit([evt(`${kind}_start`)]);
    for (const chunk of chunks) {
      await this.sleep(kind === 'thinking' ? step : Math.max(step / 2, 12));
      if (this.stale(gen)) return;
      this.emit([evt(`${kind}_delta`, { delta: chunk })]);
    }
    this.emit([evt(`${kind}_end`)]);
  }
}

/** recorded 剧本：按延迟回放真实录制的原始行（不含命令应答，仅事件流） */
export async function replayRecordedLines(
  lines: string[],
  latencyMs: number,
  onLines: (batch: string[]) => void,
  isCancelled: () => boolean,
): Promise<void> {
  for (const l of lines) {
    if (isCancelled()) return;
    onLines([l]);
    await new Promise((resolve) => setTimeout(resolve, Math.max(latencyMs / 3, 8)));
  }
}
