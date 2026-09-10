/**
 * 文件访问 REST 路由（架构 §2.3 server/routes.fs.ts）：
 * 面向 @ 引用与附件选择：目录列举 / 文件名搜索（跳过 node_modules、.git 等）。
 * 只读：host 不提供任意写接口（写文件由 pi agent 在受信任目录内完成）。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

/** 搜索时跳过的目录名（硬编码黑名单，防爬 node_modules） */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', 'dist', 'build', 'out', 'target',
  '.next', '.cache', 'coverage', '.pnpm-store',
]);

const SKIP_FILES = new Set(['.DS_Store', 'desktop.ini', 'thumbs.db']);

export interface FsRouteDeps {
  logger: { warn(msg: string, fields?: Record<string, unknown>): void; info(msg: string, fields?: Record<string, unknown>): void };
  /**
   * 受信任项目根目录列表（T04b：PUT /v1/fs/write 的写入白名单）。
   * 未提供时写接口一律 403（host 不开放任意写）。
   */
  trustedRoots?: () => string[];
}

/** 判断目标路径是否位于任一受信任根目录内（大小写不敏感，Path 前缀校验） */
export function isUnderTrustedRoot(absPath: string, roots: string[]): boolean {
  const norm = absPath.toLowerCase();
  return roots.some((root) => {
    const r = root.toLowerCase();
    return norm === r || norm.startsWith(r.endsWith('\\') || r.endsWith('/') ? r : r + path.sep);
  });
}

/** 递归文件名搜索：大小写不敏感的子串匹配；深度与总量有界 */
export function searchFiles(root: string, q: string, limit = 30): string[] {
  const needle = q.trim().toLowerCase();
  const results: string[] = [];
  if (needle.length === 0) return results;
  const maxDepth = 8;
  const maxVisited = 20000;
  let visited = 0;

  const walk = (dir: string, depth: number): void => {
    if (results.length >= limit || visited >= maxVisited || depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    visited += entries.length;
    for (const entry of entries) {
      if (results.length >= limit || visited >= maxVisited) return;
      if (entry.name.startsWith('.') && entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else {
        if (SKIP_FILES.has(entry.name.toLowerCase())) continue;
        if (entry.name.toLowerCase().includes(needle)) {
          results.push(full);
        }
      }
    }
  };

  walk(root, 0);
  return results;
}

export function registerFsRoutes(app: FastifyInstance, deps: FsRouteDeps): void {
  /** GET /v1/fs/search?root=&q=&limit= —— 文件名搜索（@ 引用数据源） */
  app.get<{ Querystring: { root?: string; q?: string; limit?: string } }>(
    '/v1/fs/search',
    async (request, reply): Promise<string[] | undefined> => {
      const root = request.query.root ?? '';
      const q = request.query.q ?? '';
      if (root.length === 0) {
        void reply.code(400);
        return undefined;
      }
      const abs = path.resolve(root);
      if (!fs.existsSync(abs)) {
        void reply.code(404);
        return undefined;
      }
      const limit = Number.parseInt(request.query.limit ?? '30', 10);
      return searchFiles(abs, q, Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 30);
    },
  );

  /** GET /v1/fs/list?path= —— 目录列举 */
  app.get<{ Querystring: { path?: string } }>(
    '/v1/fs/list',
    async (request, reply) => {
      const p = request.query.path ?? '';
      if (p.length === 0) {
        void reply.code(400);
        return undefined;
      }
      const abs = path.resolve(p);
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(abs, { withFileTypes: true });
      } catch (err) {
        deps.logger.warn('目录列举失败', { path: abs, message: (err as Error).message });
        void reply.code(404);
        return undefined;
      }
      return entries
        .filter((e) => e.name !== '.DS_Store')
        .slice(0, 2000)
        .map((e) => {
          const full = path.join(abs, e.name);
          let size: number | undefined;
          if (e.isFile()) {
            try {
              size = fs.statSync(full).size;
            } catch {
              size = undefined;
            }
          }
          return { name: e.name, path: full, kind: e.isDirectory() ? ('dir' as const) : ('file' as const), size };
        });
    },
  );

  /** GET /v1/fs/read?path=&max= —— 读文本文件（上限默认 256KB） */
  app.get<{ Querystring: { path?: string; max?: string } }>(
    '/v1/fs/read',
    async (request, reply): Promise<{ content: string; truncated: boolean } | undefined> => {
      const p = request.query.path ?? '';
      if (p.length === 0) {
        void reply.code(400);
        return undefined;
      }
      const abs = path.resolve(p);
      const max = Number.parseInt(request.query.max ?? String(256 * 1024), 10);
      try {
        const st = fs.statSync(abs);
        if (!st.isFile()) {
          void reply.code(400);
          return undefined;
        }
        const cap = Number.isFinite(max) ? Math.min(Math.max(max, 1), 2 * 1024 * 1024) : 256 * 1024;
        const fd = fs.openSync(abs, 'r');
        try {
          const len = Math.min(st.size, cap);
          const buf = Buffer.alloc(len);
          fs.readSync(fd, buf, 0, len, 0);
          return { content: buf.toString('utf8'), truncated: st.size > cap };
        } finally {
          fs.closeSync(fd);
        }
      } catch {
        void reply.code(404);
        return undefined;
      }
    },
  );

  /** GET /v1/fs/stat?path= */
  app.get<{ Querystring: { path?: string } }>(
    '/v1/fs/stat',
    async (request, reply) => {
      const p = request.query.path ?? '';
      if (p.length === 0) {
        void reply.code(400);
        return undefined;
      }
      try {
        const st = fs.statSync(path.resolve(p));
        return { size: st.size, mtimeMs: st.mtimeMs, isDirectory: st.isDirectory() };
      } catch {
        void reply.code(404);
        return undefined;
      }
    },
  );

  /**
   * PUT /v1/fs/write { path, content } —— 变更面板「还原」的写回通道（T04b）。
   * 治理约束：仅允许写入受信任项目目录内的文件（不绕过权限扩展的治理边界）。
   */
  app.put<{ Body: { path?: string; content?: string } }>(
    '/v1/fs/write',
    async (request, reply) => {
      const body = request.body ?? {};
      const p = typeof body.path === 'string' ? body.path.trim() : '';
      if (p.length === 0 || typeof body.content !== 'string') {
        void reply.code(400);
        return { error: 'path 与 content 必填' };
      }
      const roots = deps.trustedRoots?.() ?? [];
      const abs = path.resolve(p);
      if (!isUnderTrustedRoot(abs, roots)) {
        deps.logger.warn('fs/write 拒绝：目标不在受信任目录内', { path: abs });
        void reply.code(403);
        return { error: '仅允许写入受信任项目目录内的文件' };
      }
      try {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, body.content, 'utf8');
        deps.logger.info('fs/write 已写入', { path: abs, bytes: Buffer.byteLength(body.content, 'utf8') });
        return { ok: true };
      } catch (err) {
        deps.logger.warn('fs/write 失败', { path: abs, message: (err as Error).message });
        void reply.code(500);
        return { error: '写入失败' };
      }
    },
  );
}
