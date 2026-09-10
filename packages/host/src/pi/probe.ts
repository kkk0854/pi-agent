/**
 * pi CLI 探测（R-04 / R-06）：
 * 1. 设置中手动指定的路径优先
 * 2. PATH 上的 `pi --version`（npm shim，需 shell）
 * 3. 常见安装目录的 pi.cmd / pi
 * 命中后尝试解析真实 JS 入口（node_modules/@earendil-works/pi-coding-agent），
 * 供 spawn 走「node 入口」模式 —— argv 完全直传，不经 shell（R-07）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { compareVersions, PI_SUPPORTED_VERSION } from '@pi-agent/shared';

/** 供 spawn 使用的真实入口（node + 脚本路径） */
export interface PiEntry {
  nodePath: string;
  scriptPath: string;
}

export interface PiProbe {
  found: boolean;
  version?: string;
  /** pi 可执行（pi.cmd / pi）路径 */
  path?: string;
  entry?: PiEntry;
  /** 基线比对结论（0.85.0） */
  meetsBaseline: boolean;
  message: string;
}

const PKG = '@earendil-works/pi-coding-agent';

/** 运行 `<cmd> --version`，返回 stdout 首个语义版本，失败返回 null */
function runVersion(cmd: string, timeoutMs = 8000): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string | null): void => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, ['--version'], { shell: true, windowsHide: true });
    } catch {
      finish(null);
      return;
    }
    let out = '';
    child.stdout?.on('data', (d: Buffer) => {
      out += d.toString('utf8');
    });
    child.on('error', () => finish(null));
    child.on('close', () => {
      const m = out.match(/(\d+\.\d+\.\d+(?:[-+][\w.]*)?)/);
      finish(m ? m[1]! : null);
    });
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* 忽略 */
      }
      finish(null);
    }, timeoutMs);
    child.on('close', () => clearTimeout(timer));
  });
}

/** 在 npm 全局目录里解析包的真实 JS 入口 */
function resolveEntry(npmDir: string): PiEntry | undefined {
  try {
    const pkgJsonPath = path.join(npmDir, 'node_modules', ...PKG.split('/'), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as { bin?: Record<string, string> | string };
    const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['pi'];
    if (!binRel) return undefined;
    return { nodePath: process.execPath, scriptPath: path.join(path.dirname(pkgJsonPath), binRel) };
  } catch {
    return undefined;
  }
}

/** 常见安装目录（平台相关） */
function commonCandidates(): string[] {
  const list: string[] = [];
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'] ?? path.join(os.homedir(), 'AppData', 'Roaming');
    list.push(path.join(appData, 'npm', 'pi.cmd'));
  } else {
    list.push('/usr/local/bin/pi', '/usr/bin/pi', path.join(os.homedir(), '.local', 'bin', 'pi'));
  }
  return list;
}

export async function probePi(piPath?: string): Promise<PiProbe> {
  const tried: { cmd: string; version: string | null }[] = [];

  const candidates: { cmd: string; dir?: string }[] = [];
  if (piPath && piPath.length > 0) candidates.push({ cmd: piPath });
  candidates.push({ cmd: 'pi' });
  for (const c of commonCandidates()) {
    if (fs.existsSync(c)) candidates.push({ cmd: c, dir: path.dirname(c) });
  }

  for (const cand of candidates) {
    const version = await runVersion(cand.cmd);
    tried.push({ cmd: cand.cmd, version });
    if (version) {
      const dir = cand.dir ?? path.dirname(cand.cmd);
      const entry = resolveEntry(dir);
      const meetsBaseline = compareVersions(version, PI_SUPPORTED_VERSION) >= 0;
      return {
        found: true,
        version,
        path: cand.cmd,
        entry,
        meetsBaseline,
        message: meetsBaseline
          ? `已找到 pi ${version}（${cand.cmd}）`
          : `pi ${version} 低于基线 ${PI_SUPPORTED_VERSION}，部分能力将降级`,
      };
    }
  }

  return {
    found: false,
    meetsBaseline: false,
    message: '未找到 pi。安装：npm i -g @earendil-works/pi-coding-agent，或在设置中手动指定路径。',
  };
}
