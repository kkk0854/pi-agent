/**
 * appData 目录定位（架构 §8.10）：
 * - Windows：%APPDATA%/pi-agent
 * - macOS：~/Library/Application Support/pi-agent
 * - Linux：$XDG_DATA_HOME/pi-agent（默认 ~/.local/share/pi-agent）
 * 可用 PI_AGENT_DATA_DIR 覆盖（测试 / 便携模式）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import type { HostEndpoint } from '@pi-agent/shared';

export interface AppDirs {
  root: string;
  logs: string;
  sessions: string;
  extensions: string;
}

function baseDir(override?: string): string {
  if (override && override.length > 0) return override;
  const envDir = process.env['PI_AGENT_DATA_DIR'];
  if (envDir && envDir.length > 0) return envDir;
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'] ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'pi-agent');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'pi-agent');
  }
  const xdg = process.env['XDG_DATA_HOME'] ?? path.join(os.homedir(), '.local', 'share');
  return path.join(xdg, 'pi-agent');
}

/** 解析并创建（递归）全部数据目录 */
export function resolveAppDirs(override?: string): AppDirs {
  const root = baseDir(override);
  const dirs: AppDirs = {
    root,
    logs: path.join(root, 'logs'),
    sessions: path.join(root, 'sessions'),
    extensions: path.join(root, 'extensions'),
  };
  for (const dir of [dirs.root, dirs.logs, dirs.sessions, dirs.extensions]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dirs;
}

/** host.json 路径（令牌端点文件，0600） */
export function hostJsonPath(dirs: AppDirs): string {
  return path.join(dirs.root, 'host.json');
}

/** 写入 host.json（0600；Windows 上 mode 尽力而为） */
export function writeHostInfo(dirs: AppDirs, info: HostEndpoint): void {
  fs.writeFileSync(hostJsonPath(dirs), JSON.stringify(info, null, 2), { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(hostJsonPath(dirs), 0o600);
  } catch {
    // Windows 上 chmod 语义有限，忽略失败
  }
}

/** 读取 host.json（损坏 / 缺失返回 null） */
export function readHostInfo(dirs: AppDirs): HostEndpoint | null {
  try {
    const raw = fs.readFileSync(hostJsonPath(dirs), 'utf8');
    const parsed = JSON.parse(raw) as Partial<HostEndpoint>;
    if (
      typeof parsed.httpUrl === 'string' &&
      typeof parsed.wsUrl === 'string' &&
      typeof parsed.token === 'string' &&
      typeof parsed.pid === 'number'
    ) {
      return parsed as HostEndpoint;
    }
    return null;
  } catch {
    return null;
  }
}

/** 退出时移除 host.json（避免残留指向已死进程的端点） */
export function removeHostInfo(dirs: AppDirs): void {
  try {
    fs.unlinkSync(hostJsonPath(dirs));
  } catch {
    // 文件不存在等情况忽略
  }
}
