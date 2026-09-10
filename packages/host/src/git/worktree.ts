/**
 * git worktree（G-01/G-02）：
 * - G-01 列表：`git worktree list --porcelain` 解析（routes.git 的数据源也走这里）
 * - G-01 绑定：把 worktree 路径写入 AppSession.worktreePath（会话 cwd 绑定）
 * - G-02 创建：`git worktree add`（execFile argv 直调，不经 shell）
 * - G-03..G-06（删除/对比/推送 PR）：仅骨架占位（501 not_implemented）
 */
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import type { GitWorktree } from '@pi-agent/shared';
import { stripAnsi } from '@pi-agent/shared';
import type { WorkspaceStore } from '../server/workspaceStore';

/**
 * 解析 `git worktree list --porcelain` 输出（纯函数，可单测）。
 * 块结构：worktree <path> / HEAD <sha> / branch refs/heads/<name>（或 bare/detached）。
 */
export function parseWorktreeList(out: string, cwd: string): GitWorktree[] {
  const items: GitWorktree[] = [];
  let current: Partial<GitWorktree> = {};
  const flush = (): void => {
    if (typeof current.path === 'string' && typeof current.head === 'string') {
      items.push({
        path: current.path,
        head: current.head,
        branch: current.branch ?? null,
        isMain: false,
      });
    }
    current = {};
  };
  for (const raw of stripAnsi(out).split('\n')) {
    const line = raw.trim();
    if (line.startsWith('worktree ')) {
      flush();
      current.path = line.slice('worktree '.length);
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (line === 'bare' || line === 'detached') {
      // 裸仓/游离 HEAD：branch 保持 null
    }
  }
  flush();
  // porcelain 不直接标主 worktree：与 cwd 一致者（或路径最短者）视为主
  if (items.length > 0) {
    const normalizedCwd = path.resolve(cwd).toLowerCase();
    const main =
      items.find((w) => path.resolve(w.path).toLowerCase() === normalizedCwd) ??
      items.reduce((a, b) => (a.path.length <= b.path.length ? a : b)!);
    main.isMain = true;
  }
  return items;
}

export function listWorktrees(cwd: string, timeoutMs = 5000): Promise<GitWorktree[]> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['worktree', 'list', '--porcelain'],
      { cwd, timeout: timeoutMs, windowsHide: true },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        resolve(parseWorktreeList(String(stdout), cwd));
      },
    );
  });
}

export interface CreateWorktreeOptions {
  projectPath: string;
  /** worktree 名称（同时作为分支名素材） */
  name: string;
  /** cli-home：~/.pi-agent/worktrees/<name>；sibling：项目同级目录 */
  location: 'cli-home' | 'sibling';
  /** 起始点（分支/tag/commit）；缺省 = 当前 HEAD */
  startPoint?: string;
}

/** 分支名净化：只保留字母数字 . _ - /（防注入，argv 直调仍做白名单） */
export function sanitizeBranchName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^a-zA-Z0-9._\-/]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return cleaned.length > 0 ? cleaned : 'worktree';
}

function worktreeTargetPath(opts: CreateWorktreeOptions): string {
  if (opts.location === 'sibling') {
    return path.join(path.dirname(path.resolve(opts.projectPath)), sanitizeBranchName(opts.name));
  }
  return path.join(os.homedir(), '.pi-agent', 'worktrees', sanitizeBranchName(opts.name));
}

/** 创建 worktree（argv 直调，不经 shell；G-02） */
export function createWorktree(
  opts: CreateWorktreeOptions,
  timeoutMs = 30_000,
): Promise<{ path: string; branch: string }> {
  const target = worktreeTargetPath(opts);
  const branch = sanitizeBranchName(opts.name);
  const args = ['worktree', 'add', target, '-b', branch];
  if (opts.startPoint && opts.startPoint.trim().length > 0) {
    args.push(opts.startPoint.trim());
  }
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd: opts.projectPath, timeout: timeoutMs, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stripAnsi(String(stderr || err.message)).trim() || 'git worktree add 失败'));
          return;
        }
        resolve({ path: target, branch });
      },
    );
  });
}

export interface WorktreeRouteDeps {
  store: WorkspaceStore;
  logger: { info(msg: string, fields?: Record<string, unknown>): void; warn(msg: string, fields?: Record<string, unknown>): void };
}

export function registerWorktreeRoutes(app: FastifyInstance, deps: WorktreeRouteDeps): void {
  /** G-02：创建 worktree */
  app.post<{
    Body: { projectPath?: string; name?: string; location?: 'cli-home' | 'sibling'; startPoint?: string };
  }>('/v1/git/worktrees', async (request, reply) => {
    const body = request.body ?? {};
    const projectPath = typeof body.projectPath === 'string' ? body.projectPath.trim() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (projectPath.length === 0 || name.length === 0) {
      void reply.code(400);
      return { error: 'projectPath 与 name 必填' };
    }
    const location = body.location === 'sibling' ? 'sibling' : 'cli-home';
    try {
      const created = await createWorktree({ projectPath, name, location, startPoint: body.startPoint });
      deps.logger.info('worktree 已创建', created);
      void reply.code(201);
      return created;
    } catch (err) {
      void reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  /** G-01：绑定 worktree 到会话（写入 AppSession.worktreePath） */
  app.post<{ Body: { sessionId?: string; worktreePath?: string } }>(
    '/v1/git/worktrees/bind',
    async (request, reply) => {
      const body = request.body ?? {};
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
      const worktreePath = typeof body.worktreePath === 'string' ? body.worktreePath.trim() : '';
      if (sessionId.length === 0) {
        void reply.code(400);
        return { error: 'sessionId 必填' };
      }
      try {
        const session = deps.store.updateSession(sessionId, {
          ...(worktreePath.length > 0 ? { worktreePath } : { worktreePath: undefined }),
        });
        return session;
      } catch {
        void reply.code(404);
        return { error: '会话不存在' };
      }
    },
  );

  /** G-03..G-06：删除/对比/推送 PR 仅骨架（T05+ 评估） */
  const notImplemented = async (_: unknown, reply: { code(code: number): unknown }) => {
    void reply.code(501);
    return { error: 'not_implemented', detail: 'worktree 删除/对比/PR 为骨架占位（G-03..G-06）' };
  };
  app.delete('/v1/git/worktrees', notImplemented);
  app.post('/v1/git/worktrees/compare', notImplemented);
  app.post('/v1/git/worktrees/pull-request', notImplemented);
}
