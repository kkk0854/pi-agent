/**
 * PiFrameNormalizer 单测：原始 JSONL 行 → RuntimeEvent。
 * 核心路径：message_update 分块累积、工具三段式、扩展 UI（ANSI 剥离/清除语义）、
 * agent_end 非终态 / agent_settled 终态、response 配对、未知帧前向兼容。
 * 另用真实帧 fixture（src/test/fixtures/real-frames.jsonl）做整体回放。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PiFrameNormalizer } from './normalizer';
import type { RuntimeEvent } from './events';

const SID = 'app-session-1';

function norm(): PiFrameNormalizer {
  return new PiFrameNormalizer(SID);
}

function types(events: RuntimeEvent[]): string[] {
  return events.map((e) => e.t);
}

describe('message_update → block.start/delta/end（contentIndex 分块）', () => {
  it('text/thinking/toolcall 按 contentIndex 分块累积', () => {
    const n = norm();
    const events = n.pushMany([
      JSON.stringify({ type: 'message_start', message: { id: 'm1', role: 'assistant' } }),
      JSON.stringify({ type: 'message_update', message: { id: 'm1' }, assistantMessageEvent: { type: 'text_start', contentIndex: 0 } }),
      JSON.stringify({ type: 'message_update', message: { id: 'm1' }, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '我先' } }),
      JSON.stringify({ type: 'message_update', message: { id: 'm1' }, assistantMessageEvent: { type: 'thinking_start', contentIndex: 1 } }),
      JSON.stringify({ type: 'message_update', message: { id: 'm1' }, assistantMessageEvent: { type: 'thinking_delta', contentIndex: 1, delta: '用户想要…' } }),
      JSON.stringify({ type: 'message_update', message: { id: 'm1' }, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '看代码' } }),
      JSON.stringify({ type: 'message_update', message: { id: 'm1' }, assistantMessageEvent: { type: 'text_end', contentIndex: 0 } }),
    ]);

    expect(types(events)).toEqual([
      'message.start',
      'block.start',
      'block.delta',
      'block.start',
      'block.delta',
      'block.delta',
      'block.end',
    ]);

    const delta0 = events.filter((e) => e.t === 'block.delta' && e.blockIndex === 0);
    const deltas = delta0.map((e) => (e.t === 'block.delta' ? e.delta : ''));
    expect(deltas).toEqual(['我先', '看代码']);

    const think = events.find((e) => e.t === 'block.start' && e.blockIndex === 1);
    expect(think && think.t === 'block.start' ? think.kind : '').toBe('thinking');
  });

  it('message_update 缺 message.id 时沿用 lastMessageId', () => {
    const n = norm();
    n.push(JSON.stringify({ type: 'message_start', message: { id: 'm9', role: 'assistant' } }));
    const events = n.push(
      JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'x' } }),
    );
    const delta = events.find((e) => e.t === 'block.delta');
    expect(delta && delta.t === 'block.delta' ? delta.messageId : '').toBe('m9');
  });

  it('user 消息的 message_start 不进入渲染流', () => {
    const n = norm();
    expect(n.push(JSON.stringify({ type: 'message_start', message: { id: 'u1', role: 'user' } }))).toEqual([]);
  });

  it('无 id 的多条 assistant message_start 各自生成唯一 id（多 turn 不重复）', () => {
    const n = norm();
    const first = n.push(JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }));
    const second = n.push(
      JSON.stringify({
        type: 'message_start',
        message: { role: 'assistant' },
      }),
    );
    const id1 = first[0]!.t === 'message.start' ? first[0]!.messageId : '';
    const id2 = second[0]!.t === 'message.start' ? second[0]!.messageId : '';
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
    // 同一条消息的 update/end 帧沿用该消息的 id
    const end = n.push(JSON.stringify({ type: 'message_end', message: { role: 'assistant' } }));
    expect(end[0]!.t === 'message.end' ? end[0]!.messageId : '').toBe(id2);
  });
});

describe('tool_execution_* → tool.start/update/end', () => {
  it('三段式映射并保留 isError', () => {
    const n = norm();
    const events = n.pushMany([
      JSON.stringify({ type: 'tool_execution_start', toolCallId: 'tc1', toolName: 'bash', args: { command: 'npm test' } }),
      JSON.stringify({ type: 'tool_execution_update', toolCallId: 'tc1', partialResult: { output: 'ok' } }),
      JSON.stringify({ type: 'tool_execution_end', toolCallId: 'tc1', result: { exitCode: 1 }, isError: true }),
    ]);
    expect(types(events)).toEqual(['tool.start', 'tool.update', 'tool.end']);
    const end = events[2];
    expect(end.t === 'tool.end' ? end.isError : null).toBe(true);
  });
});

describe('agent_end 非终态 / agent_settled 终态', () => {
  it('两者都发事件，但语义区分由 UI 消费（settled 才收回运行中）', () => {
    const n = norm();
    const events = n.pushMany([
      JSON.stringify({ type: 'agent_start' }),
      JSON.stringify({ type: 'agent_end', messages: [] }),
      JSON.stringify({ type: 'agent_settled', willRetry: false }),
    ]);
    expect(types(events)).toEqual(['agent.start', 'agent.end', 'agent.settled']);
  });

  it('compaction / retry / queue 事件同名校验', () => {
    const n = norm();
    const events = n.pushMany([
      JSON.stringify({ type: 'compaction_start', reason: 'threshold' }),
      JSON.stringify({ type: 'compaction_end', aborted: false, willRetry: false }),
      JSON.stringify({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 500 }),
      JSON.stringify({ type: 'auto_retry_end', success: true }),
      JSON.stringify({ type: 'queue_update', steering: [{ m: 1 }], followUp: [] }),
    ]);
    expect(types(events)).toEqual(['compaction.start', 'compaction.end', 'retry.start', 'retry.end', 'queue.update']);
  });
});

describe('extension_ui_request（A-12：ANSI 剥离 + 清除语义）', () => {
  it('setStatus：剥离 ANSI 且标记 ansi=true', () => {
    const n = norm();
    const frame = {
      type: 'extension_ui_request',
      id: 'r1',
      method: 'setStatus',
      statusKey: 'mcp',
      statusText: '\u001B[38;2;138;190;183m🔌 MCP: 3 servers enabled\u001B[39m',
    };
    const events = n.push(JSON.stringify(frame));
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev.t).toBe('ui.status');
    if (ev.t === 'ui.status') {
      expect(ev.statusKey).toBe('mcp');
      expect(ev.text).toBe('🔌 MCP: 3 servers enabled');
      expect(ev.ansi).toBe(true);
    }
  });

  it('setStatus 省略 statusText → 清除（text 为空串）', () => {
    const n = norm();
    const events = n.push(JSON.stringify({ type: 'extension_ui_request', id: 'r2', method: 'setStatus', statusKey: 'mcp' }));
    const ev = events[0];
    expect(ev.t).toBe('ui.status');
    if (ev.t === 'ui.status') expect(ev.text).toBe('');
  });

  it('confirm → ui.request（需应答）', () => {
    const n = norm();
    const events = n.push(
      JSON.stringify({ type: 'extension_ui_request', id: 'r3', method: 'confirm', title: '允许写入？', message: '将写入 src/a.ts' }),
    );
    expect(types(events)).toEqual(['ui.request']);
    const ev = events[0];
    if (ev.t === 'ui.request') {
      expect(ev.req.method).toBe('confirm');
      expect(ev.req.id).toBe('r3');
      expect(ev.req.title).toBe('允许写入？');
    }
  });

  it('notify / setWidget / setTitle / set_editor_text 即发即忘', () => {
    const n = norm();
    const events = n.pushMany([
      JSON.stringify({ type: 'extension_ui_request', id: 'n1', method: 'notify', message: '完成', notifyType: 'warning' }),
      JSON.stringify({ type: 'extension_ui_request', id: 'n2', method: 'setWidget', widgetKey: 'w', widgetLines: ['行一', '行二'], placement: 'belowEditor' }),
      JSON.stringify({ type: 'extension_ui_request', id: 'n3', method: 'setTitle', title: '新标题' }),
      JSON.stringify({ type: 'extension_ui_request', id: 'n4', method: 'set_editor_text', text: '草稿' }),
    ]);
    expect(types(events)).toEqual(['ui.notify', 'ui.widget', 'ui.title', 'ui.setEditorText']);
    const widget = events[1];
    if (widget.t === 'ui.widget') expect(widget.placement).toBe('belowEditor');
  });

  it('未知 method 仅保留 raw，不崩', () => {
    const n = norm();
    const events = n.push(JSON.stringify({ type: 'extension_ui_request', id: 'x', method: 'mystery' }));
    expect(types(events)).toEqual(['raw']);
  });
});

describe('response：命令-响应按 id 配对', () => {
  it('get_state 回执额外发 session.state；onResponse 收到原始帧', () => {
    const n = norm();
    const seen: string[] = [];
    n.onResponse((f) => seen.push(`${f.id}:${String(f.success)}`));
    const state = { sessionId: 'pi-1', thinkingLevel: 'high', isStreaming: false };
    const events = n.push(JSON.stringify({ type: 'response', id: 'h1', command: 'get_state', success: true, data: state }));
    expect(seen).toEqual(['h1:true']);
    expect(types(events)).toEqual(['session.state']);
    const ev = events[0];
    if (ev.t === 'session.state') expect(ev.state).toEqual(state);
  });

  it('命令失败回执保留 raw', () => {
    const n = norm();
    const events = n.push(JSON.stringify({ type: 'response', id: 'h2', command: 'abort', success: false, error: 'not running' }));
    expect(types(events)).toEqual(['raw']);
  });
});

describe('未知帧前向兼容', () => {
  it('非 JSON 行 → raw + protocol_unknown', () => {
    const n = norm();
    const events = n.push('not-json{{{');
    expect(types(events)).toEqual(['raw', 'error']);
    const err = events[1];
    if (err.t === 'error') {
      expect(err.code).toBe('protocol_unknown');
      expect(err.recoverable).toBe(true);
    }
  });

  it('未知 type → raw + protocol_unknown', () => {
    const n = norm();
    const events = n.push(JSON.stringify({ type: 'brand_new_frame', foo: 1 }));
    expect(types(events)).toEqual(['raw', 'error']);
  });

  it('空行返回空', () => {
    expect(norm().push('   ')).toEqual([]);
  });
});

describe('真实帧 fixture 整体回放', () => {
  it('fixture 全部归一化且关键事件齐全', () => {
    const fixturePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test/fixtures/real-frames.jsonl');
    const lines = readFileSync(fixturePath, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    const n = new PiFrameNormalizer('app-session-1');
    const events = n.pushMany(lines);
    const t = types(events);

    expect(t[0]).toBe('ui.status');
    expect(events[0].t === 'ui.status' ? events[0].text : '').toBe('🔌 MCP: 3 servers enabled');
    expect(t).toContain('agent.start');
    expect(t).toContain('block.start');
    expect(t).toContain('tool.start');
    expect(t).toContain('tool.end');
    expect(t).toContain('agent.end');
    expect(t).toContain('agent.settled');
    expect(t).toContain('session.state');
    // 未知帧：raw + protocol_unknown（最后一行）
    expect(t.slice(-2)).toEqual(['raw', 'error']);
  });
});

describe('命令响应：fork/get_tree/get_fork_messages/clone 透传 + 配对（T04a）', () => {
  it('fork 回执：onResponse 收到且保留 raw', () => {
    const n = norm();
    const seen: string[] = [];
    n.onResponse((f) => seen.push(`${f.command}:${String(f.success)}`));
    const data = { appSessionId: 'new-1', piSessionId: 'pi-new-1', sessionFile: '/s/new.jsonl' };
    const events = n.push(JSON.stringify({ type: 'response', id: 'f1', command: 'fork', success: true, data }));
    expect(seen).toEqual(['fork:true']);
    expect(types(events)).toEqual(['raw']);
    const rawEv = events[0];
    expect(rawEv.t === 'raw' ? rawEv.line : '').toContain('"command":"fork"');
  });

  it('get_tree 回执：data 直接透传给 Deferred（前端用其构造分支树）', () => {
    const n = norm();
    let captured: unknown = null;
    n.onResponse((f) => {
      if (f.command === 'get_tree') captured = f.data;
    });
    const treeData = { tree: [{ id: 'n1', label: 'main' }], leafId: 'n1' };
    n.push(JSON.stringify({ type: 'response', id: 't1', command: 'get_tree', success: true, data: treeData }));
    expect(captured).toEqual(treeData);
  });

  it('get_fork_messages 回执：data 数组透传', () => {
    const n = norm();
    let captured: unknown = null;
    n.onResponse((f) => {
      if (f.command === 'get_fork_messages') captured = f.data;
    });
    const points = [{ entryId: 'e1', label: '起点' }];
    n.push(JSON.stringify({ type: 'response', id: 'g1', command: 'get_fork_messages', success: true, data: points }));
    expect(captured).toEqual(points);
  });

  it('clone 回执同样透传且不崩', () => {
    const n = norm();
    const seen: string[] = [];
    n.onResponse((f) => seen.push(f.command ?? ''));
    n.push(JSON.stringify({ type: 'response', id: 'c1', command: 'clone', success: true, data: { appSessionId: 'c' } }));
    expect(seen).toEqual(['clone']);
  });
});

describe('未知结构前向兼容（T04a 健壮性）', () => {
  it('缺少 data 的成功响应仍保留 raw 不崩', () => {
    const n = norm();
    const events = n.push(JSON.stringify({ type: 'response', id: 'x', command: 'fork', success: true }));
    expect(types(events)).toEqual(['raw']);
  });

  it('data 为非对象（数组/字符串）也不崩', () => {
    const n = norm();
    const events = n.push(JSON.stringify({ type: 'response', id: 'x2', command: 'get_tree', success: true, data: 'oops' }));
    expect(types(events)).toEqual(['raw']);
  });
});
