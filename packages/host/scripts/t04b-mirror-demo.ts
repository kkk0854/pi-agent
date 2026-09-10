/**
 * T04b 验收脚本：手机镜像页演示服务（不依赖真实 pi 进程）。
 * 运行：npx tsx scripts/t04b-mirror-demo.ts
 * 输出镜像访问 URL（含镜像令牌），供浏览器以移动端视口截图 docs/screenshots/t04b-mirror-*。
 */
import Fastify from 'fastify';
import { newId } from '@pi-agent/shared';
import { createMirror } from '../src/server/mirror';

const dirs = { root: process.cwd() } as Parameters<typeof createMirror>[0]['dirs'];
const logger = {
  info: (msg: string, fields?: Record<string, unknown>) => console.log('[info]', msg, fields ?? ''),
  warn: (msg: string, fields?: Record<string, unknown>) => console.log('[warn]', msg, fields ?? ''),
};

const mirror = createMirror({
  dirs,
  logger,
  sessions: () => [
    { id: 'sess-demo-1', title: '重构登录模块', projectId: 'proj-1', status: 'running', updatedAt: new Date().toISOString() },
  ],
  promptSender: () => false,
});

// 预置一段会话原始行（pi JSONL 结构，镜像页只解析文本增量）
const mid = newId();
const uid = newId();
mirror.ingestFrame({
  ch: 'sess-demo-1',
  type: 'session.lines',
  payload: {
    lines: [
      JSON.stringify({ type: 'message_start', message: { id: uid, role: 'user', textContent: '把登录模块里的回调改成 async/await' } }),
      JSON.stringify({ type: 'message_update', message: { id: mid, role: 'assistant' }, assistantMessageEvent: { type: 'text_delta', delta: '好的，我先通读 src/login 的现有实现，找出所有回调嵌套点。' } }),
      JSON.stringify({ type: 'message_update', message: { id: mid, role: 'assistant' }, assistantMessageEvent: { type: 'text_delta', delta: '然后逐个改为 await 写法，并保持错误处理语义不变。' } }),
    ],
  },
});

const app = Fastify({ logger: false });
mirror.registerRoutes(app);
await app.listen({ port: 61099, host: '127.0.0.1' });
mirror.setPort(61099);
mirror.attachWs(app.server);

const info = await app.inject({ method: 'GET', url: '/v1/mirror/info' });
const body = info.json() as { localUrl: string; lanUrl: string | null };
console.log(`MIRROR_URL=${body.localUrl}`);
console.log(`MIRROR_LAN=${body.lanUrl ?? '(无局域网地址)'}`);
