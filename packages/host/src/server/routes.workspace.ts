/**
 * 工作区 REST 路由（架构 §2.3 server/routes.workspace.ts）：
 * 项目 CRUD + 目录信任确认（P-02）+ 异常标红（P-04 路径探测）；
 * 会话 CRUD（双轨持久化的 host 侧）；设置读写。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppSession, Project, Settings } from '@pi-agent/shared';
import type { WorkspaceStore } from './workspaceStore';
import { loadSettings, saveSettings } from '../config/settings';
import type { AppDirs } from '../config/paths';
import type { Logger } from '../log/logger';

export interface WorkspaceRouteDeps {
  store: WorkspaceStore;
  dirs: AppDirs;
  logger: Logger;
}

/** 目录探测：项目路径是否仍然可用（P-04 异常标红） */
function probeProjectStatus(p: Project): Project['status'] {
  try {
    fs.accessSync(p.path, fs.constants.R_OK);
    return 'ok';
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'EACCES' || code === 'EPERM' ? 'no-access' : 'missing';
  }
}

export function registerWorkspaceRoutes(app: FastifyInstance, deps: WorkspaceRouteDeps): void {
  const { store, dirs, logger } = deps;

  /* ---------- 项目 ---------- */

  app.get('/v1/projects', async (): Promise<Project[]> => {
    // 列表时顺带探测路径可用性，状态变化即持久化（前端异常标红）
    let changed = false;
    const list = store.listProjects().map((p) => {
      const status = probeProjectStatus(p);
      if (status !== p.status) {
        changed = true;
        return store.updateProject(p.id, { status });
      }
      return p;
    });
    void changed;
    return list;
  });

  app.post<{ Body: { path?: string; name?: string; trusted?: boolean } }>(
    '/v1/projects',
    async (request, reply): Promise<Project | undefined> => {
      const body = request.body ?? {};
      const rawPath = typeof body.path === 'string' ? body.path.trim() : '';
      if (rawPath.length === 0) {
        void reply.code(400);
        return undefined;
      }
      const abs = path.resolve(rawPath);
      let st: fs.Stats;
      try {
        st = fs.statSync(abs);
      } catch {
        void reply.code(400);
        return undefined;
      }
      if (!st.isDirectory()) {
        void reply.code(400);
        return undefined;
      }
      try {
        const project = store.addProject({ path: abs, name: body.name, trusted: body.trusted === true });
        logger.info('项目已添加', { id: project.id, path: project.path, trusted: project.trusted });
        return project;
      } catch {
        // 项目重复（409）等异常：不把明细抛给前端，仅回状态码
        void reply.code(409);
        return undefined;
      }
    },
  );

  app.patch<{ Params: { id: string }; Body: Partial<Project> }>(
    '/v1/projects/:id',
    async (request, reply): Promise<Project | undefined> => {
      const { id } = request.params;
      const patch = request.body ?? {};
      const allowed: Partial<Project> = {};
      if (typeof patch.name === 'string') allowed.name = patch.name;
      if (typeof patch.trusted === 'boolean') allowed.trusted = patch.trusted;
      if (typeof patch.status === 'string') allowed.status = patch.status as Project['status'];
      try {
        return store.updateProject(id, allowed);
      } catch {
        void reply.code(404);
        return undefined;
      }
    },
  );

  /** 信任确认（P-02）：未信任项目不获得写权限 */
  app.post<{ Params: { id: string } }>(
    '/v1/projects/:id/trust',
    async (request, reply): Promise<Project | undefined> => {
      try {
        const project = store.updateProject(request.params.id, { trusted: true });
        logger.info('项目已信任', { id: project.id, path: project.path });
        return project;
      } catch {
        void reply.code(404);
        return undefined;
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/v1/projects/:id',
    async (request, reply): Promise<{ ok: boolean } | undefined> => {
      const target = store.listProjects().find((p) => p.id === request.params.id);
      if (!target) {
        void reply.code(404);
        return undefined;
      }
      store.removeProject(request.params.id);
      return { ok: true };
    },
  );

  /* ---------- 会话 ---------- */

  app.get<{ Querystring: { includeArchived?: string } }>(
    '/v1/sessions',
    async (request): Promise<AppSession[]> => {
      const includeArchived = request.query.includeArchived === '1' || request.query.includeArchived === 'true';
      return store.listSessions({ includeArchived });
    },
  );

  app.post<{ Body: Partial<AppSession> }>('/v1/sessions', async (request): Promise<AppSession> => {
    return store.createSession(request.body ?? {});
  });

  app.patch<{ Params: { id: string }; Body: Partial<AppSession> }>(
    '/v1/sessions/:id',
    async (request, reply): Promise<AppSession | undefined> => {
      const patch = request.body ?? {};
      // 只允许白名单字段（app 侧不得伪造 createdAt）
      const allowed: Partial<AppSession> = {};
      if (typeof patch.title === 'string') allowed.title = patch.title;
      if (typeof patch.status === 'string') allowed.status = patch.status as AppSession['status'];
      if (typeof patch.piSessionId === 'string') allowed.piSessionId = patch.piSessionId;
      if (typeof patch.piSessionPath === 'string') allowed.piSessionPath = patch.piSessionPath;
      if (typeof patch.projectId === 'string' || patch.projectId === null) allowed.projectId = patch.projectId;
      if (typeof patch.pinned === 'boolean') allowed.pinned = patch.pinned;
      if (typeof patch.archived === 'boolean') allowed.archived = patch.archived;
      try {
        return store.updateSession(request.params.id, allowed);
      } catch {
        void reply.code(404);
        return undefined;
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/v1/sessions/:id',
    async (request, reply): Promise<{ ok: boolean } | undefined> => {
      const exists = store.listSessions({ includeArchived: true }).some((s) => s.id === request.params.id);
      if (!exists) {
        void reply.code(404);
        return undefined;
      }
      store.deleteSession(request.params.id);
      return { ok: true };
    },
  );

  /* ---------- 设置 ---------- */

  app.get('/v1/settings', async (): Promise<Settings> => loadSettings(dirs, logger));

  app.put<{ Body: unknown }>('/v1/settings', async (request, reply): Promise<Settings | undefined> => {
    const merged = { ...loadSettings(dirs, logger), ...(request.body as Record<string, unknown> | null) };
    // 校验由 SettingsSchema 完成（非法输入回退默认值并告警）
    try {
      saveSettings(dirs, merged as Settings);
      return loadSettings(dirs, logger);
    } catch {
      void reply.code(400);
      return undefined;
    }
  });
}
