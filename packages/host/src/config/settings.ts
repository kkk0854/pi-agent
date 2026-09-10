/**
 * 设置读写：zod 校验 + 默认值合并（架构 §2.3）。
 * 设置存 {appData}/pi-agent/settings.json。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, SettingsSchema, type Settings } from '@pi-agent/shared';
import type { AppDirs } from './paths';
import type { Logger } from '../log/logger';

function settingsPath(dirs: AppDirs): string {
  return path.join(dirs.root, 'settings.json');
}

/** 读取设置：缺失/损坏时回退默认值并告警（不抛错，保证可启动） */
export function loadSettings(dirs: AppDirs, logger?: Logger): Settings {
  try {
    const raw = fs.readFileSync(settingsPath(dirs), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const result = SettingsSchema.safeParse(parsed);
    if (result.success) return result.data;
    logger?.warn('settings.json 校验失败，已回退默认值', {
      issues: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
    return { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** 保存设置（原子写：先写临时文件再替换） */
export function saveSettings(dirs: AppDirs, settings: Settings): void {
  const target = settingsPath(dirs);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
  fs.renameSync(tmp, target);
}
