/** chatStore.applyChatEvent 归约单测：块增量累积（禁止整段替换）/ 工具事件挂载 / 终态收口 */
import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '@pi-agent/shared';
import { applyChatEvent, type ChatMessage } from './chatStore';

const sid = 's1';
const mid = 'm1';

describe('applyChatEvent', () => {
  it('message.start → block.start → delta 累积（同 contentIndex 追加）', () => {
    let msgs: ChatMessage[] = [];
    msgs = applyChatEvent(msgs, { t: 'message.start', sessionId: sid, messageId: mid, role: 'assistant' });
    msgs = applyChatEvent(msgs, { t: 'block.start', sessionId: sid, messageId: mid, blockIndex: 0, kind: 'text' });
    msgs = applyChatEvent(msgs, { t: 'block.delta', sessionId: sid, messageId: mid, blockIndex: 0, kind: 'text', delta: '你' });
    msgs = applyChatEvent(msgs, { t: 'block.delta', sessionId: sid, messageId: mid, blockIndex: 0, kind: 'text', delta: '好' });

    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.blocks[0]).toEqual({
      kind: 'text',
      blockIndex: 0,
      text: '你好',
      done: false,
    });
  });

  it('思考块与正文块按 blockIndex 分开累积', () => {
    let msgs: ChatMessage[] = [];
    msgs = applyChatEvent(msgs, { t: 'message.start', sessionId: sid, messageId: mid, role: 'assistant' });
    msgs = applyChatEvent(msgs, { t: 'block.start', sessionId: sid, messageId: mid, blockIndex: 0, kind: 'thinking' });
    msgs = applyChatEvent(msgs, { t: 'block.delta', sessionId: sid, messageId: mid, blockIndex: 0, kind: 'thinking', delta: '想一想' });
    msgs = applyChatEvent(msgs, { t: 'block.start', sessionId: sid, messageId: mid, blockIndex: 1, kind: 'text' });
    msgs = applyChatEvent(msgs, { t: 'block.delta', sessionId: sid, messageId: mid, blockIndex: 1, kind: 'text', delta: '答案' });

    expect(msgs[0]!.blocks).toHaveLength(2);
    expect(msgs[0]!.blocks[0]).toMatchObject({ kind: 'thinking', text: '想一想' });
    expect(msgs[0]!.blocks[1]).toMatchObject({ kind: 'text', text: '答案' });
  });

  it('tool.start / tool.end：独立事件流落到卡片块，失败标记 isError', () => {
    let msgs: ChatMessage[] = [];
    msgs = applyChatEvent(msgs, { t: 'message.start', sessionId: sid, messageId: mid, role: 'assistant' });
    msgs = applyChatEvent(msgs, {
      t: 'tool.start',
      sessionId: sid,
      toolCallId: 'tc1',
      toolName: 'read',
      args: { path: 'a.ts' },
    });
    expect(msgs[0]!.blocks[0]).toMatchObject({ kind: 'toolCall', toolName: 'read', done: false });

    msgs = applyChatEvent(msgs, {
      t: 'tool.end',
      sessionId: sid,
      toolCallId: 'tc1',
      result: { error: 'boom' },
      isError: true,
    });
    expect(msgs[0]!.blocks[0]).toMatchObject({ kind: 'toolCall', isError: true, done: true });
  });

  it('agent.settled 终态：全部块与消息收口为 done', () => {
    let msgs: ChatMessage[] = [];
    msgs = applyChatEvent(msgs, { t: 'message.start', sessionId: sid, messageId: mid, role: 'assistant' });
    msgs = applyChatEvent(msgs, { t: 'block.start', sessionId: sid, messageId: mid, blockIndex: 0, kind: 'text' });
    msgs = applyChatEvent(msgs, { t: 'agent.settled', sessionId: sid, turnId: 't1' });

    expect(msgs[0]!.done).toBe(true);
    expect(msgs[0]!.blocks.every((b) => b.done)).toBe(true);
  });

  it('无法识别事件类型安全穿透（前向兼容不崩）', () => {
    const msgs = applyChatEvent([], { t: 'raw', sessionId: sid, line: '{"type":"future_event"}' } as RuntimeEvent);
    expect(msgs).toEqual([]);
  });
});
