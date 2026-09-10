import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readHostInfo, removeHostInfo, resolveAppDirs, writeHostInfo, type AppDirs } from './paths';

let tmp: string;
let dirs: AppDirs;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-agent-paths-'));
  dirs = resolveAppDirs(tmp);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('resolveAppDirs', () => {
  it('显式 override 时返回该根目录', () => {
    expect(dirs.root).toBe(tmp);
    expect(dirs.logs).toBe(path.join(tmp, 'logs'));
    expect(dirs.sessions).toBe(path.join(tmp, 'sessions'));
    expect(dirs.extensions).toBe(path.join(tmp, 'extensions'));
  });

  it('递归创建全部数据目录', () => {
    for (const dir of [dirs.root, dirs.logs, dirs.sessions, dirs.extensions]) {
      expect(fs.statSync(dir).isDirectory()).toBe(true);
    }
  });

  it('重复调用幂等（目录已存在不报错）', () => {
    expect(() => resolveAppDirs(tmp)).not.toThrow();
  });

  it('override 为空串时回退 env/平台默认路径逻辑', () => {
    // 空 override 不应落到空路径：直接验证不抛错且 root 非空
    const fallback = resolveAppDirs('');
    expect(fallback.root.length).toBeGreaterThan(0);
    // 清理可能创建的默认目录不做断言（平台相关），仅验证逻辑可用
  });
});

describe('host.json 读写', () => {
  const endpoint = {
    httpUrl: 'http://127.0.0.1:5178',
    wsUrl: 'ws://127.0.0.1:5178',
    token: 'tok-123',
    pid: 4321,
  };

  it('write → read round-trip', () => {
    writeHostInfo(dirs, endpoint);
    expect(readHostInfo(dirs)).toEqual(endpoint);
  });

  it('host.json 位于 root 下', () => {
    writeHostInfo(dirs, endpoint);
    expect(fs.existsSync(path.join(dirs.root, 'host.json'))).toBe(true);
  });

  it('字段缺失时 readHostInfo 返回 null', () => {
    writeHostInfo(dirs, endpoint);
    // 手动写入缺字段的文件
    fs.writeFileSync(
      path.join(dirs.root, 'host.json'),
      JSON.stringify({ httpUrl: 'http://x' }),
      'utf8',
    );
    expect(readHostInfo(dirs)).toBeNull();
  });

  it('字段类型不符时返回 null', () => {
    fs.writeFileSync(
      path.join(dirs.root, 'host.json'),
      JSON.stringify({ httpUrl: 1, wsUrl: 'ws://x', token: 't', pid: 'not-number' }),
      'utf8',
    );
    expect(readHostInfo(dirs)).toBeNull();
  });

  it('文件损坏（非 JSON）返回 null 而不抛错', () => {
    fs.writeFileSync(path.join(dirs.root, 'host.json'), '{broken', 'utf8');
    expect(readHostInfo(dirs)).toBeNull();
  });

  it('文件缺失返回 null', () => {
    expect(readHostInfo(dirs)).toBeNull();
  });

  it('removeHostInfo 删除文件；不存在时幂等', () => {
    writeHostInfo(dirs, endpoint);
    removeHostInfo(dirs);
    expect(readHostInfo(dirs)).toBeNull();
    expect(() => removeHostInfo(dirs)).not.toThrow();
  });
});
