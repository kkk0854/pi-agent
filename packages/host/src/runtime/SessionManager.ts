/**
 * SessionManager（架构 §2.3 runtime/SessionManager.ts）：
 * appSessionId ↔ pi 子进程映射 + 会话级状态机。
 *
 * 职责边界（架构 §1.5）：
 * - host 只做原始行中继，不解析 pi 协议 —— 握手（get_state）由 web 端运行时发起
 * - host 侧状态只有：connecting → ready（首行到达即视为进程可用）→ closed / error
 * - 通道断开 ≠ 会话结束：close(recycle:false) 仅分离（detached），进程保留待重连
 * - 空闲回收（N-03）：定期 sweep，空闲超过 idleRecycleMs 的会话被回收
 *
 * 依赖注入：构造函数只依赖 SessionSpawnerLike（最小接口），
 * 真实装配在 index.ts：PiSpawner 的回调 → manager._handle*；manager.spawn → PiSpawner.spawn。
 */
import type { OpenSessionRequest, RuntimeError } from '@pi-agent/shared';
import { buildPiArgs } from '../pi/args';
import { CrashTracker } from './crash';
import type { SpawnError } from '../pi/spawn';

/* ---------- 可注入接口（单测用替身实现同签名） ---------- */

export interface SessionProcessLike {
  writeLine(line: string): boolean;
  terminate(graceMs?: number): Promise<unknown>;
  stderr(): string;
  pid?: number;
}

export interface SessionSpawnerLike {
  spawn(opts: { argv: string[]; cwd: string; label: string }): SessionProcessLike;
}

/* ---------- 状态机 ---------- */

export type SessionHostStatus = 'connecting' | 'ready' | 'closed' | 'error';

export interface SessionRecord {
  appSessionId: string;
  status: SessionHostStatus;
  /** 是否附着（false = 通道断开但进程保留） */
  attached: boolean;
  cwd: string;
  pid?: number;
  /** 双 ID（C-05）：恢复所需 pi 侧信息（web 端从事件流回填后经 REST 持久化） */
  piSessionPath?: string;
  piSessionId?: string;
  startedAt: string;
  lastActivityAt: number;
}

export interface ExitPayload {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** 非优雅退出时的四类错误分类（graceful / 主动关闭为 null） */
  error: RuntimeError | null;
}

export interface OpenHandlers {
  onLines(appSessionId: string, lines: string[]): void;
  onExit(appSessionId: string, payload: ExitPayload): void;
  onSpawnError?(appSessionId: string, err: SpawnError): void;
}

export interface SessionManagerOptions {
  /** 空闲回收（ms），N-03 默认 30min；<=0 关闭清扫 */
  idleRecycleMs: number;
  /** 清扫周期（ms），默认 60s；仅测试注入用 */
  sweepIntervalMs?: number;
  /** 内置审批扩展路径（T03，注入 --extension） */
  extensionPath?: string;
  /**
   * 扩展 argv 提供器（T05）：每次 spawn 求值（extensions.json 启用态可运行时变化），
   * 产出 ['--extension', path, ...]（spawnExtensionArgs）。
   */
  extraExtensionArgs?: () => string[];
  logger?: {
    info(msg: string, fields?: Record<string, unknown>): void;
    warn(msg: string, fields?: Record<string, unknown>): void;
  };
}

interface InternalRecord extends SessionRecord {
  process: SessionProcessLike;
  tracker: CrashTracker;
}

export class SessionManager {
  private readonly records = new Map<string, InternalRecord>();
  private readonly handlers: OpenHandlers;
  private readonly opts: SessionManagerOptions;
  private readonly spawner: SessionSpawnerLike;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(spawner: SessionSpawnerLike, handlers: OpenHandlers, opts: SessionManagerOptions) {
    this.spawner = spawner;
    this.handlers = handlers;
    this.opts = opts;
    if (opts.idleRecycleMs > 0) {
      this.sweepTimer = setInterval(() => void this.sweep(), opts.sweepIntervalMs ?? 60_000);
      // 不阻止 host 进程退出
      this.sweepTimer.unref?.();
    }
  }

  /** 打开会话：组装 CLI 参数 → spawn。抛 SpawnError（cli_not_found / busy） */
  open(appSessionId: string, req: OpenSessionRequest): SessionRecord {
    const existing = this.records.get(appSessionId);
    if (existing && existing.status !== 'closed' && existing.status !== 'error') {
      // 幂等重开：同一 appSessionId 只允许一个活动进程（重连场景直接重新附着）
      existing.attached = true;
      existing.lastActivityAt = Date.now();
      return this.toPublic(existing);
    }
    if (existing) this.records.delete(appSessionId);

    const { argv, cwd } = buildPiArgs(req, {
      extensionPath: this.opts.extensionPath,
      extraExtensionArgs: this.opts.extraExtensionArgs?.(),
    });
    const process = this.spawner.spawn({ argv, cwd, label: appSessionId });
    const record: InternalRecord = {
      appSessionId,
      status: 'connecting',
      attached: true,
      cwd,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      lastActivityAt: Date.now(),
      piSessionId: req.piSessionId,
      piSessionPath: req.piSessionPath,
      process,
      tracker: new CrashTracker(),
    };
    this.records.set(appSessionId, record);
    this.opts.logger?.info('会话已打开', { appSessionId, cwd, pid: record.pid });
    return this.toPublic(record);
  }

