import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLocal, saveLocal } from './persistLocal';

beforeEach(() => {
  localStorage.clear();
});

describe('loadLocal', () => {
  it('键不存在时返回 fallback', () => {
    expect(loadLocal('missing', { a: 1 })).toEqual({ a: 1 });
    expect(loadLocal('missing', 'fallback')).toBe('fallback');
  });

  it('读取带 pi-agent. 前缀的 JSON 值', () => {
    localStorage.setItem('pi-agent.theme', JSON.stringify('dark'));
    expect(loadLocal('theme', 'light')).toBe('dark');
  });

  it('损坏的 JSON 返回 fallback 而不抛错', () => {
    localStorage.setItem('pi-agent.bad', '{not-json');
    expect(loadLocal('bad', 42)).toBe(42);
  });

  it('localStorage 抛错时返回 fallback（隐私模式兜底）', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(loadLocal('x', 'safe')).toBe('safe');
    spy.mockRestore();
  });

  it('同名无前缀键互不干扰', () => {
    localStorage.setItem('theme', JSON.stringify('dark'));
    expect(loadLocal('theme', 'light')).toBe('light');
  });
});

describe('saveLocal', () => {
  it('写入后可读回（round-trip）', () => {
    saveLocal('layout', { sidebar: 240, order: [1, 2] });
    expect(loadLocal('layout', null)).toEqual({ sidebar: 240, order: [1, 2] });
    expect(localStorage.getItem('pi-agent.layout')).toBe('{"sidebar":240,"order":[1,2]}');
  });

  it('配额满/隐私模式写入失败不抛错', () => {
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
    expect(() => saveLocal('big', { blob: 'x'.repeat(1000) })).not.toThrow();
    spy.mockRestore();
  });

  it('覆盖旧值', () => {
    saveLocal('k', 1);
    saveLocal('k', 2);
    expect(loadLocal('k', 0)).toBe(2);
  });
});
