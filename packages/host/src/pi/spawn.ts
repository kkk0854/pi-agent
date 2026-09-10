/**
 * pi 进程编排（架构 §2.3 pi/spawn.ts）：
 * - 依据 probe 结果选择启动方式：优先 entry 模式（node 直启 JS 入口，argv 数组直传不经 shell）；
 *   兜底才走 pi.cmd + shell（Windows 下 .cmd 无法直接 spawn）
 * - 并发上限（N-02，默认 3）：达到上限抛 busy
 * - 空闲回收动作透传给上层（SessionManager）
 */
import type { RuntimeError } from '@pi-agent/shared';
import type { PiProbe } from './probe';
import { PiProcess, type PiProcessExitInfo } from './process';

export class SpawnError extends Error {
  constructor(
    public readonly code: 'cli_not_found' | 'busy' | 'spawn_failed',
    message: string,
  ) {
    super(message);
    this.name = 'SpawnError';
  }

  /** 转运行时错误（供 WS 错误帧与前端引导） */
  toRuntimeError(): RuntimeError {
    switch (this.code) {
      case 'cli_not_found':
        return { code: 'cli_not_found', message: this.message, recoverable: false };
      case 'busy':
        return { code: 'timeout', message: this.message, recoverable: true };
      default:
        return { code: 'agent_crash', message: this.message, recoverable: true };
    }
  }
}

export interface SpawnOptions {
  argv: string[];
  cwd: string;
  /** 日志标签（appSessionId） */
  label: string;
}

export interface SpawnerCallbacks {
  onLines(label: string, lines: string[]): void;
  onStderr(label: string, chunk: string): void;
  onExit(label: string, p: PiProcess, info: PiProcessExitInfo): void;
  onError(label: string, err: Error): void;
  onIdle(label: string, p: PiProcess): void;
  logger?: {
    info(msg: string, fields?: Record<string, unknown>): void;
    warn(msg: string, fields?: Record<string, unknown>): void;
  };
}

export class PiSpawner {
  private readonly active = new Map<string, PiProcess>();

  constructor(
    private readonly probe: PiProbe,
    private readonly callbacks: SpawnerCallbacks,
    private readonly maxConcurrent: number = 3,
    private readonly idleMs: number = 1_800_000,
  ) {}

  get activeCount(): number {
    return this.active.size;
  }

  has(label: string): boolean {
    return this.active.has(label);
  }

  get(label: string): PiProcess | undefined {
    return this.active.get(label);
  }

  forget(label: string): void {
    this.active.delete(label);
  }

  /** 启动一个 pi 子进程。探测未命中 → cli_not_found；并发满 → busy */
  spawn(opts: SpawnOptions): PiProcess {
    if (!this.probe.found) {
      throw new SpawnError('cli_not_found', this.probe.message);
    }
    if (this.active.size >= this.maxConcurrent) {
      throw new SpawnError(
        'busy',
        `已达并发上限（${this.maxConcurrent}）。请先关闭部分会话，或调高设置中的 maxConcurrentAgents。`,
      );
    }

    const { command, shell } = this.launchPlan();
    this.callbacks.logger?.info('spawn pi', {
      label: opts.label,
      cwd: opts.cwd,
      entry: this.probe.entry?.scriptPath ?? this.probe.path,
      shell,
    });

    const p = new PiProcess({
      command,
      argv: opts.argv,
      cwd: opts.cwd,
      shell,
      idleMs: this.idleMs,
      onLines: (lines) => this.callbacks.onLines(opts.label, lines),
      onStderr: (chunk) => this.callbacks.onStderr(opts.label, chunk),
      onExit: (info) => {
        this.active.delete(opts.label);
        this.callbacks.onExit(opts.label, p, info);
      },
      onError: (err) => this.callbacks.onError(opts.label, err),
      onIdle: () => this.callbacks.onIdle(opts.label, p),
    });
    this.active.set(opts.label, p);
    return p;
  }

  /** 关闭全部活动进程（host 退出时） */
  async killAll(graceMs?: number): Promise<void> {
    const all = [...this.active.values()];
    await Promise.all(all.map((p) => p.terminate(graceMs)));
    this.active.clear();
  }

  /**
   * 启动方式决策：
   * - entry 命中 → [node, 入口脚本]，不经 shell（R-07：argv 数组直传）
   * - 否则 [pi 可执行路径] + shell:true（.cmd/.sh 需要 shell 解析）
   */
  private launchPlan(): { command: string[]; shell: boolean } {
    if (this.probe.entry) {
      return { command: [this.probe.entry.nodePath, this.probe.entry.scriptPath], shell: false };
    }
    if (this.probe.path) {
      return { command: [this.probe.path], shell: true };
    }
    return { command: ['pi'], shell: true };
  }
}
