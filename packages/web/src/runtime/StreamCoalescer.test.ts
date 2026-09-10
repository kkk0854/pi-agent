/** StreamCoalescer 单测：delta 合并窗口、事件顺序、flush/dispose */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { RuntimeEvent } from '@pi-agent/shared';
import { StreamCoalescer } from './StreamCoalescer';

const delta = (i: number, text: string): RuntimeEvent => ({
  t: 'block.delta',
  sessionId: 's1',
  messageId: 'm1',
  blockIndex: i,
  kind: 'text',
  delta: text,
});

describe('StreamCoalescer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('同块 delta 在窗口内合并为一条', () => {
    const out: RuntimeEvent[] = [];
    const c = new StreamCoalescer((e) => out.push(e), 48);
    expect(c.feed(delta(0, '你'))).toBe(true);
    expect(c.feed(delta(0, '好'))).toBe(true);
    expect(out).toHaveLength(0);
    vi.advanceTimersByTime(48);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ t: 'block.delta', delta: '你好' });
  });

  it('不同块分别合并，不串块', () => {
    const out: RuntimeEvent[] = [];
    const c = new StreamCoalescer((e) => out.push(e), 48);
    c.feed(delta(0, 'A'));
    c.feed(delta(1, 'B'));
    vi.advanceTimersByTime(48);
    expect(out.map((e) => (e.t === 'block.delta' ? e.delta : ''))).toEqual(['A', 'B']);
  });

  it('非 delta 事件先冲刷缓冲再下发（保证 start/delta/end 顺序）', () => {
    const out: RuntimeEvent[] = [];
    const c = new StreamCoalescer((e) => out.push(e), 48);
    c.feed(delta(0, '部分'));
    const start: RuntimeEvent = { t: 'message.start', sessionId: 's1', messageId: 'm2', role: 'assistant' };
    expect(c.feed(start)).toBe(true);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ delta: '部分' });
    expect(out[1]).toEqual(start);
  });

  it('dispose 冲刷剩余缓冲', () => {
    const out: RuntimeEvent[] = [];
    const c = new StreamCoalescer((e) => out.push(e), 48);
    c.feed(delta(0, '尾巴'));
    c.dispose();
    expect(out).toHaveLength(1);
    // dispose 后不再接收（返回 false，提示调用方事件未被消费）
    expect(c.feed(delta(0, 'x'))).toBe(false);
    expect(out).toHaveLength(1);
  });
});
