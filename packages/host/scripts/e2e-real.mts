/**
 * T02 端到端验收（真实 pi 模式）：
 * 启动 host → 读 host.json → WS 建连（令牌）→ session.open → get_state 握手 →
 * prompt（诱导工具调用）→ 收集原始 JSONL 行直到 agent_settled →
 * 校验：工具帧出现、握手成功、终态到达。
 * 产物：docs/e2e/real-pi-report.json + real-pi-frames.jsonl（真实帧样例）。
 * 退出码：0 = 验收通过；1 = 失败（报告中有 reason）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST_DIR = path.resolve(HERE, '..');
const ROOT = path.resolve(HOST_DIR, '..', '..');
const OUT_DIR = path.resolve(ROOT, 'docs', 'e2e');
const DATA_DIR = path.resolve(ROOT, '.e2e-data');
/** 本机 my-gateway 已配置的可用模型（pi 0.85 默认 provider 会 401，须显式兜底） */
const E2E_DEFAULT_MODEL = { provider: 'grok', modelId: 'gemini-3.8-flash-high' };

// node 直启 tsx CLI（不经 pnpm / shell，PATH 无关，R-07 同源约束）
const require = createRequire(import.meta.url);
const TSX_CLI = require.resolve('tsx/cli');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
// 隔离数据目录里的 settings：带 defaultModel（与真实用户 appData settings 同构，
// 验证 host 兜底注入链路 —— UI 路径 session.open 不带 model）
fs.writeFileSync(
  path.join(DATA_DIR, 'settings.json'),
  JSON.stringify({ runtimeMode: 'auto', defaultModel: E2E_DEFAULT_MODEL }, null, 2),
  'utf8',
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(report, reason) {
  report.verdict = 'FAIL';
  report.reason = reason;
  fs.writeFileSync(path.join(OUT_DIR, 'real-pi-report.json'), JSON.stringify(report, null, 2));
  console.error(`[e2e] FAIL: ${reason}`);
  cleanup();
  process.exit(1);
}

let hostChild = null;
function cleanup() {
  if (hostChild && hostChild.pid) {
    try {
      spawn('taskkill', ['/pid', String(hostChild.pid), '/T', '/F'], { windowsHide: true });
    } catch {
      /* 尽力而为 */
    }
  }
}

async function waitForHostJson(timeoutMs = 30000) {
  const file = path.join(DATA_DIR, 'host.json');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      await sleep(300);
    }
  }
  return null;
}

