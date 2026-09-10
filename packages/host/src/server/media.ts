/**
 * 回环媒体服务（架构 §2.3 server/media.ts）：
 * 浏览器不能直接 <img src="file:///...">，本地路径经 GET /v1/media?t=<token>&p=<绝对路径> 提供回环 URL。
 * - 令牌校验（query t）
 * - 路径必须为绝对路径且存在
 * - 按扩展名映射 Content-Type；未知类型按 application/octet-stream
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

export function contentTypeOf(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/** 构造回环媒体 URL（web 端 MediaApi.url 的对应实现） */
export function mediaUrl(httpUrl: string, token: string, absPath: string): string {
  return `${httpUrl}/v1/media?t=${encodeURIComponent(token)}&p=${encodeURIComponent(absPath)}`;
}

export interface MediaRouteDeps {
  token: string;
  logger: { warn(msg: string, fields?: Record<string, unknown>): void };
}

export function registerMediaRoutes(app: FastifyInstance, deps: MediaRouteDeps): void {
  app.get<{ Querystring: { t?: string; p?: string } }>(
    '/v1/media',
    async (request, reply): Promise<undefined> => {
      const { t: token, p: rawPath } = request.query;
      // 令牌校验（与 WS 同源令牌）
      if (token !== deps.token) {
        void reply.code(401);
        return undefined;
      }
      if (!rawPath || !path.isAbsolute(rawPath)) {
        void reply.code(400);
        return undefined;
      }
      const abs = path.resolve(rawPath);
      let st: fs.Stats;
      try {
        st = fs.statSync(abs);
      } catch {
        void reply.code(404);
        return undefined;
      }
      if (!st.isFile() || st.size > 64 * 1024 * 1024) {
        void reply.code(400);
        return undefined;
      }
      const type = contentTypeOf(abs);
      void reply.header('Content-Type', type);
      void reply.header('Content-Length', st.size);
      void reply.header('Cache-Control', 'private, max-age=3600');
      const stream = fs.createReadStream(abs);
      void reply.send(stream);
      return undefined;
    },
  );
}
