/**
 * 手机镜像（T04b 步骤 5 · B-01 B-02 B-03 B-06）：
 * - 静态镜像页 GET /mirror（自包含 HTML：单栏 + 底部抽屉，移动端视口）
 * - 镜像 WS /mirror/ws?t=<mirrorToken>：只读订阅（握手即推各会话积压行，随后实时转发）
 * - 镜像 REST /mirror/api/state|turns?t=<mirrorToken>（同源访问，不经主令牌门禁）
 * - 管理 REST /v1/mirror/*（主令牌门禁）：info（含局域网地址）/ write-acl / rotate-token / audit
 * - 写 ACL 默认关（Q7）：开启/关闭/轮换/写入全部留审计（不存密钥明文，轮换仅记前缀）
 * - 二维码由前端生成（web 包 qrcode），host 只提供局域网地址
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { newId, type HostWireFrame } from '@pi-agent/shared';
import type { AppDirs } from '../config/paths';
import { HOST_VERSION } from '../version';

const AUDIT_LIMIT = 200;
const LINE_RING_LIMIT = 300;
const SESSION_RING_LIMIT = 10;

export interface MirrorAuditEntry {
  at: string;
  kind: 'connect' | 'disconnect' | 'write' | 'write-denied' | 'acl-on' | 'acl-off' | 'token-rotate';
  /** 已脱敏明细（不存令牌明文） */
  detail: string;
}

export interface MirrorSessionInfo {
  id: string;
  title: string;
  projectId: string | null;
  status: string;
  updatedAt: string;
}

export interface MirrorOptions {
  dirs: AppDirs;
  logger: { info(msg: string, fields?: Record<string, unknown>): void; warn(msg: string, fields?: Record<string, unknown>): void };
  /** 会话列表（WorkspaceStore） */
  sessions(): MirrorSessionInfo[];
  /** 写 ACL 开启后的投递通道（与自动化共用 manager.write） */
  promptSender(sessionId: string, prompt: string): boolean;
}

export interface MirrorHandle {
  ingestFrame(frame: HostWireFrame): void;
  attachWs(server: HttpServer): void;
  registerRoutes(app: FastifyInstance): void;
  /** host listen 后回填端口（局域网地址用） */
  setPort(port: number): void;
  dispose(): void;
}

/* ---------- 审计（B-03） ---------- */

function auditPath(dirs: AppDirs): string {
  return path.join(dirs.root, 'mirror-audit.json');
}

function readAudit(dirs: AppDirs): MirrorAuditEntry[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(auditPath(dirs), 'utf8')) as { entries?: MirrorAuditEntry[] };
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

