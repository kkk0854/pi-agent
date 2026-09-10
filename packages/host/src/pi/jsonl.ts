/**
 * host 侧行中继辅助（架构 §2.3 pi/jsonl.ts）。
 * host 不解析 pi 协议（架构 §1.5），只做：
 * 1. stdout chunk → 严格 \n 分帧（复用 shared 的 createJsonlSplitter，禁 readline）
 * 2. 行缓冲合并 —— 高频流式帧按小时间窗批量下行，降低 WS 消息数
 */
import { createJsonlSplitter, type JsonlSplitter } from '@pi-agent/shared';

export interface LineBatcherOptions {
  /** 批量下行时间窗（ms），默认 16ms（≈一帧的节奏，肉眼无感） */
  intervalMs?: number;
  /** 缓冲行数上限：达到立即冲刷，避免极端高频下窗口期内积压 */
  maxLines?: number;
}

/** 行批量器：push 进来的行按窗口合并后回调 sink */
export class LineBatcher {
  private buffer: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly intervalMs: number;
  private readonly maxLines: number;
  private disposed = false;

  constructor(
    private readonly sink: (lines: string[]) => void,
    opts: LineBatcherOptions = {},
  ) {
    this.intervalMs = opts.intervalMs ?? 16;
    this.maxLines = opts.maxLines ?? 200;
  }

  /** 追加一行（应已是完整行，不含换行） */
  push(line: string): void {
    if (this.disposed) return;
    this.buffer.push(line);
    if (this.buffer.length >= this.maxLines) {
      this.flush();
      return;
    }
    if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), this.intervalMs);
    }
  }

  /** 立即冲刷缓冲 */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length === 0) return;
    const lines = this.buffer;
    this.buffer = [];
    try {
      this.sink(lines);
    } catch {
      // 下行失败不影响 pi 进程继续产出（WS 层自行处理断连）
    }
  }

  /** 停止批量器（冲刷剩余行后不再接收） */
  dispose(): void {
    this.flush();
    this.disposed = true;
  }
}

/**
 * stdout 解码 + 分帧器：把字节流按 UTF-8 解码并按 \n 切成完整行。
 * 供 pi/process.ts 使用；避免多字节字符被 chunk 边界截断。
 */
export class StdoutFramer {
  private readonly decoder = new TextDecoder('utf8');
  private readonly splitter: JsonlSplitter = createJsonlSplitter();

  /** 喂入一段 stdout 字节，返回其中完整行 */
  push(chunk: Buffer): string[] {
    return this.splitter.push(this.decoder.decode(chunk, { stream: true }));
  }

  /** 流结束：冲出解码器残余与最后一行（若非空） */
  end(): string[] {
    const tail = this.decoder.decode();
    return [...this.splitter.push(tail), ...this.splitter.end()];
  }
}
