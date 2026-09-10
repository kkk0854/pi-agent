/** automationFence 单测（U-02：fence 剥离与解析） */
import { describe, it, expect } from 'vitest';
import {
  extractAutomationFence,
  hasAutomationFence,
  parseAutomationFence,
  stripAutomationFence,
} from './automationFence';

const FENCE = [
  '好的，已为你设置定时任务：',
  '',
  '```pi-automation',
  JSON.stringify({
    title: '每日站会摘要',
    prompt: '总结昨天的提交',
    projectId: null,
    schedule: { kind: 'daily', time: '09:30' },
  }),
  '```',
  '',
  '到期会自动执行。',
].join('\n');

describe('extractAutomationFence / hasAutomationFence', () => {
  it('提取 pi-automation fence 内容', () => {
    const raw = extractAutomationFence(FENCE);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toHaveProperty('title', '每日站会摘要');
    expect(hasAutomationFence(FENCE)).toBe(true);
  });
  it('无 fence 返回 null / false', () => {
    expect(extractAutomationFence('普通回复')).toBeNull();
    expect(hasAutomationFence('普通回复')).toBe(false);
  });
});

describe('parseAutomationFence', () => {
  it('解析完整草稿（daily）', () => {
    const d = parseAutomationFence(FENCE);
    expect(d).not.toBeNull();
    expect(d!.title).toBe('每日站会摘要');
    expect(d!.schedule).toEqual({ kind: 'daily', time: '09:30' });
    expect(d!.projectId).toBeNull();
  });
  it('解析 weekly / interval / once', () => {
    const wk = parseAutomationFence(
      '```pi-automation\n{"title":"t","prompt":"p","schedule":{"kind":"weekly","weekday":1,"time":"08:00"}}\n```',
    );
    expect(wk!.schedule).toEqual({ kind: 'weekly', weekday: 1, time: '08:00' });
    const iv = parseAutomationFence(
      '```pi-automation\n{"title":"t","prompt":"p","schedule":{"kind":"interval","intervalMinutes":90}}\n```',
    );
    expect(iv!.schedule).toEqual({ kind: 'interval', intervalMinutes: 90 });
    const once = parseAutomationFence(
      '```pi-automation\n{"title":"t","prompt":"p","schedule":{"kind":"once","at":"2026-01-01T10:00:00Z"}}\n```',
    );
    expect(once!.schedule).toEqual({ kind: 'once', at: '2026-01-01T10:00:00Z' });
  });
  it('兼容 json fence 兜底', () => {
    const d = parseAutomationFence(
      '```json\n{"title":"t","prompt":"p","schedule":{"kind":"daily","time":"10:00"}}\n```',
    );
    expect(d!.title).toBe('t');
  });
  it('非法 schedule / 缺字段返回 null（不虚构）', () => {
    expect(parseAutomationFence('```pi-automation\n{"title":"t","schedule":{"kind":"daily","time":"09:00"}}\n```')).toBeNull();
    expect(parseAutomationFence('```pi-automation\n{"title":"t","prompt":"p","schedule":{"kind":"moon"}}\n```')).toBeNull();
    expect(parseAutomationFence('```pi-automation\nnot-json\n```')).toBeNull();
  });
  it('解析 model / thinking 可选字段', () => {
    const d = parseAutomationFence(
      '```pi-automation\n{"title":"t","prompt":"p","schedule":{"kind":"daily","time":"09:00"},"model":{"provider":"anthropic","modelId":"claude-x"},"thinking":"high"}\n```',
    );
    expect(d!.model).toEqual({ provider: 'anthropic', modelId: 'claude-x' });
    expect(d!.thinking).toBe('high');
  });
});

describe('stripAutomationFence', () => {
  it('移除 fence 且保留前后文案（U-02：用户不可见配置块）', () => {
    const out = stripAutomationFence(FENCE);
    expect(out).toContain('好的，已为你设置定时任务');
    expect(out).toContain('到期会自动执行');
    expect(out).not.toContain('pi-automation');
    expect(out).not.toContain('每日站会摘要');
  });
  it('无 fence 时原文返回（trim）', () => {
    expect(stripAutomationFence('  hello  ')).toBe('hello');
  });
});
