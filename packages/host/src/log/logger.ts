/**
 * 结构化日志（R-08）：JSONL 落盘 + 控制台镜像，唯一出口。
 * 所有字段写入前强制过 redact（Q-03：日志无明文凭据）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { redact } from '@pi-agent/shared';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LoggerOptions {
  logDir: string;
  level?: LogLevel;
  /** 是否镜像到控制台（默认 true） */
  consoleMirror?: boolean;
  /** 绑定字段（child logger 继承） */
  bindings?: Record<string, unknown>;
}

export class Logger {
  private readonly levelThreshold: number;
  private readonly mirror: boolean;
  private bindings: Record<string, unknown>;
  private stream: fs.WriteStream;

  constructor(opts: LoggerOptions) {
    this.levelThreshold = LEVEL_ORDER[opts.level ?? 'info'];
    this.mirror = opts.consoleMirror ?? true;
    this.bindings = opts.bindings ?? {};
    const date = new Date();
    const stamp = `${date.getFullYear()}${`${date.getMonth() + 1}`.padStart(2, '0')}${`${date.getDate()}`.padStart(2, '0')}`;
    const file = path.join(opts.logDir, `host-${stamp}.jsonl`);
    this.stream = fs.createWriteStream(file, { flags: 'a', encoding: 'utf8' });
  }

  log(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < this.levelThreshold) return;
    const entry = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...this.bindings,
      ...(fields ?? {}),
    };
    // 硬性脱敏：整行 JSON 序列化后过 redact 再落盘
    this.stream.write(`${redact(JSON.stringify(entry))}\n`);
    if (this.mirror) {
      const line = `[${entry.ts}] ${level.toUpperCase()} ${msg}`;
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
    }
  }

  debug(msg: string, fields?: Record<string, unknown>): void {
    this.log('debug', msg, fields);
  }
  info(msg: string, fields?: Record<string, unknown>): void {
    this.log('info', msg, fields);
  }
  warn(msg: string, fields?: Record<string, unknown>): void {
    this.log('warn', msg, fields);
  }
  error(msg: string, fields?: Record<string, unknown>): void {
    this.log('error', msg, fields);
  }

  /** 派生子 logger（共享日志流，附加绑定字段） */
  child(bindings: Record<string, unknown>): Logger {
    const child = Object.create(this) as Logger;
    child.bindings = { ...this.bindings, ...bindings };
    return child;
  }

  /** 退出前冲刷 */
  flush(): Promise<void> {
    return new Promise((resolve) => this.stream.end(() => resolve()));
  }
}
