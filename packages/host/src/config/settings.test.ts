import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@pi-agent/shared';
import { loadSettings, saveSettings } from './settings';
import type { Logger } from '../log/logger';
import type { AppDirs } from './paths';

let tmp: string;
let dirs: AppDirs;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-agent-settings-'));
  dirs = { root: tmp, logs: tmp, sessions: tmp, extensions: tmp };
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('loadSettings', () => {
  it('文件缺失回退默认值且不抛错', () => {
    expect(loadSettings(dirs)).toEqual(DEFAULT_SETTINGS);
  });

  it('JSON 损坏回退默认值', () => {
    fs.writeFileSync(path.join(tmp, 'settings.json'), '{broken', 'utf8');
    expect(loadSettings(dirs)).toEqual(DEFAULT_SETTINGS);
  });

  it('校验失败回退默认值并记录 warn', () => {
    fs.writeFileSync(
      path.join(tmp, 'settings.json'),
      JSON.stringify({ maxConcurrentAgents: 99 }), // 超出上限
      'utf8',
    );
    const warn = vi.fn();
    const result = loadSettings(dirs, { warn } as unknown as Logger);
    expect(result).toEqual(DEFAULT_SETTINGS);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('校验失败');
  });

  it('合法设置按文件值读取', () => {
    fs.writeFileSync(
      path.join(tmp, 'settings.json'),
      JSON.stringify({ theme: 'dark', telemetryEnabled: true }),
      'utf8',
    );
    const result = loadSettings(dirs);
    expect(result.theme).toBe('dark');
    expect(result.telemetryEnabled).toBe(true);
    expect(result.maxConcurrentAgents).toBe(DEFAULT_SETTINGS.maxConcurrentAgents);
  });

  it('未知字段被剥离（zod 严格 schema 行为由 schema 决定，这里验证不炸）', () => {
    fs.writeFileSync(
      path.join(tmp, 'settings.json'),
      JSON.stringify({ theme: 'light', hackerField: 'x' }),
      'utf8',
    );
    const result = loadSettings(dirs);
    expect(result.theme).toBe('light');
    expect((result as Record<string, unknown>)['hackerField']).toBeUndefined();
  });
});

describe('saveSettings', () => {
  it('保存 → 读取 round-trip', () => {
    const next = { ...DEFAULT_SETTINGS, theme: 'dark' as const, idleRecycleMs: 900_000 };
    saveSettings(dirs, next);
    expect(loadSettings(dirs)).toEqual(next);
  });

  it('原子写：不残留 .tmp 文件', () => {
    saveSettings(dirs, DEFAULT_SETTINGS);
    expect(fs.existsSync(path.join(tmp, 'settings.json.tmp'))).toBe(false);
  });

  it('重复覆盖保存成功', () => {
    saveSettings(dirs, { ...DEFAULT_SETTINGS, theme: 'light' });
    saveSettings(dirs, { ...DEFAULT_SETTINGS, theme: 'dark' });
    expect(loadSettings(dirs).theme).toBe('dark');
  });
});
