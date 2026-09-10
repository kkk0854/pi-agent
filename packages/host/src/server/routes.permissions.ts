/**
 * 权限治理路由（T03，A-13 / A-10）：
 * - 危险命令清单 CRUD：默认清单（extensions/pi-agent-permissions/dangerous-commands.json）
 *   + 自定义规则（appData/dangerous-custom.json）合并下发；自定义支持增删与项目级覆盖
 * - 审计日志：web 策略引擎产出决策 → POST /v1/audit 落 audit.jsonl（redact 脱敏）；
 *   GET /v1/audit 供设置页展示与导出
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  DEFAULT_DANGEROUS_PATTERNS,
  redact,
  type AuditEntry,
  type DangerousPattern,
} from '@pi-agent/shared';
import type { AppDirs } from '../config/paths';

export interface PermissionsRouteDeps {
  dirs: AppDirs;
  logger: { info(msg: string, fields?: Record<string, unknown>): void; warn(msg: string, fields?: Record<string, unknown>): void };
}

/** 自定义危险规则存储（appData/dangerous-custom.json） */
function customFilePath(dirs: AppDirs): string {
  return path.join(dirs.root, 'dangerous-custom.json');
}

function readCustomPatterns(dirs: AppDirs): DangerousPattern[] {
  try {
    const raw = fs.readFileSync(customFilePath(dirs), 'utf8');
    const parsed = JSON.parse(raw) as { patterns?: DangerousPattern[] };
    return Array.isArray(parsed.patterns) ? parsed.patterns : [];
  } catch {
    return [];
  }
}

function writeCustomPatterns(dirs: AppDirs, patterns: DangerousPattern[]): void {
  fs.writeFileSync(customFilePath(dirs), JSON.stringify({ patterns }, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
}

/** 审计文件路径（appData/audit.jsonl，A-10） */
export function auditFilePath(dirs: AppDirs): string {
  return path.join(dirs.root, 'audit.jsonl');
}

export function registerPermissionsRoutes(
  app: FastifyInstance,
  deps: PermissionsRouteDeps,
): void {
  const { dirs, logger } = deps;

  /* ---------- 危险清单（A-13：数据文件而非硬编码） ---------- */

  // 合并清单：默认 + 自定义（同 id 时自定义覆盖默认）
  app.get('/v1/permissions/dangerous', async () => {
    const custom = readCustomPatterns(dirs);
    const byId = new Map<string, DangerousPattern>();
    for (const p of DEFAULT_DANGEROUS_PATTERNS) byId.set(p.id, p);
    for (const p of custom) byId.set(p.id, p);
    return { patterns: [...byId.values()] };
  });

  app.post('/v1/permissions/dangerous', async (req, reply) => {
    const body = req.body as { category?: string; pattern?: string; description?: string } | null;
    if (!body || typeof body.pattern !== 'string' || body.pattern.trim().length === 0) {
      void reply.code(400);
      return { error: 'pattern 必填（正则来源字符串）' };
    }
    // 正则合法性校验（前端匹配时才暴露错误会太晚）
    try {
      new RegExp(body.pattern);
    } catch (err) {
      void reply.code(400);
      return { error: `pattern 不是合法正则：${err instanceof Error ? err.message : String(err)}` };
    }
    const pattern: DangerousPattern = {
      id: `custom-${randomUUID().slice(0, 8)}`,
      category: body.category?.trim() || '自定义',
      pattern: body.pattern,
      description: body.description?.trim() || '自定义危险规则',
    };
    const custom = readCustomPatterns(dirs);
    custom.push(pattern);
    writeCustomPatterns(dirs, custom);
    logger.info('自定义危险规则已添加', { id: pattern.id });
    return pattern;
  });

  app.delete('/v1/permissions/dangerous/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const custom = readCustomPatterns(dirs);
    const next = custom.filter((p) => p.id !== id);
    if (next.length === custom.length) {
      void reply.code(404);
      return { error: '规则不存在（默认清单条目不可删除，可在项目级覆盖）' };
    }
    writeCustomPatterns(dirs, next);
    return { ok: true };
  });

  /* ---------- 审计日志（A-10） ---------- */

  app.post('/v1/audit', async (req, reply) => {
    const body = req.body as Partial<AuditEntry> | null;
    if (!body || typeof body.toolName !== 'string' || typeof body.sessionId !== 'string') {
      void reply.code(400);
      return { error: 'sessionId 与 toolName 必填' };
    }
    const entry: AuditEntry = {
      at: new Date().toISOString(),
      sessionId: body.sessionId,
      toolName: body.toolName,
      argsSummary: redact(typeof body.argsSummary === 'string' ? body.argsSummary : ''),
      tier: typeof body.tier === 'string' ? body.tier : 'unknown',
      result: typeof body.result === 'string' ? body.result : 'unknown',
      matchedPatternId: typeof body.matchedPatternId === 'string' ? body.matchedPatternId : null,
      risk: body.risk === 'block' || body.risk === 'risky' ? body.risk : 'normal',
    };
    fs.appendFileSync(auditFilePath(dirs), `${JSON.stringify(entry)}\n`, 'utf8');
    void reply.code(201);
    return { ok: true };
  });

  app.get('/v1/audit', async (req) => {
    const qs = req.query as { limit?: string };
    const limit = Math.min(Number(qs.limit ?? 500) || 500, 5000);
    let entries: AuditEntry[] = [];
    try {
      const raw = fs.readFileSync(auditFilePath(dirs), 'utf8');
      entries = raw
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .slice(-limit)
        .map((l) => JSON.parse(l) as AuditEntry);
    } catch {
      entries = [];
    }
    // 新→旧展示
    return { entries: entries.reverse(), total: entries.length };
  });
}
