/**
 * 用量统计：web 端从 get_session_stats 拿到快照后上报（Q-04），
 * host 追加 usage.jsonl 并按 会话/项目/日 三维分桶汇总。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { UsageDayHour, UsageGroup, UsageRecord, UsageSummary } from '@pi-agent/shared';
import type { AppDirs } from '../config/paths';

export interface UsageRouteDeps {
  dirs: AppDirs;
}

function usageFilePath(dirs: AppDirs): string {
  return path.join(dirs.root, 'usage.jsonl');
}

function readRecords(dirs: AppDirs): UsageRecord[] {
  try {
    return fs
      .readFileSync(usageFilePath(dirs), 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as UsageRecord);
  } catch {
    return [];
  }
}

function bucketize(records: UsageRecord[], keyFn: (r: UsageRecord) => string): UsageGroup[] {
  const map = new Map<string, UsageGroup>();
  for (const r of records) {
    const key = keyFn(r);
    const b = map.get(key) ?? { key, totalTokens: 0, cost: 0, turns: 0 };
    b.totalTokens += r.tokens?.total ?? 0;
    b.cost += r.cost ?? 0;
    b.turns += 1;
    map.set(key, b);
  }
  return [...map.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}

/** 日 × 时段分桶（Q-05 热力图数据源） */
function bucketizeDayHour(records: UsageRecord[]): UsageDayHour[] {
  const map = new Map<string, UsageDayHour>();
  for (const r of records) {
    const day = r.at.slice(0, 10);
    const hour = new Date(r.at).getHours();
    const key = `${day}|${hour}`;
    const b = map.get(key) ?? { day, hour, totalTokens: 0, cost: 0, turns: 0 };
    b.totalTokens += r.tokens?.total ?? 0;
    b.cost += r.cost ?? 0;
    b.turns += 1;
    map.set(key, b);
  }
  return [...map.values()].sort((a, b) =>
    a.day === b.day ? a.hour - b.hour : a.day < b.day ? -1 : 1,
  );
}

export function registerUsageRoutes(app: FastifyInstance, deps: UsageRouteDeps): void {
  const { dirs } = deps;

  app.post('/v1/usage', async (req, reply) => {
    const body = req.body as Partial<UsageRecord> | null;
    if (!body || typeof body.sessionId !== 'string' || !body.tokens) {
      void reply.code(400);
      return { error: 'sessionId 与 tokens 必填' };
    }
    const record: UsageRecord = {
      sessionId: body.sessionId,
      projectId: typeof body.projectId === 'string' ? body.projectId : null,
      at: new Date().toISOString(),
      tokens: {
        input: Number(body.tokens.input ?? 0),
        output: Number(body.tokens.output ?? 0),
        cacheRead: Number(body.tokens.cacheRead ?? 0),
        cacheWrite: Number(body.tokens.cacheWrite ?? 0),
        total: Number(body.tokens.total ?? 0),
      },
      cost: Number(body.cost ?? 0),
    };
    fs.appendFileSync(usageFilePath(dirs), `${JSON.stringify(record)}\n`, 'utf8');
    void reply.code(201);
    return { ok: true };
  });

  app.get('/v1/usage/summary', async (): Promise<UsageSummary> => {
    const records = readRecords(dirs);
    return {
      bySession: bucketize(records, (r) => r.sessionId),
      byProject: bucketize(records, (r) => r.projectId ?? '(默认工作区)'),
      byDay: bucketize(records, (r) => r.at.slice(0, 10)),
      byDayHour: bucketizeDayHour(records),
    };
  });
}