  /** 向会话 stdin 写一行（host 不解析，仅透传）。会话不存在/已关闭 → false */
  write(appSessionId: string, line: string): boolean {
    const record = this.records.get(appSessionId);
    if (!record || record.status === 'closed' || record.status === 'error') return false;
    record.lastActivityAt = Date.now();
    return record.process.writeLine(line);
  }

  /**
   * 关闭会话。
   * - recycle:true（默认）：终止 pi 进程并移除记录
   * - recycle:false：仅分离（WS 通道断但进程保留，等重连或空闲回收）
   */
  async close(appSessionId: string, opts: { recycle?: boolean } = {}): Promise<void> {
    const record = this.records.get(appSessionId);
    if (!record) return;
    if (opts.recycle === false) {
      record.attached = false;
      record.lastActivityAt = Date.now();
      this.opts.logger?.info('会话已分离（进程保留）', { appSessionId });
      return;
    }
    this.records.delete(appSessionId);
    record.status = 'closed';
    await record.process.terminate();
    this.opts.logger?.info('会话已关闭（进程回收）', { appSessionId });
  }

  get(appSessionId: string): SessionRecord | undefined {
    const record = this.records.get(appSessionId);
    return record ? this.toPublic(record) : undefined;
  }

  list(): SessionRecord[] {
    return [...this.records.values()].map((r) => this.toPublic(r));
  }

  count(): number {
    return this.records.size;
  }

  /**
   * 空闲清扫：回收空闲超过 idleRecycleMs 的会话。
   * 公开方法便于单测直接驱动（不必 fake timers）。
   * @returns 本次被回收的 appSessionId 列表
   */
  async sweep(now: number = Date.now()): Promise<string[]> {
    if (this.opts.idleRecycleMs <= 0) return [];
    const recycled: string[] = [];
    for (const [id, record] of [...this.records.entries()]) {
      if (now - record.lastActivityAt >= this.opts.idleRecycleMs) {
        recycled.push(id);
        await this.close(id, { recycle: true });
        this.opts.logger?.warn('会话空闲超时，已回收', {
          appSessionId: id,
          idleMs: now - record.lastActivityAt,
        });
      }
    }
    return recycled;
  }

  /** host 退出：关闭全部会话（回收进程） */
  async dispose(): Promise<void> {
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    const ids = [...this.records.keys()];
    await Promise.all(ids.map((id) => this.close(id, { recycle: true })));
  }

  /* ---------- PiSpawner 回调接线（由 index.ts 装配，label = appSessionId） ---------- */

  _handleSpawnLines(appSessionId: string, lines: string[]): void {
    const record = this.records.get(appSessionId);
    if (!record) return;
    record.lastActivityAt = Date.now();
    // 首行到达 → 进程确认可用（不代表协议握手完成，握手由 web 端 get_state 负责）
    if (record.status === 'connecting') record.status = 'ready';
    this.handlers.onLines(appSessionId, lines);
  }

  _handleSpawnStderr(appSessionId: string, chunk: string): void {
    this.records.get(appSessionId)?.tracker.append(chunk);
  }

  _handleSpawnExit(appSessionId: string, info: {
    code: number | null;
    signal: NodeJS.Signals | null;
    graceful: boolean;
  }): void {
    const record = this.records.get(appSessionId);
    if (!record) return;
    const error = record.tracker.classify(info);
    record.status = error === null ? 'closed' : 'error';
    this.records.delete(appSessionId);
    this.handlers.onExit(appSessionId, { code: info.code, signal: info.signal, error });
  }

  _handleSpawnError(appSessionId: string, err: Error): void {
    const record = this.records.get(appSessionId);
    if (!record) return;
    record.status = 'error';
    this.records.delete(appSessionId);
    this.handlers.onExit(appSessionId, {
      code: null,
      signal: null,
      error: { code: 'cli_not_found', message: err.message, recoverable: false },
    });
  }

  _handleSpawnIdle(appSessionId: string): void {
    // 进程级空闲定时器触发 → 强制按已空闲判定并走统一清扫
    void (async () => {
      const record = this.records.get(appSessionId);
      if (!record) return;
      record.lastActivityAt = Math.min(record.lastActivityAt, Date.now() - this.opts.idleRecycleMs);
      await this.sweep();
    })();
  }

  private toPublic(r: InternalRecord): SessionRecord {
    return {
      appSessionId: r.appSessionId,
      status: r.status,
      attached: r.attached,
      cwd: r.cwd,
      pid: r.pid,
      piSessionId: r.piSessionId,
      piSessionPath: r.piSessionPath,
      startedAt: r.startedAt,
      lastActivityAt: r.lastActivityAt,
    };
  }
}
