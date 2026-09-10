/**
 * 自动化（U-01..U-06）：
 * - U-01 表单创建 / U-02 自然语言创建（NL → 前端结构化预览 → 走同一 REST，host 不做 NL 解析）
 * - 存储：appData/automations.json（0600）；每条自动化内嵌运行历史 ring ~50 条（U-06）
 * - 调度：30s tick，daily HH:mm / intervalMinutes 到点触发（U-04）
 * - U-05 应用存活才跑：触发时经 injected promptSender 投递；无可用会话记 skipped
 * - 运行历史：ok / error / skipped，诚实记录
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Automation, AutomationRun } from '@pi-agent/shared';
import type { AppDirs } from '../config/paths';

export interface AutomationsRouteDeps {
  dirs: AppDirs;
  logger: { info(msg: string, fields?: Record<string, unknown>): void; warn(msg: string, fields?: Record<string, unknown>): void };
  /**
   * 投递 prompt 到目标项目的活动会话（U-05）。
   * @returns true 表示已投递；false 表示无可用会话（记 skipped）
   */
  promptSender(projectId: string | null, prompt: string): boolean;
}

const HISTORY_LIMIT = 50;

function filePath(dirs: AppDirs): string {
  return path.join(dirs.root, 'automations.json');
}

function readAll(dirs: AppDirs): Automation[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(dirs), 'utf8')) as { automations?: Automation[] };
    return Array.isArray(parsed.automations) ? parsed.automations : [];
  } catch {
    return [];
  }
}

