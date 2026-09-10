/**
 * 会话崩溃追踪（架构 §2.3 runtime/crash.ts）：
 * - stderr 尾部缓冲（8KB），供四类错误分类
 * - 分类逻辑复用 shared 的 classifyCrash（cli_not_found / auth_failed / network / agent_crash 互不混淆）
 * - 主动 terminate（graceful）不算崩溃
 */
import { classifyCrash, type RuntimeError } from '@pi-agent/shared';
import type { PiProcessExitInfo } from '../pi/process';

const TAIL_CAP = 8 * 1024;

export class CrashTracker {
  private tail = '';

  append(chunk: string): void {
    this.tail = (this.tail + chunk).slice(-TAIL_CAP);
  }

  stderr(): string {
    return this.tail;
  }

  /**
   * 退出分类：
   * - graceful（主动关闭）→ null（不是错误）
   * - 其余按退出码 + stderr 归入四类
   */
  classify(info: PiProcessExitInfo): RuntimeError | null {
    if (info.graceful) return null;
    return classifyCrash(info.code, this.tail);
  }
}
