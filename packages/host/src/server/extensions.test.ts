/**
 * 扩展 spawn 参数单测（T05 遗留收口）：spawnExtensionArgs 按启用态过滤 builtin/user。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { spawnExtensionArgs } from './extensions';
import type { AppDirs } from '../config/paths';

const tmpDirs: string[] = [];

function makeTmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeExtDir(parent: string, name: string, displayName: string): string {
  const full = path.join(parent, name);
  fs.mkdirSync(full, { recursive: true });
  fs.writeFileSync(
    path.join(full, 'package.json'),
    JSON.stringify({ name: displayName, description: `${displayName} 扩展` }),
    'utf8',
  );
  return full;
}

function makeDirs(builtinRoot: string, userRoot: string): AppDirs {
  return {
    root: builtinRoot,
    logs: path.join(builtinRoot, 'logs'),
    sessions: path.join(builtinRoot, 'sessions'),
    extensions: userRoot,
  };
}

describe('spawnExtensionArgs', () => {
  it('默认全部启用：builtin + user 都进 --extension', () => {
    const root = makeTmp();
    const builtin = makeExtDir(root, 'pi-agent-permissions', 'pi-agent-permissions');
    const userRoot = makeTmp();
    const userExt = makeExtDir(userRoot, 'my-ext', 'my-ext');
    const dirs = makeDirs(root, userRoot);

    const args = spawnExtensionArgs(dirs, [root]);
    expect(args).toEqual(['--extension', builtin, '--extension', userExt]);
  });

  it('停用的扩展不进 argv（builtin 或 user 同规则）', () => {
    const root = makeTmp();
    makeExtDir(root, 'pi-agent-permissions', 'pi-agent-permissions');
    const userRoot = makeTmp();
    makeExtDir(userRoot, 'my-ext', 'my-ext');
    const dirs = makeDirs(root, userRoot);
    fs.writeFileSync(
      path.join(dirs.root, 'extensions.json'),
      JSON.stringify({ 'builtin:pi-agent-permissions': false, 'user:my-ext': false }),
      'utf8',
    );

    expect(spawnExtensionArgs(dirs, [root])).toEqual([]);
  });

  it('无 package.json 的目录不算扩展；扩展目录缺失不抛错', () => {
    const root = makeTmp();
    fs.mkdirSync(path.join(root, 'broken-ext'), { recursive: true });
    const dirs = makeDirs(root, path.join(root, 'not-exists'));
    expect(spawnExtensionArgs(dirs, [root])).toEqual([]);
  });
});
