/**
 * Git 分支 chip（G-01）：`git worktree list --porcelain` 列出 worktree。
 * 解析逻辑在 git/worktree.ts（纯函数 parseWorktreeList，供单测与创建/绑定路由共用）。
 * git 缺失或非仓库返回空列表。
 */
import type { FastifyInstance } from 'fastify';
import { listWorktrees } from '../git/worktree';

export interface GitRouteDeps {
  logger: { warn(msg: string, fields?: Record<string, unknown>): void };
}

export function registerGitRoutes(app: FastifyInstance, deps: GitRouteDeps): void {
  app.get('/v1/git/worktrees', async (req, reply) => {
    const qs = req.query as { path?: string };
    if (!qs.path || qs.path.trim().length === 0) {
      void reply.code(400);
      return { error: 'path 必填' };
    }
    const items = await listWorktrees(qs.path.trim());
    if (items.length === 0) {
      deps.logger.warn('git worktree 查询为空', { path: qs.path });
    }
    return { worktrees: items };
  });
}
