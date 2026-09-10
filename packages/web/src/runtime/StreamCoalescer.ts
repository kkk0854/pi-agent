/**
 * StreamCoalescer（架构 §3.4）：block.delta 按 ~48ms 时间窗合并后下行，
 * 其余事件立即透传（透传前先冲刷缓冲，保证顺序）。
 * 真实/Mock 两条链路共用（都位于 normalizer 之后、订阅者之前）。
 */
import type { BlockKind, RuntimeEvent } from '@pi-agent/shared';

interface PendingDelta {
  sessionId: string;
  messageId: string;
  blockIndex: number;
  kind: BlockKind;
  delta: string;
}

export class StreamCoalescer {
  private pending = new Map<string, PendingDelta>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly intervalMs: number;
  private disposed = false;

  constructor(
    private readonly emit: (e: RuntimeEvent) => void,
    intervalMs = 48,
  ) {
    this.intervalMs = intervalMs;
  }

  /**
   * 喂入一个事件：block.delta 缓冲合并；其余事件先冲刷缓冲再原样下发。
   * 契约：事件总由本类负责发射，调用方不得再转发（返回 true 表示已消费）。
   * @returns true = 已消费；false = 已 dispose（调用方需自行处理，正常链路不会遇到）
   */
  feed(e: RuntimeEvent): boolean {
    if (this.disposed) return false;
    if (e.t !== 'block.delta') {
      // 非流式 delta：先冲刷，保证 start/delta/end 的相对顺序
      this.flush();
      this.emit(e);
      return true;
    }
    const key = `${e.messageId}:${e.blockIndex}`;
    const cur = this.pending.get(key);
    if (cur) {
      cur.delta += e.delta;
    } else {
      this.pending.set(key, {
        sessionId: e.sessionId,
        messageId: e.messageId,
        blockIndex: e.blockIndex,
        kind: e.kind,
        delta: e.delta,
      });
    }
    if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), this.intervalMs);
    }
    return true;
  }

  /** 立即下发全部缓冲的 delta */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending.size === 0) return;
    const batch = [...this.pending.values()];
    this.pending.clear();
    for (const p of batch) {
      this.emit({
        t: 'block.delta',
        sessionId: p.sessionId,
        messageId: p.messageId,
        blockIndex: p.blockIndex,
        kind: p.kind,
        delta: p.delta,
      });
    }
  }

  dispose(): void {
    this.flush();
    this.disposed = true;
  }
}
