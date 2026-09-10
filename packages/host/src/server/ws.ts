/**
 * WS 通道（架构 §2.3 server/ws.ts）：
 * 直接用 ws 库挂在 Fastify 的 HTTP server 上（noServer + handleUpgrade），
 * 不经 @fastify/websocket（其类型增强与 fastify 5 泛型参数不兼容）。
 * - 令牌门禁（query ?t= 或头 x-pi-agent-token）
 * - sys 通道：hello / pong（心跳）
 * - 会话通道（ch = appSessionId）：整帧转发给 PiBridge（session.open/write/close）
 */
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { HostWireFrame } from '@pi-agent/shared';
import type { Logger } from '../log/logger';

export interface WsHub {
  /** 向全部已认证客户端广播一帧 */
  broadcast(frame: HostWireFrame): void;
  clientCount(): number;
  closeAll(): void;
}

export interface AttachWsOptions {
  token: string;
  logger: Logger;
  /** 会话帧处理器（PiBridge；缺省时保持 T01 行为：对未知帧回 error） */
  sessionHandler?(frame: HostWireFrame): void;
}

/** WS 路径 */
export const WS_PATH = '/v1/ws';

function tokenOf(req: IncomingMessage, url: URL): string | null {
  const q = url.searchParams.get('t');
  const h = req.headers['x-pi-agent-token'];
  return q ?? (typeof h === 'string' ? h : null);
}

/** 把 WS 服务挂到已监听的 HTTP server 上 */
export function attachWs(server: HttpServer, opts: AttachWsOptions): WsHub {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
  const clients = new Set<WebSocket>();

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== WS_PATH) {
      socket.destroy();
      return;
    }
    if (tokenOf(req, url) !== opts.token) {
      opts.logger.warn('WS 连接被拒绝：令牌无效');
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.add(ws);
      opts.logger.debug('WS 客户端接入', { count: clients.size });
      ws.send(JSON.stringify({ ch: 'sys', type: 'hello', payload: { ok: true } }));

      ws.on('message', (raw: Buffer) => {
        let frame: HostWireFrame | null = null;
        try {
          const parsed: unknown = JSON.parse(raw.toString('utf8'));
          if (
            typeof parsed === 'object' &&
            parsed !== null &&
            typeof (parsed as HostWireFrame).type === 'string'
          ) {
            frame = parsed as HostWireFrame;
          }
        } catch {
          frame = null;
        }
        if (!frame) {
          ws.send(JSON.stringify({ ch: 'sys', type: 'error', payload: { code: 'bad_request', message: '帧格式非法' } }));
          return;
        }
        // 控制帧：心跳
        if (frame.ch === 'sys' && frame.type === 'ping') {
          ws.send(JSON.stringify({ ch: 'sys', type: 'pong', payload: { ts: Date.now() } }));
          return;
        }
        // 会话帧 → PiBridge（host 不解析 pi 协议，仅封套路由）
        if (opts.sessionHandler) {
          try {
            opts.sessionHandler(frame);
          } catch (err) {
            opts.logger.error('会话帧处理异常', { message: err instanceof Error ? err.message : String(err) });
            ws.send(
              JSON.stringify({
                ch: frame.ch,
                type: 'error',
                payload: { code: 'internal', message: '会话帧处理异常' },
              }),
            );
          }
          return;
        }
        ws.send(
          JSON.stringify({
            ch: frame.ch,
            type: 'error',
            payload: { code: 'not_found', message: `未实现的帧类型 ${frame.type}` },
          }),
        );
      });

      ws.on('close', () => {
        clients.delete(ws);
      });
      ws.on('error', (err: Error) => {
        clients.delete(ws);
        opts.logger.warn('WS 客户端错误', { message: err.message });
      });
    });
  });

  return {
    broadcast(frame: HostWireFrame): void {
      const data = JSON.stringify(frame);
      for (const client of clients) {
        if (client.readyState === client.OPEN) {
          client.send(data);
        }
      }
    },
    clientCount(): number {
      return clients.size;
    },
    closeAll(): void {
      for (const client of clients) {
        try {
          client.close(1001, 'server shutdown');
        } catch {
          /* 忽略关闭异常 */
        }
      }
      clients.clear();
      wss.close();
    },
  };
}
