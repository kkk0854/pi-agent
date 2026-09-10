/**
 * pi 子进程封装（架构 §2.3 pi/process.ts）：
 * - spawn（entry 模式 node 直启，argv 数组直传；pi.cmd 兜底才走 shell）
 * - stdout 经 StdoutFramer 严格分帧 → onLines（host 不解析协议）
 * - stderr 收集（供崩溃分类），环形缓冲上限 64KB
 * - stdin 写单行 JSONL
 * - 优雅退出：stdin.end() → 宽限期 → tree-kill（Windows taskkill /T /F）
 * - 空闲回收定时器（N-03，默认 30min，由 SessionManager 决定动作）
 */
import { spawn, type ChildProcess } from 'node:child_process';
import treeKill from 'tree-kill';
import { StdoutFramer } from './jsonl';

export type PiProcessStatus = 'starting' | 'running' | 'exited';

export interface PiProcessExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** 是否为主动 terminate（优雅退出，不算崩溃） */
  graceful: boolean;
}

export interface PiProcessOptions {
  /** 完整命令：[nodePath, scriptPath]（entry 模式）或 [piCmd]（PATH 兜底） */
  command: string[];
  argv: string[];
  cwd: string;
  /** 是否经 shell 启动（仅 pi.cmd/.sh 兜底；entry 模式恒 false，R-07） */
  shell: boolean;
  idleMs: number;
  onLines(lines: string[]): void;
  onStderr(chunk: string): void;
  onExit(info: PiProcessExitInfo): void;
  onError(err: Error): void;
  /** 空闲超时回调（PiProcess 自身不动进程，动作由上层决定） */
  onIdle(p: PiProcess): void;
}

const STDERR_CAP = 64 * 1024;

export class PiProcess {
  status: PiProcessStatus = 'starting';
  readonly pid: number | undefined;
  private readonly child: ChildProcess;
  private readonly opts: PiProcessOptions;
  private readonly framer = new StdoutFramer();
  private stderrTail = '';
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private terminating = false;
  private exited = false;
  private exitWaiters: ((info: PiProcessExitInfo) => void)[] = [];

  constructor(opts: PiProcessOptions) {
    this.opts = opts;
    let child: ChildProcess;
    try {
      child = spawn(opts.command[0]!, [...opts.command.slice(1), ...opts.argv], {
        cwd: opts.cwd,
        shell: opts.shell,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      // 同步 spawn 失败（极少见）：以 onError 语义上抛
      opts.onError(err instanceof Error ? err : new Error(String(err)));
      this.child = undefined as unknown as ChildProcess;
      this.status = 'exited';
      return;
    }
    this.child = child;
    this.pid = child.pid;

    child.stdout?.on('data', (chunk: Buffer) => {
      if (this.status === 'starting') this.status = 'running';
      const lines = this.framer.push(chunk);
      if (lines.length > 0) this.opts.onLines(lines);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      this.stderrTail = (this.stderrTail + text).slice(-STDERR_CAP);
      this.opts.onStderr(text);
    });

    child.on('error', (err: Error) => {
      // spawn 失败（ENOENT 等）—— only once
      if (this.status !== 'exited') {
        this.status = 'exited';
        this.exited = true;
        this.clearIdle();
        this.opts.onError(err);
      }
    });

    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      const lines = this.framer.end();
      if (lines.length > 0) this.opts.onLines(lines);
      this.status = 'exited';
      this.exited = true;
      this.clearIdle();
      const info: PiProcessExitInfo = { code, signal, graceful: this.terminating };
      this.opts.onExit(info);
      for (const w of this.exitWaiters.splice(0)) w(info);
    });

    this.armIdleTimer();
  }

  /** 向 pi stdin 写一行（不含换行；内部补 \n）。进程已退出返回 false */
  writeLine(line: string): boolean {
    this.touch();
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed || this.exited) return false;
    stdin.write(`${line}\n`);
    return true;
  }

  /** 重置空闲计时（有活动时调用） */
  touch(): void {
    if (this.exited) return;
    this.clearIdle();
    this.armIdleTimer();
  }

  stderr(): string {
    return this.stderrTail;
  }

  /** 优雅退出：先 end stdin 给 pi 收尾机会，宽限后 tree-kill 整棵进程树 */
  terminate(graceMs = 1500): Promise<PiProcessExitInfo> {
    if (this.exited) {
      return Promise.resolve({ code: this.child?.exitCode ?? null, signal: null, graceful: true });
    }
    this.terminating = true;
    this.clearIdle();
    return new Promise<PiProcessExitInfo>((resolve) => {
      let settled = false;
      const done = (info: PiProcessExitInfo): void => {
        if (!settled) {
          settled = true;
          resolve(info);
        }
      };
      this.exitWaiters.push(done);
      try {
        this.child?.stdin?.end();
      } catch {
        /* stdin 已关则忽略 */
      }
      // 宽限期后强杀进程树
      setTimeout(() => {
        if (this.exited) return;
        const pid = this.pid;
        if (pid === undefined) return;
        treeKill(pid, 'SIGTERM', () => {
          /* close 事件会触发 done */
        });
      }, graceMs);
      // tree-kill 也失灵的最后兜底（防悬挂）
      setTimeout(() => {
        if (!this.exited) {
          try {
            this.child?.kill('SIGKILL');
          } catch {
            /* 忽略 */
          }
        }
      }, graceMs + 3000);
    });
  }

  private armIdleTimer(): void {
    if (this.opts.idleMs <= 0) return;
    this.idleTimer = setTimeout(() => this.opts.onIdle(this), this.opts.idleMs);
  }

  private clearIdle(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