function appendAudit(dirs: AppDirs, entry: MirrorAuditEntry): void {
  const entries = [...readAudit(dirs), entry].slice(-AUDIT_LIMIT);
  fs.writeFileSync(auditPath(dirs), JSON.stringify({ entries }, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
}

/* ---------- 局域网地址 ---------- */

/** 第一个非内部 IPv4（找不到回退 null） */
export function lanIPv4(): string | null {
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}

/* ---------- 镜像页（自包含 HTML） ---------- */

/** 极简渲染：解析 pi 行，user/assistant 文本增量拼接；其余行忽略 */
function pageScript(): string {
  return `
const TOKEN = new URLSearchParams(location.search).get('t') || '';
let sessions = [], backlog = {}, current = null, writeEnabled = false, ws = null;
const $ = (id) => document.getElementById(id);

function renderSessions() {
  const sel = $('session');
  sel.innerHTML = '';
  for (const s of sessions) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = (s.title || s.id) + ' · ' + s.status;
    sel.appendChild(opt);
  }
  if (current) sel.value = current;
}
function msgClass(role) { return role === 'user' ? 'msg user' : 'msg'; }
function renderTranscript() {
  const lines = current ? (backlog[current] || []) : [];
  const box = $('transcript');
  box.innerHTML = '';
  const msgs = new Map();
  for (const raw of lines) {
    let f; try { f = JSON.parse(raw); } catch { continue; }
    if (f.type === 'message_update' && f.message && f.assistantMessageEvent) {
      const ev = f.assistantMessageEvent, id = f.message.id;
      const m = msgs.get(id) || { role: 'assistant', text: '' };
      if (ev.type === 'text_delta') m.text += ev.delta || '';
      msgs.set(id, m);
    } else if (f.type === 'message_start' && f.message && f.message.role === 'user') {
      msgs.set(f.message.id, { role: 'user', text: f.message.textContent || f.message.text || '' });
    }
  }
  for (const m of msgs.values()) {
    const div = document.createElement('div');
    div.className = msgClass(m.role);
    div.textContent = m.text;
    box.appendChild(div);
  }
  if (msgs.size === 0) box.innerHTML = '<div class="empty">暂无消息（会话运行后实时显示）</div>';
  box.scrollTop = box.scrollHeight;
}
function pushLine(ch, line) {
  const arr = backlog[ch] || (backlog[ch] = []);
  arr.push(line);
  if (arr.length > 300) arr.shift();
  if (ch === current) renderTranscript();
}
async function loadState() {
  const res = await fetch('/mirror/api/state?t=' + encodeURIComponent(TOKEN));
  if (res.status === 401) { document.body.innerHTML = '<p style="padding:2rem">令牌无效，请重新扫码</p>'; return false; }
  const data = await res.json();
  sessions = data.sessions || []; backlog = data.backlog || {};
  writeEnabled = !!data.writeEnabled; current = sessions[0] ? sessions[0].id : null;
  renderSessions(); renderTranscript(); $('writehint').textContent = writeEnabled ? '只读镜像 · 写权限已开启' : '只读镜像';
  const draft = $('draft');
  draft.placeholder = writeEnabled ? '输入消息…' : '只读模式（写权限未开启）';
  if (writeEnabled) draft.disabled = false;
  return true;
}
function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host + '/mirror/ws?t=' + encodeURIComponent(TOKEN));
  ws.onmessage = (ev) => {
    let f; try { f = JSON.parse(ev.data); } catch { return; }
    if (f.ch === 'sys') return;
    if (f.type === 'session.lines' && f.payload && Array.isArray(f.payload.lines)) {
      if (!replayed[f.ch]) {
        replayed[f.ch] = true;
        if (backlog[f.ch] && backlog[f.ch].length > 0) backlog[f.ch] = [];
      }
      for (const line of f.payload.lines) pushLine(f.ch, line);
    }
  };
  ws.onclose = () => setTimeout(connectWs, 2000);
}
async function sendPrompt() {
  const text = $('draft').value.trim();
  if (!text || !current) return;
  const res = await fetch('/mirror/api/turns?t=' + encodeURIComponent(TOKEN), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: current, prompt: text }),
  });
  if (res.ok) { $('draft').value = ''; $('drawerMsg').textContent = '已发送'; setTimeout(() => $('drawerMsg').textContent = '', 1500); }
  else { const e = await res.json().catch(() => ({})); $('drawerMsg').textContent = e.error || '发送失败'; }
}
$('session').addEventListener('change', (e) => { current = e.target.value; renderTranscript(); });
$('drawerHandle').addEventListener('click', () => $('drawer').classList.toggle('open'));
$('send').addEventListener('click', sendPopup);
function sendPopup() { if (writeEnabled) sendPrompt(); else $('drawerMsg').textContent = '写权限未开启（默认只读，B-02）'; }
loadState().then((ok) => { if (ok) connectWs(); });
`;
}

function mirrorPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>pi-agent 镜像</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; margin: 0; }
  body { font: 15px/1.6 system-ui, sans-serif; background: #f6f8fa; color: #1f2328; }
  header { position: sticky; top: 0; background: #1b1b1f; color: #fff; padding: .6rem .9rem; display: flex; gap: .6rem; align-items: center; }
  header select { flex: 1; max-width: 70%; font: inherit; }
  header span { font-size: 12px; opacity: .8; }
  main { padding: .8rem; padding-bottom: calc(3.4rem + env(safe-area-inset-bottom)); }
  .msg { background: #fff; border: 1px solid #d0d7de; border-radius: 10px; padding: .5rem .7rem; margin-bottom: .6rem; white-space: pre-wrap; word-break: break-word; }
  .msg.user { background: #ddf4ff; margin-left: 2rem; }
  .empty { color: #57606a; text-align: center; padding: 2rem 0; }
  #drawer { position: fixed; left: 0; right: 0; bottom: 0; background: #fff; border-top: 1px solid #d0d7de;
            transform: translateY(calc(100% - 3rem)); transition: transform .25s; z-index: 10; }
  #drawer.open { transform: translateY(0); }
  #drawerHandle { height: 3rem; display: flex; align-items: center; justify-content: center; gap: .5rem; color: #57606a; }
  #drawerHandle::before { content: ""; width: 2.4rem; height: 4px; border-radius: 2px; background: #d0d7de; }
  .drawer-body { padding: 0 .8rem 1rem; display: flex; gap: .5rem; }
  #draft { flex: 1; font: inherit; padding: .5rem; border: 1px solid #d0d7de; border-radius: 8px; }
  #send { font: inherit; padding: .5rem .9rem; border: 0; border-radius: 8px; background: #0969da; color: #fff; }
  #drawerMsg { font-size: 12px; color: #57606a; padding: 0 .8rem .5rem; min-height: 1.2em; }
</style>
</head>
<body>
<header>
  <select id="session"></select>
  <span id="writehint">只读镜像</span>
</header>
<main><div id="transcript" class="empty">加载中…</div></main>
<div id="drawer">
  <div id="drawerHandle" role="button" aria-label="工具抽屉"></div>
  <div class="drawer-body">
    <input id="draft" placeholder="${'${'}writeEnabled ? '输入消息…' : '只读模式（写权限未开启）'}" disabled>
    <button id="send">发送</button>
  </div>
  <div id="drawerMsg"></div>
</div>
<script>${pageScript()}</script>
</body>
</html>`;
}

/* ---------- 组装 ---------- */

export function createMirror(opts: MirrorOptions): MirrorHandle {
  let writeEnabled = false;
  let mirrorToken = newId() + newId();
  let boundPort = 0;
  const clients = new Set<WebSocket>();
  /** 会话 → 最近原始行 ring */
  const lineRings = new Map<string, string[]>();
  const wss = new WebSocketServer({ noServer: true });

  const audit = (kind: MirrorAuditEntry['kind'], detail: string): void => {
    appendAudit(opts.dirs, { at: new Date().toISOString(), kind, detail });
  };

  const pushToClients = (data: string): void => {
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  };

  /** PiBridge 广播旁路：缓存会话行 + 实时转发（只读订阅） */
  const ingestFrame = (frame: HostWireFrame): void => {
    if (frame.ch === 'sys') return;
    if (frame.type === 'session.lines') {
      const payload = frame.payload as { lines?: string[] } | null;
      const lines = Array.isArray(payload?.lines) ? payload!.lines : [];
      if (lines.length === 0) return;
      const ring = lineRings.get(frame.ch) ?? [];
      ring.push(...lines);
      while (ring.length > LINE_RING_LIMIT) ring.shift();
      lineRings.delete(frame.ch);
      // 最近活跃会话优先保留（LRU 语义：删后重插）
      lineRings.set(frame.ch, ring);
      if (lineRings.size > SESSION_RING_LIMIT) {
        const oldest = lineRings.keys().next().value;
        if (oldest !== undefined) lineRings.delete(oldest);
      }
    }
    pushToClients(JSON.stringify(frame));
  };

  const tokenOf = (req: IncomingMessage, url: URL): string | null => {
    const q = url.searchParams.get('t');
    const h = req.headers['x-mirror-token'];
    return q ?? (typeof h === 'string' ? h : null);
  };

  const attachWs = (server: HttpServer): void => {
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/mirror/ws') return; // 主 WS（/v1/ws）由 ws.ts 处理
      if (tokenOf(req, url) !== mirrorToken) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        clients.add(ws);
        audit('connect', `客户端接入（共 ${clients.size}）`);
        ws.send(JSON.stringify({ ch: 'sys', type: 'hello', payload: { ok: true } }));
        // 积压回放：握手即可看到各会话最近行
        for (const [ch, lines] of lineRings) {
          ws.send(JSON.stringify({ ch, type: 'session.lines', payload: { lines } }));
        }
        ws.on('message', (raw: Buffer) => {
          // 只读订阅：任何上行控制帧仅支持 ping
          try {
            const f = JSON.parse(raw.toString('utf8')) as { ch?: string; type?: string };
            if (f.ch === 'sys' && f.type === 'ping') {
              ws.send(JSON.stringify({ ch: 'sys', type: 'pong', payload: { ts: Date.now() } }));
              return;
            }
          } catch {
            /* 非 JSON 忽略 */
          }
          ws.send(JSON.stringify({ ch: 'sys', type: 'error', payload: { code: 'read_only', message: '镜像通道只读（B-01）' } }));
        });
        ws.on('close', () => {
          clients.delete(ws);
          audit('disconnect', `客户端断开（剩 ${clients.size}）`);
        });
        ws.on('error', () => clients.delete(ws));
      });
    });
  };

  const registerRoutes = (app: FastifyInstance): void => {
    // 静态镜像页（不带主令牌即可取页面；页面内 API/WS 需镜像令牌）
    app.get('/mirror', async (_req, reply) => {
      void reply.header('Content-Type', 'text/html; charset=utf-8');
      void reply.header(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:",
      );
      void reply.header('X-Content-Type-Options', 'nosniff');
      return mirrorPageHtml();
    });

    // 镜像状态（镜像令牌门禁）
    app.get<{ Querystring: { t?: string } }>('/mirror/api/state', async (request, reply) => {
      const t = request.query.t ?? '';
      if (t !== mirrorToken) {
        void reply.code(401);
        return { error: 'unauthorized' };
      }
      return {
        sessions: opts.sessions(),
        backlog: Object.fromEntries(lineRings),
        writeEnabled,
        version: HOST_VERSION,
      };
    });

    // 镜像写（默认关；开才投递并审计，B-02/B-03）
    app.post<{ Querystring: { t?: string }; Body: { sessionId?: string; prompt?: string } }>(
      '/mirror/api/turns',
      async (request, reply) => {
        const t = request.query.t ?? '';
        if (t !== mirrorToken) {
          void reply.code(401);
          return { error: 'unauthorized' };
        }
        const body = request.body ?? {};
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
        const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
        if (sessionId.length === 0 || prompt.length === 0) {
          void reply.code(400);
          return { error: 'sessionId 与 prompt 必填' };
        }
        if (!writeEnabled) {
          audit('write-denied', `写权限未开启（会话 ${sessionId.slice(0, 8)}…）`);
          void reply.code(403);
          return { error: '写权限未开启（默认只读）' };
        }
        const ok = opts.promptSender(sessionId, prompt);
        audit('write', `prompt 投递 ${ok ? '成功' : '失败'}（会话 ${sessionId.slice(0, 8)}…，${prompt.length} 字）`);
        if (!ok) {
          void reply.code(409);
          return { error: '会话不可写（未连接或已退出）' };
        }
        return { ok: true };
      },
    );

    /* ---------- 管理端（/v1/mirror/*，主令牌门禁覆盖） ---------- */

    app.get('/v1/mirror/info', async () => {
      const ip = lanIPv4();
      return {
        version: HOST_VERSION,
        writeEnabled,
        connections: clients.size,
        // 局域网地址（二维码由前端生成）
        lanUrl: ip !== null && boundPort > 0 ? `http://${ip}:${boundPort}/mirror?t=${mirrorToken}` : null,
        localUrl: boundPort > 0 ? `http://127.0.0.1:${boundPort}/mirror?t=${mirrorToken}` : null,
      };
    });

    app.post<{ Body: { enabled?: boolean } }>('/v1/mirror/write-acl', async (request, reply) => {
      const body = request.body ?? {};
      if (typeof body.enabled !== 'boolean') {
        void reply.code(400);
        return { error: 'enabled 必填' };
      }
      writeEnabled = body.enabled;
      audit(writeEnabled ? 'acl-on' : 'acl-off', `写权限已${writeEnabled ? '开启' : '关闭'}`);
      opts.logger.info('镜像写 ACL 变更', { writeEnabled });
      return { writeEnabled };
    });

    app.post('/v1/mirror/rotate-token', async () => {
      mirrorToken = newId() + newId();
      audit('token-rotate', `令牌已轮换（新前缀 ${mirrorToken.slice(0, 6)}…）`);
      // 旧令牌客户端全部失效
      for (const client of clients) client.close(4001, 'token rotated');
      clients.clear();
      return { ok: true };
    });

    app.get('/v1/mirror/audit', async () => ({ entries: readAudit(opts.dirs) }));
  };

  return {
    ingestFrame,
    attachWs,
    registerRoutes,
    setPort: (port: number) => {
      boundPort = port;
    },
    dispose: () => {
      for (const client of clients) client.close(1001, 'server shutdown');
      clients.clear();
      wss.close();
    },
  };
}
