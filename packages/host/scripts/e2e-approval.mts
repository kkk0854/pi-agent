/**
 * T03 端到端验收（真实 pi 审批链路）：
 * 启动 host（隔离数据目录 + defaultModel 兜底）→ session.open（ask 档）→
 * prompt 让 pi 写临时文件 → 内置审批扩展发 extension_ui_request(confirm) →
 * 第一次拒绝（验证 block + reason 生效）→ 再放行 → 验证文件真实创建 → agent_settled。
 * 产物：docs/e2e/approval-report.json + approval-frames.jsonl（脱敏真实帧）。
 * 退出码：0 = PASS；1 = FAIL/PARTIAL。
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
const TARGET_FILE = path.join(ROOT, 'e2e-approval-test.txt');
const E2E_DEFAULT_MODEL = { provider: 'grok', modelId: 'gemini-3.8-flash-high' };

const require = createRequire(import.meta.url);
const TSX_CLI = require.resolve('tsx/cli');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.writeFileSync(
  path.join(DATA_DIR, 'settings.json'),
  JSON.stringify({ runtimeMode: 'auto', defaultModel: E2E_DEFAULT_MODEL }, null, 2),
  'utf8',
);
// 确保目标文件不存在（放行后才允许出现）
fs.rmSync(TARGET_FILE, { force: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

function finish(report, code) {
  fs.writeFileSync(path.join(OUT_DIR, 'approval-report.json'), JSON.stringify(report, null, 2));
  console.log(`[e2e-approval] ${report.verdict}: ${JSON.stringify({ ...report, frames: undefined })}`);
  ws?.close();
  cleanup();
  process.exit(code);
}

let ws = null;

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

async function runTurn(ws, ch, promptText, collected, cursor, handlers) {
  // 发 prompt
  ws.send(
    JSON.stringify({
      ch,
      type: 'session.write',
      payload: { line: JSON.stringify({ id: `p-${Date.now()}`, type: 'prompt', message: promptText }) },
    }),
  );
  // 监听直到 settled；期间处理审批请求（cursor 游标避免重复处理）
  const deadline = Date.now() + 150000;
  const seen = { toolStart: false, toolEnd: false, blocked: false };
  while (Date.now() < deadline) {
    while (cursor.i < collected.length) {
      const line = collected[cursor.i++];
      let frame;
      try {
        frame = JSON.parse(line);
      } catch {
        continue;
      }
      if (frame.type === 'tool_execution_start') seen.toolStart = true;
      if (frame.type === 'tool_execution_end' && frame.isError === true) seen.blocked = true;
      if (frame.type === 'extension_ui_request' && frame.method === 'confirm') {
        await handlers.onUiRequest(frame);
      }
      if (frame.type === 'agent_settled') {
        return { ...seen, settled: true };
      }
    }
    await sleep(250);
  }
  return { ...seen, settled: false };
}

async function main() {
  const report = {
    verdict: 'PENDING',
    pi: null,
    handshake: false,
    uiRequestSeen: false,
    denyApplied: false,
    allowApplied: false,
    blockedAfterDeny: false,
    fileCreatedAfterAllow: false,
    settledSeen: false,
    lineCount: 0,
  };

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
  if (!endpoint) {
    report.verdict = 'FAIL';
    report.reason = `host.json 未生成。日志：${hostLogs.join('').slice(-600)}`;
    finish(report, 1);
  }
  console.log(`[e2e-approval] host 已启动 ${endpoint.httpUrl}`);

  const healthRes = await fetch(`${endpoint.httpUrl}/v1/health`, {
    headers: { 'x-pi-agent-token': endpoint.token },
  });
  const health = await healthRes.json();
  report.pi = health.pi;
  if (!health.pi.found) {
    report.verdict = 'FAIL';
    report.reason = 'host 未找到 pi';
    finish(report, 1);
  }

  // WS 建连
  ws = new WebSocket(`${endpoint.wsUrl}?t=${encodeURIComponent(endpoint.token)}`);
  const collected = [];
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WS 连接超时')), 10000);
  });
  ws.on('message', (raw) => {
    try {
      const frame = JSON.parse(raw.toString('utf8'));
      if (frame.ch !== 'sys' && frame.type === 'session.lines') {
        collected.push(...(frame.payload?.lines ?? []));
      }
    } catch {
      /* 忽略 */
    }
  });
  console.log('[e2e-approval] WS 已连接');

  // session.open：ask 档（③ 全弹审批）
  ws.send(
    JSON.stringify({
      ch: 'e2e-approval-1',
      type: 'session.open',
      payload: {
        appSessionId: 'e2e-approval-1',
        projectPath: ROOT,
        title: 'T03 审批验收',
        permissionTier: 'ask',
      },
    }),
  );

  // 握手
  const hsDeadline = Date.now() + 20000;
  while (Date.now() < hsDeadline) {
    try {
      ws.send(
        JSON.stringify({
          ch: 'e2e-approval-1',
          type: 'session.write',
          payload: { line: JSON.stringify({ id: `hs-${Date.now()}`, type: 'get_state' }) },
        }),
      );
    } catch {
      break;
    }
    await sleep(600);
    if (collected.some((l) => l.includes('"success":true') && l.includes('get_state'))) {
      report.handshake = true;
      break;
    }
  }
  if (!report.handshake) {
    report.verdict = 'FAIL';
    report.reason = `get_state 握手超时（lines=${collected.length}）`;
    finish(report, 1);
  }
  console.log('[e2e-approval] 握手成功');

  // 审批策略：第 1 个请求拒绝，之后全部放行
  const decisions = [];
  const handlers = {
    async onUiRequest(frame) {
      report.uiRequestSeen = true;
      const payload = (() => {
        try {
          return JSON.parse(frame.message ?? '{}');
        } catch {
          return {};
        }
      })();
      const allow = decisions.length >= 1;
      decisions.push({ id: frame.id, toolName: payload.toolName, allow });
      if (allow) report.allowApplied = true;
      else report.denyApplied = true;
      console.log(`[e2e-approval] 审批请求 tool=${payload.toolName} → ${allow ? '放行' : '拒绝'}`);
      // 与 piCommands.extensionUiResponse 同形：{id: <requestId>, type, confirmed}
      ws.send(
        JSON.stringify({
          ch: 'e2e-approval-1',
          type: 'session.write',
          payload: {
            line: JSON.stringify({
              id: frame.id,
              type: 'extension_ui_response',
              confirmed: allow,
            }),
          },
        }),
      );
    },
  };

  // 第一轮：写文件 → 拒绝
  const cursor = { i: 0 };
  const r1 = await runTurn(
    ws,
    'e2e-approval-1',
    '请用 write 工具在当前目录创建文件 e2e-approval-test.txt，内容只写 ok。完成后告诉我结果。',
    collected,
    cursor,
    handlers,
  );
  report.blockedAfterDeny = r1.blocked || (!r1.settled && decisions.length >= 1);
  console.log(`[e2e-approval] 第一轮结束：settled=${r1.settled} toolStart=${r1.toolStart} decisions=${decisions.length}`);

  // 第二轮（如文件未创建）：再写 → 放行
  if (!fs.existsSync(TARGET_FILE)) {
    console.log('[e2e-approval] 文件未创建，发起第二轮（放行）');
    const r2 = await runTurn(
      ws,
      'e2e-approval-1',
      '请再次用 write 工具创建文件 e2e-approval-test.txt（内容 ok）。这次请务必执行。',
      collected,
      cursor,
      handlers,
    );
    report.settledSeen = r2.settled || r1.settled;
    console.log(`[e2e-approval] 第二轮结束：settled=${r2.settled} decisions=${decisions.length}`);
  }

  report.fileCreatedAfterAllow = fs.existsSync(TARGET_FILE);
  report.lineCount = collected.length;

  // 产物：审批相关真实帧（脱敏：保留结构，截断长字段）
  const approvalFrames = collected.filter((l) => {
    const f = (() => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })();
    if (!f) return false;
    return (
      f.type === 'extension_ui_request' ||
      f.type === 'tool_execution_start' ||
      f.type === 'tool_execution_end' ||
      f.type === 'response'
    );
  });
  fs.writeFileSync(
    path.join(OUT_DIR, 'approval-frames.jsonl'),
    approvalFrames.slice(0, 120).map((l) => (l.length > 600 ? `${l.slice(0, 600)}…` : l)).join('\n') + '\n',
    'utf8',
  );

  const pass =
    report.uiRequestSeen &&
    report.denyApplied &&
    report.allowApplied &&
    report.fileCreatedAfterAllow &&
    (report.settledSeen || report.blockedAfterDeny);
  report.verdict = pass ? 'PASS' : 'PARTIAL';
  if (!pass) report.reason = '审批链路不完整：需 拒绝+放行+文件创建 全部发生';
  finish(report, pass ? 0 : 1);
}

main().catch((err) => {
  console.error(`[e2e-approval] 异常：${err.message}`);
  cleanup();
  process.exit(1);
});
