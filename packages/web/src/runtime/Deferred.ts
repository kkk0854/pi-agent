/** Deferred：命令 id ↔ 响应配对（带超时与运行时错误拒绝） */
import type { RuntimeError } from '@pi-agent/shared';

export class Deferred<T> {
  readonly promise: Promise<T>;
  private resolveFn!: (v: T) => void;
  private rejectFn!: (e: RuntimeError) => void;
  private settled = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(timeoutMs?: number, onTimeout?: RuntimeError) {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolveFn = (v) => {
        if (!this.settled) {
          this.settled = true;
          resolve(v);
        }
      };
      this.rejectFn = (e) => {
        if (!this.settled) {
          this.settled = true;
          reject(e);
        }
      };
      if (timeoutMs !== undefined && timeoutMs > 0) {
        this.timer = setTimeout(() => {
          this.rejectFn(
            onTimeout ?? { code: 'timeout', message: '命令响应超时', recoverable: true },
          );
        }, timeoutMs);
      }
    });
  }

  resolve(v: T): void {
    this.clearTimer();
    this.resolveFn(v);
  }

  reject(e: RuntimeError): void {
    this.clearTimer();
    this.rejectFn(e);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
