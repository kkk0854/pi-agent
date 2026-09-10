/**
 * Mock 帧序列 → PiFrameNormalizer 单测：
 * 验证 MockPiSession 产出的原始 JSONL 行与真实 pi 同构，
 * 经归一化后得到正确的 RuntimeEvent 流（思考/工具/正文/终态）。
 */
import { describe, expect, it, vi } from 'vitest';
import { PiFrameNormalizer, type RuntimeEvent } from '@pi-agent/shared';
import { MockPiSession } from './MockFrameProducer';

/** 收集一个完整 mock 轮次的全部事件（真实延迟压缩为 0） */
async function runMockTurn(script: 'tool-heavy' | 'plain' | 'approval' | 'compact' | 'error') {
  const normalizer = new PiFrameNormalizer('s1');
  const events: RuntimeEvent[] = [];
  normalizer.onResponse(() => undefined);
  const session = new MockPiSession(
    { appSessionId: 's1', latencyMs: 0, script, errorInjection: 'none' },
    { onLines: (lines) => events.push(...normalizer.pushMany(lines)) },
  );
  session.write(JSON.stringify({ id: 'cmd-1', type: 'prompt', message: '你好' }));
  // 等待内部异步链路跑完（latencyMs=0 时逐帧 await 微任务/宏任务）
  await vi.waitFor(
    () => {
      const settled = events.some((e) => e.t === 'agent.settled');
      if (!settled) throw new Error('not settled yet');
    },
    { timeout: 10_000, interval: 50 },
  );
  session.dispose();
  return events;
}

describe('Mock 帧序列过 normalizer', () => {
  it('tool-heavy：思考块 + 工具事件 + 正文块 + agent.settled 终态', async () => {
    const events = await runMockTurn('tool-heavy');
    const kinds = events.map((e) => e.t);

    expect(kinds).toContain('agent.start');
    expect(kinds).toContain('block.start');
    expect(kinds.filter((k) => k === 'block.delta').length).toBeGreaterThan(3);
    expect(kinds).toContain('tool.start');
    expect(kinds).toContain('tool.end');
    expect(kinds).toContain('agent.end');
    // 终态必须是 agent.settled（agent.end 非终态，架构 §3.4）
    expect(kinds.lastIndexOf('agent.settled')).toBeGreaterThan(kinds.lastIndexOf('agent.end'));

    // 思考 delta 与正文 delta 的块类型正确
    const thinkDelta = events.find((e) => e.t === 'block.delta' && e.kind === 'thinking');
    expect(thinkDelta).toBeDefined();
    const textDelta = events.filter((e) => e.t === 'block.delta' && e.kind === 'text');
    expect(textDelta.length).toBeGreaterThan(0);

    // 工具成功收口
    const toolEnd = events.find((e) => e.t === 'tool.end');
    expect(toolEnd).toMatchObject({ isError: false });
  });

  it('plain：无工具、正文按 contentIndex 0 累积', async () => {
    const events = await runMockTurn('plain');
    expect(events.some((e) => e.t === 'tool.start')).toBe(false);
    const deltas = events.filter((e) => e.t === 'block.delta' && e.kind === 'text');
    const full = deltas.map((e) => (e.t === 'block.delta' ? e.delta : '')).join('');
    expect(full).toContain('Mock 流式回复');
    expect(deltas[0]).toMatchObject({ blockIndex: 0 });
  });

  it('approval：产出 extension_ui_request 归一化为 ui.request，且轮次仍能终态', async () => {
    const events = await runMockTurn('approval');
    const uiReq = events.find((e) => e.t === 'ui.request');
    expect(uiReq).toBeDefined();
    if (uiReq?.t === 'ui.request') {
      expect(uiReq.req.method).toBe('confirm');
      expect((uiReq.req.title ?? '').length).toBeGreaterThan(0);
    }
    expect(events.some((e) => e.t === 'agent.settled')).toBe(true);
  });

  it('get_state 命令得到 response 回执（握手用）', () => {
    const normalizer = new PiFrameNormalizer('s1');
    const responses: unknown[] = [];
    normalizer.onResponse((frame) => responses.push(frame));
    const session = new MockPiSession(
      { appSessionId: 's1', latencyMs: 0, script: 'plain', errorInjection: 'none' },
      { onLines: (lines) => void normalizer.pushMany(lines) },
    );
    session.write(JSON.stringify({ id: 'st-1', type: 'get_state' }));
    expect(responses).toHaveLength(1);
    const frame = responses[0] as { type: string; success: boolean; command: string; data: { sessionId: string } };
    expect(frame.success).toBe(true);
    expect(frame.command).toBe('get_state');
    expect(frame.data.sessionId).toBe('mock-pi-session-0001');
    session.dispose();
  });
});

describe('Mock fork/tree/get_fork_messages 帧（T04a）', () => {
  function sendAndCapture(type: string, extra: Record<string, unknown> = {}): { command: string; success: boolean; data: unknown } {
    const normalizer = new PiFrameNormalizer('s2');
    let captured: { command: string; success: boolean; data: unknown } | null = null;
    normalizer.onResponse((frame) => {
      if (frame.command === type) captured = { command: frame.command, success: frame.success, data: frame.data };
    });
    const session = new MockPiSession(
      { appSessionId: 's2', latencyMs: 0, script: 'plain', errorInjection: 'none' },
      { onLines: (lines) => void normalizer.pushMany(lines) },
    );
    session.write(JSON.stringify({ id: `cmd-${type}`, type, ...extra }));
    session.dispose();
    if (!captured) throw new Error(`no response for ${type}`);
    return captured;
  }

  it('get_fork_messages 返回可 fork 点数组', () => {
    const res = sendAndCapture('get_fork_messages');
    expect(res.success).toBe(true);
    const data = res.data as { entryId: string; label: string }[];
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]!.entryId).toBeTruthy();
  });

  it('get_tree 返回树结构与 leafId', () => {
    const res = sendAndCapture('get_tree');
    expect(res.success).toBe(true);
    const data = res.data as { tree: unknown[]; leafId: string };
    expect(Array.isArray(data.tree)).toBe(true);
    expect(data.tree.length).toBeGreaterThan(0);
    expect(data.leafId).toBeTruthy();
  });

  it('fork 返回新会话标识（F-03）', () => {
    const res = sendAndCapture('fork', { entryId: 'entry-x' });
    expect(res.success).toBe(true);
    const data = res.data as { appSessionId: string; piSessionId?: string; sessionFile?: string };
    expect(data.appSessionId).toBeTruthy();
    expect(data.sessionFile).toBeTruthy();
  });

  it('clone 返回新会话标识', () => {
    const res = sendAndCapture('clone');
    expect(res.success).toBe(true);
    const data = res.data as { appSessionId: string };
    expect(data.appSessionId).toBeTruthy();
  });
});
