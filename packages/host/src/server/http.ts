/**
 * Fastify HTTP 服务：
 * - 绑 127.0.0.1，端口在 49152–65535 随机（避免 ERR_UNSAFE_PORT，架构 §8.10）
 * - GET /v1/health：{ ok, version, pi:{found,version,path}, endpoints }（pi 探测由 index.ts 注入）
 * - /v1/* 其余路由走令牌门禁（x-pi-agent-token 头；/v1/media 用 query t）
 * - CORS 仅允许本机 origin，不得为 *
 * - WS 直接挂在底层 HTTP server 上（见 ws.ts）
 */
import net from 'node:net';
import type { Server as RawHttpServer } from 'node:http';
import { randomInt } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cors, { type FastifyCorsOptions } from '@fastify/cors';
import type { HealthInfo, HostWireFrame } from '@pi-agent/shared';
import type { Logger } from '../log/logger';
import { attachWs, type WsHub } from './ws';
import { HOST_VERSION } from '../version';

export interface HttpServerHandle {
  port: number;
  httpUrl: string;
  wsUrl: string;
  hub: WsHub;
  /** 底层 HTTP server（镜像 WS upgrade 挂载用，T04b） */
  rawServer: RawHttpServer;
  close(): Promise<void>;
}

export interface StartHttpOptions {
  token: string;
  logger: Logger;
  /** 启动前注册业务路由（workspace / fs / media 等，必须在 listen 前完成） */
  register?(app: FastifyInstance): void;
  /** health 的 pi 探测信息（惰性取值，探测失败返回 found:false） */
  piInfo?(): HealthInfo['pi'];
  /** WS 会话帧处理器（PiBridge） */
  sessionHandler?(frame: HostWireFrame): void;
}

/** 探测 127.0.0.1 上端口是否可用 */
function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

/** 在 49152–65535 范围内找一个空闲端口 */
export async function findFreePort(min = 49152, max = 65535, attempts = 25): Promise<number> {
  for (let i = 0; i < attempts; i++) {
    const port = randomInt(min, max + 1);
    if (await probePort(port)) return port;
  }
  throw new Error('未能找到可用端口（49152–65535 全部被占用）');
}

export async function startHttpServer(opts: StartHttpOptions): Promise<HttpServerHandle> {
  const app: FastifyInstance = Fastify({ logger: false });

  // CORS：仅本机 origin（dev 的 vite 端口），绝不 *
  const corsOptions: FastifyCorsOptions = {
    origin: (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
      if (
        !origin ||
        origin.startsWith('http://127.0.0.1') ||
        origin.startsWith('http://localhost')
      ) {
        cb(null, true);
      } else {
        cb(null, false);
      }
    },
  };
  await app.register(cors, corsOptions);

  let boundPort = 0;

  // REST 令牌门禁：/v1/* 除 health（无敏感信息）与 media（自带 query token）外一律校验头
  app.addHook('preHandler', async (request, reply) => {
    const url = request.url.split('?')[0] ?? '';
    if (!url.startsWith('/v1/') || url === '/v1/health' || url === '/v1/media') return;
    const header = request.headers['x-pi-agent-token'];
    if (header !== opts.token) {
      void reply.code(401).send({ code: 'unauthorized', message: '令牌缺失或不匹配' });
    }
  });

  app.get('/v1/health', async (): Promise<HealthInfo> => {
    return {
      ok: true,
      version: HOST_VERSION,
      pi: opts.piInfo?.() ?? { found: false, version: null, path: null },
      connectLockBusy: false,
      endpoints: {
        httpUrl: `http://127.0.0.1:${boundPort}`,
        wsUrl: `ws://127.0.0.1:${boundPort}/v1/ws`,
      },
    };
  });

  // 业务路由（workspace / fs / media）—— listen 前注册
  opts.register?.(app);

  const port = await findFreePort();
  boundPort = port;
  await app.listen({ port, host: '127.0.0.1' });

  // WS 挂在底层 HTTP server（listen 之后才有 server 实例）
  const hub = attachWs(app.server, {
    token: opts.token,
    logger: opts.logger,
    sessionHandler: opts.sessionHandler,
  });
  opts.logger.info('HTTP/WS 服务已监听', { port, host: '127.0.0.1' });

  return {
    port,
    httpUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/v1/ws`,
    hub,
    rawServer: app.server,
    async close(): Promise<void> {
      hub.closeAll();
      await app.close();
    },
  };
}
