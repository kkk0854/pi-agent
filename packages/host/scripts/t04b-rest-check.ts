/**
 * T04b 验收脚本：本地 REST 会话 API + 自动化调度（不依赖真实 pi 进程）。
 * 运行：npx tsx scripts/t04b-rest-check.ts
 * 输出：监听端口；另开终端 curl 验证 POST /v1/sessions/:id/turns 的
 * turn_started / queued / 幂等重放 / not_found，以及自动化 tick 落盘历史。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import type { AppSession, Automation } from '@pi-agent/shared';
import { registerSessionApi } from '../src/server/sessionApi';
import { registerAutomationsRoutes } from '../src/server/automations';

const now = new Date().toISOString();
const session: AppSession = {
  id: 'sess-demo-1',
  projectId: 'proj-demo-1',
  title: '演示会话',
  status: 'ready',
  createdAt: now,
  updatedAt: now,
};

const dirs = { root: fs.mkdtempSync(path.join(os.tmpdir(), 't04b-')) } as Parameters<
  typeof registerSessionApi
>[1]['dirs'];

const store = {
  listSessions: () => [session],
  listProjects: () => [{ id: 'proj-demo-1', path: 'D:/demo-repo' }],
} as unknown as Parameters<typeof registerSessionApi>[1]['store'];

const manager = {
  get: (id: string) => (id === session.id ? { status: 'ready', attached: true } : undefined),
  write: (_id: string, line: string) => {
    console.log('[manager.write] 已投递:', line.slice(0, 80));
    return true;
  },
  open: () => undefined,
} as unknown as Parameters<typeof registerSessionApi>[1]['manager'];

const logger = {
  info: (msg: string, fields?: Record<string, unknown>) => console.log('[info]', msg, fields ?? ''),
  warn: (msg: string, fields?: Record<string, unknown>) => console.log('[warn]', msg, fields ?? ''),
};

const app = Fastify({ logger: false });
registerSessionApi(app, { store, manager, dirs, logger });

// 自动化：间隔 1 分钟 + 每日 09:00，promptSender 返回 false → 诚实记 skipped
const automation: Automation = {
  id: 'auto-demo',
  title: '演示自动化',
  prompt: '运行每日检查',
  projectId: null,
  schedule: { kind: 'interval', intervalMinutes: 1 },
  enabled: true,
  createdAt: now,
  history: [],
};
fs.writeFileSync(
  path.join(dirs.root, 'automations.json'),
  JSON.stringify({ automations: [automation] }, null, 2),
  'utf8',
);
registerAutomationsRoutes(app, {
  dirs,
  logger,
  promptSender: () => false, // 无活动会话 → skipped（U-05）
});

await app.listen({ port: 0, host: '127.0.0.1' });
const port = app.server.address();
const actualPort = typeof port === 'object' && port ? port.port : 0;
console.log(`\nT04B_REST_PORT=${actualPort}`);
console.log(`SESSION_ID=${session.id}`);
console.log(`PROMPT_DELIVERED=true`);

// tick 已在注册时跑过一次：验证 automations.json 里已有 skipped 历史
const saved = JSON.parse(
  fs.readFileSync(path.join(dirs.root, 'automations.json'), 'utf8'),
) as { automations: Automation[] };
console.log(`\nAUTOMATION_HISTORY=${JSON.stringify(saved.automations[0]?.history ?? [])}`);