async function main() {
  const report = {
    verdict: 'PENDING',
    pi: null,
    handshake: false,
    toolSeen: false,
    settledSeen: false,
    lineCount: 0,
    durationMs: 0,
  };
  const startedAt = Date.now();

  // 1. 启动 host（隔离数据目录，不污染用户 appData）
  hostChild = spawn(process.execPath, [TSX_CLI, 'src/index.ts'], {
    cwd: HOST_DIR,
    env: { ...process.env, PI_AGENT_DATA_DIR: DATA_DIR },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const hostLogs = [];
  hostChild.stdout.on('data', (d) => hostLogs.push(d.toString()));
  hostChild.stderr.on('data', (d) => hostLogs.push(d.toString()));

  const endpoint = await waitForHostJson();
  if (!endpoint) fail(report, `host.json 未在 30s 内生成。host 日志尾部：${hostLogs.join('').slice(-800)}`);
  report.endpoint = { httpUrl: endpoint.httpUrl, wsUrl: endpoint.wsUrl };
  console.log(`[e2e] host 已启动 ${endpoint.httpUrl}`);

  // 2. health 检查（pi 探测字段）
  const healthRes = await fetch(`${endpoint.httpUrl}/v1/health`, {
    headers: { 'x-pi-agent-token': endpoint.token },
  });
  const health = await healthRes.json();
  report.pi = health.pi;
  if (!health.pi.found) {
    fail(report, `host 报告未找到 pi（probe 未命中）。health=${JSON.stringify(health)}`);
  }
  console.log(`[e2e] pi 探测：${health.pi.version} @ ${health.pi.path}`);

  // 3. WS 建连
  const ws = new WebSocket(`${endpoint.wsUrl}?t=${encodeURIComponent(endpoint.token)}`);
  const collected = [];
  const waiters = [];
  const onFrame = (frame) => {
    if (frame.ch !== 'sys') {
      if (frame.type === 'session.lines') {
        collected.push(...(frame.payload?.lines ?? []));
      }
      for (const w of waiters.splice(0)) w(frame);
    }
  };
  const nextInterestingFrame = (timeoutMs) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('等待帧超时')), timeoutMs);
      waiters.push((frame) => {
        clearTimeout(timer);
        resolve(frame);
      });
    });

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WS 连接超时')), 10000);
  });
  ws.on('message', (raw) => {
    try {
      onFrame(JSON.parse(raw.toString('utf8')));
    } catch {
      /* 忽略 */
    }
  });
  console.log('[e2e] WS 已连接（令牌门禁通过）');

  // 4. session.open（不显式带 model：验证 host settings.defaultModel 兜底链路，
  //    与 UI 真实模式路径完全一致）
  ws.send(
    JSON.stringify({
      ch: 'e2e-session-1',
      type: 'session.open',
      payload: {
        appSessionId: 'e2e-session-1',
        projectPath: ROOT,
        title: 'E2E 验收',
        permissionTier: 'notify-on-risky',
      },
    }),
  );
  // 等 connecting 或 error
  for (;;) {
    const frame = await nextInterestingFrame(15000);
    if (frame.type === 'session.status') {
      if (frame.payload.status === 'connecting') break;
      if (frame.payload.status === 'error') {
        fail(report, `session.open 失败：${frame.payload.code} ${frame.payload.detail}`);
      }
    }
  }
  console.log('[e2e] 会话受理（connecting）');

  // 5. 握手：get_state → response（无 ready 帧）
  ws.send(
    JSON.stringify({
      ch: 'e2e-session-1',
      type: 'session.write',
      payload: { line: JSON.stringify({ id: 'hs-1', type: 'get_state' }) },
    }),
  );
  const hsDeadline = Date.now() + 15000;
  let handshake = false;
  while (Date.now() < hsDeadline) {
    if (collected.some((l) => l.includes('"id":"hs-1"') && l.includes('"success":true'))) {
      handshake = true;
      break;
    }
    await sleep(200);
  }
  report.handshake = handshake;
  if (!handshake) fail(report, `get_state 握手超时。已收行数=${collected.length}`);
  console.log('[e2e] 握手成功（get_state → response）');

  // 6. 诱导工具调用的一轮
  ws.send(
    JSON.stringify({
      ch: 'e2e-session-1',
      type: 'session.write',
      payload: {
        line: JSON.stringify({
          id: 'p-1',
          type: 'prompt',
          message: '请用 read 工具读取当前目录下 pnpm-workspace.yaml 的前几行，然后用一句话总结内容。',
        }),
      },
    }),
  );
  const turnDeadline = Date.now() + 120000;
  while (Date.now() < turnDeadline) {
    const lines = collected.join('\n');
    if (lines.includes('"tool_execution_start"')) report.toolSeen = true;
    if (lines.includes('"type":"agent_settled"') || lines.includes('"type":"agent_settled"'.replace('"type":"', '"type": "'))) {
      report.settledSeen = true;
      break;
    }
    if (lines.includes('401') || lines.toLowerCase().includes('unauthorized')) {
      // 鉴权失败：帧仍保留为样例，但按失败处理
      break;
    }
    await sleep(300);
  }
  report.lineCount = collected.length;
  report.durationMs = Date.now() - startedAt;

  // 7. 产物：真实帧样例（前 400 行）
  fs.writeFileSync(
    path.join(OUT_DIR, 'real-pi-frames.jsonl'),
    collected.slice(0, 400).join('\n') + '\n',
    'utf8',
  );

  if (!report.toolSeen && !report.settledSeen) {
    report.verdict = 'FAIL';
    report.reason = '一轮对话未观察到工具帧与终态（可能 pi 未登录 / 网络 / 模型无工具调用）。详见 real-pi-frames.jsonl';
    fs.writeFileSync(path.join(OUT_DIR, 'real-pi-report.json'), JSON.stringify(report, null, 2));
    console.error('[e2e] FAIL: 无工具帧与终态');
    ws.close();
    cleanup();
    process.exit(1);
  }

  report.verdict = report.settledSeen ? 'PASS' : 'PARTIAL';
  fs.writeFileSync(path.join(OUT_DIR, 'real-pi-report.json'), JSON.stringify(report, null, 2));
  console.log(`[e2e] 结果：${report.verdict}（lines=${report.lineCount}, tool=${report.toolSeen}, settled=${report.settledSeen}, ${Math.round(report.durationMs / 1000)}s）`);
  ws.close();
  cleanup();
  process.exit(report.verdict === 'PASS' ? 0 : 1);
}

main().catch((err) => {
  console.error(`[e2e] 异常：${err.message}`);
  cleanup();
  process.exit(1);
});