function writeAll(dirs: AppDirs, automations: Automation[]): void {
  for (const a of automations) {
    a.history = a.history.slice(-HISTORY_LIMIT);
  }
  fs.writeFileSync(filePath(dirs), JSON.stringify({ automations }, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
}

/** daily HH:mm 到点判定（tick 粒度 30s，「分钟相等」+ lastFiredKey 防同分钟重复） */
const lastFiredKeys = new Map<string, string>();

/** HH:mm 解析（非法返回 null） */
function parseClock(time: string): { h: number; m: number } | null {
  const [hh, mm] = time.split(':');
  const h = Number(hh);
  const m = Number(mm);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

/** 到点判定（daily / weekly 共用）：分钟相等 + lastFiredKey 防重 */
function clockDue(a: Automation, now: Date, weekday?: number): boolean {
  if (!a.schedule.time) return false;
  const clock = parseClock(a.schedule.time);
  if (!clock) return false;
  const minuteKey = now.toISOString().slice(0, 16);
  if (lastFiredKeys.get(a.id) === minuteKey) return false;
  if (weekday !== undefined && now.getDay() !== weekday) return false;
  return now.getHours() === clock.h && now.getMinutes() === clock.m;
}

function dailyDue(a: Automation, now: Date): boolean {
  if (a.schedule.kind !== 'daily') return false;
  return clockDue(a, now);
}

function weeklyDue(a: Automation, now: Date): boolean {
  // weekday: 0-6（周日=0）
  if (a.schedule.kind !== 'weekly' || a.schedule.weekday === undefined) return false;
  return clockDue(a, now, a.schedule.weekday);
}

/** interval 到期判定：距最近一次运行（含 skipped）≥ intervalMinutes */
function intervalDue(a: Automation, now: Date): boolean {
  if (a.schedule.kind !== 'interval' || !a.schedule.intervalMinutes) return false;
  const iv = Math.max(1, a.schedule.intervalMinutes) * 60_000;
  const lastRunAt = a.history.reduce(
    (acc, h) => Math.max(acc, new Date(h.at).getTime()),
    0,
  );
  if (lastRunAt === 0) return true; // 从未跑过 → 立即跑一次
  return now.getTime() - lastRunAt >= iv;
}

/** once 到期判定：到了且尚未跑过（触发后由 tick 置 disabled） */
function onceDue(a: Automation, now: Date): boolean {
  if (a.schedule.kind !== 'once' || !a.schedule.at) return false;
  if (a.history.length > 0) return false;
  const at = new Date(a.schedule.at).getTime();
  return !Number.isNaN(at) && at <= now.getTime();
}

/**
 * 下次运行时间（U-03 列表展示用）；不可判定（once 已跑 / schedule 非法）返回 null。
 * 纯函数，可单测。
 */
export function nextRunAt(a: Automation, now: Date): Date | null {
  switch (a.schedule.kind) {
    case 'daily': {
      const clock = a.schedule.time ? parseClock(a.schedule.time) : null;
      if (!clock) return null;
      const next = new Date(now);
      next.setHours(clock.h, clock.m, 0, 0);
      if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
      return next;
    }
    case 'weekly': {
      const clock = a.schedule.time ? parseClock(a.schedule.time) : null;
      if (!clock || a.schedule.weekday === undefined) return null;
      const next = new Date(now);
      next.setHours(clock.h, clock.m, 0, 0);
      const delta = (a.schedule.weekday - next.getDay() + 7) % 7;
      if (delta === 0 && next.getTime() <= now.getTime()) next.setDate(next.getDate() + 7);
      else next.setDate(next.getDate() + delta);
      return next;
    }
    case 'interval': {
      const minutes = a.schedule.intervalMinutes;
      if (!minutes || minutes < 1) return null;
      const iv = minutes * 60_000;
      const lastRunAt = a.history.reduce((acc, h) => Math.max(acc, new Date(h.at).getTime()), 0);
      if (lastRunAt === 0) return new Date(now.getTime()); // 从未跑过 → 下次 tick 即触发
      return new Date(lastRunAt + iv);
    }
    case 'once': {
      if (!a.schedule.at || a.history.length > 0) return null;
      const at = new Date(a.schedule.at);
      return Number.isNaN(at.getTime()) ? null : at;
    }
    default:
      return null;
  }
}

export function registerAutomationsRoutes(app: FastifyInstance, deps: AutomationsRouteDeps): void {
  const { dirs, logger } = deps;

  /* ---------- CRUD（U-01） ---------- */

  app.get('/v1/automations', async () => {
    const now = new Date();
    const automations = readAll(dirs).map((a) => {
      // U-03：列表带下次运行时间（不可判定为 undefined）
      const next = nextRunAt(a, now);
      return { ...a, nextRunAt: next ? next.toISOString() : undefined };
    });
    const history = automations
      .flatMap((a) => a.history.map((h) => ({ ...h, automationId: a.id })))
      .sort((x, y) => (x.at < y.at ? 1 : -1))
      .slice(0, 100);
    return { automations, history };
  });

  app.post('/v1/automations', async (req, reply) => {
    const body = req.body as Partial<Automation> | null;
    if (!body || typeof body.title !== 'string' || typeof body.prompt !== 'string' || !body.schedule) {
      void reply.code(400);
      return { error: 'title / prompt / schedule 必填' };
    }
    const automation: Automation = {
      id: `auto-${randomUUID().slice(0, 8)}`,
      title: body.title.trim(),
      prompt: body.prompt,
      projectId: typeof body.projectId === 'string' ? body.projectId : null,
      schedule: body.schedule,
      enabled: body.enabled !== false,
      createdAt: new Date().toISOString(),
      history: [],
    };
    const all = readAll(dirs);
    all.push(automation);
    writeAll(dirs, all);
    logger.info('自动化已创建', { id: automation.id, title: automation.title });
    void reply.code(201);
    return automation;
  });

  app.patch('/v1/automations/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const patch = req.body as Partial<Automation> | null;
    const all = readAll(dirs);
    const target = all.find((a) => a.id === id);
    if (!target) {
      void reply.code(404);
      return { error: '自动化不存在' };
    }
    if (typeof patch?.title === 'string') target.title = patch.title;
    if (typeof patch?.prompt === 'string') target.prompt = patch.prompt;
    if (patch?.schedule) target.schedule = patch.schedule;
    if (typeof patch?.enabled === 'boolean') target.enabled = patch.enabled;
    writeAll(dirs, all);
    return target;
  });

  app.delete('/v1/automations/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const all = readAll(dirs);
    const next = all.filter((a) => a.id !== id);
    if (next.length === all.length) {
      void reply.code(404);
      return { error: '自动化不存在' };
    }
    writeAll(dirs, next);
    return { ok: true };
  });

  /* ---------- 调度 tick（U-04/U-05/U-06） ---------- */

  function tick(): void {
    const now = new Date();
    const all = readAll(dirs);
    let dirty = false;
    for (const a of all) {
      if (!a.enabled) continue;
      const due =
        (a.schedule.kind === 'daily' && dailyDue(a, now)) ||
        (a.schedule.kind === 'weekly' && weeklyDue(a, now)) ||
        (a.schedule.kind === 'interval' && intervalDue(a, now)) ||
        (a.schedule.kind === 'once' && onceDue(a, now));
      if (!due) continue;
      lastFiredKeys.set(a.id, now.toISOString().slice(0, 16));
      const run: AutomationRun = deps.promptSender(a.projectId, a.prompt)
        ? { at: now.toISOString(), result: 'ok' }
        : { at: now.toISOString(), result: 'skipped', detail: '目标项目无活动会话（应用存活才跑，U-05）' };
      a.history.push(run);
      a.lastRunAt = run.at;
      if (a.schedule.kind === 'once') a.enabled = false; // 一次性任务触发后停用
      dirty = true;
      logger.info('自动化触发', { id: a.id, result: run.result });
    }
    if (dirty) writeAll(dirs, all);
  }

  const timer = setInterval(tick, 30_000);
  timer.unref?.();

  // 注册时先跑一次（避免错过启动窗口的 daily 到点）
  tick();
}
