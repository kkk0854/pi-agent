/**
 * 自动化 fence 剥离（U-02）：agent 回复中的结构化 fence 转为自动化草稿。
 * 约定 fence 语言标记 `pi-automation`（兼容 ```json 里含 title+prompt+schedule 的兜底），
 * 用户在气泡中不应看到配置 JSON —— UI 侧剥离后走同一 REST 落库。
 * 纯函数，可单测。
 */
import type { Automation } from '@pi-agent/shared';

export interface ParsedAutomationDraft {
  title: string;
  prompt: string;
  projectId: string | null;
  schedule: Automation['schedule'];
  model?: { provider: string; modelId: string };
  thinking?: string;
}

/** 提取首个 ```pi-automation ...``` fence 内容；无则 null */
export function extractAutomationFence(text: string): string | null {
  const re = /```[ \t]*pi-automation[ \t]*\r?\n([\s\S]*?)```/i;
  const m = text.match(re);
  return m?.[1]?.trim() ?? null;
}

/** 判定文本是否包含自动化 fence（UI 呈现「转为自动化」入口的依据） */
export function hasAutomationFence(text: string): boolean {
  return extractAutomationFence(text) !== null;
}

/** 校验 schedule 形状（宽松：kind 必填合法，字段按 kind 检查） */
function validSchedule(raw: unknown): Automation['schedule'] | null {
  if (raw === null || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  switch (s['kind']) {
    case 'daily':
      return typeof s['time'] === 'string' && /^\d{1,2}:\d{2}$/.test(s['time'])
        ? { kind: 'daily', time: s['time'] }
        : null;
    case 'weekly':
      return typeof s['weekday'] === 'number' &&
        Number.isInteger(s['weekday']) &&
        s['weekday'] >= 0 &&
        s['weekday'] <= 6 &&
        typeof s['time'] === 'string'
        ? { kind: 'weekly', weekday: s['weekday'], time: s['time'] }
        : null;
    case 'interval':
      return typeof s['intervalMinutes'] === 'number' && s['intervalMinutes'] >= 1
        ? { kind: 'interval', intervalMinutes: Math.floor(s['intervalMinutes']) }
        : null;
    case 'once':
      return typeof s['at'] === 'string' && !Number.isNaN(Date.parse(s['at']))
        ? { kind: 'once', at: s['at'] }
        : null;
    default:
      return null;
  }
}

/**
 * 从 agent 回复文本解析自动化草稿。
 * 优先 `pi-automation` fence；兜底 ```json fence 且内容含 title+prompt+schedule。
 * 解析失败返回 null（UI 保持原文，不虚构）。
 */
export function parseAutomationFence(text: string): ParsedAutomationDraft | null {
  const raw =
    extractAutomationFence(text) ??
    (() => {
      const m = text.match(/```[ \t]*json[ \t]*\r?\n([\s\S]*?)```/i);
      return m?.[1]?.trim() ?? null;
    })();
  if (!raw) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (obj === null || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (typeof o['title'] !== 'string' || typeof o['prompt'] !== 'string') return null;
  const schedule = validSchedule(o['schedule']);
  if (!schedule) return null;
  const model =
    o['model'] !== null && typeof o['model'] === 'object'
      ? (() => {
          const m = o['model'] as Record<string, unknown>;
          return typeof m['provider'] === 'string' && typeof m['modelId'] === 'string'
            ? { provider: m['provider'], modelId: m['modelId'] }
            : undefined;
        })()
      : undefined;
  return {
    title: o['title'].trim(),
    prompt: o['prompt'],
    projectId: typeof o['projectId'] === 'string' ? o['projectId'] : null,
    schedule,
    ...(model ? { model } : {}),
    ...(typeof o['thinking'] === 'string' ? { thinking: o['thinking'] } : {}),
  };
}

/** 从文本中移除自动化 fence（气泡展示用：用户不可见配置块；U-02） */
export function stripAutomationFence(text: string): string {
  return text
    .replace(/```[ \t]*pi-automation[ \t]*\r?\n[\s\S]*?```/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
