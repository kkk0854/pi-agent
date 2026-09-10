/**
 * 工作区 API 双轨实现（架构 §2.5）：
 * host 可达 → REST（host.json 持久化，权威数据源）；
 * host 不可达 → localStorage 兜底（离线模式不丢数据，host 恢复后仅读兜底）。
 * 接口与 shared 的 WorkspaceApi 子集对齐。
 */
import type { AppSession, DangerousPattern, Project, Settings } from '@pi-agent/shared';
import { DEFAULT_DANGEROUS_PATTERNS } from '@pi-agent/shared';
import { loadLocal, saveLocal } from './persistLocal';
import type { HostClient } from './hostClient';

export interface WorkspaceApi {
  listProjects(): Promise<Project[]>;
  addProject(input: { path: string; name?: string; trusted: boolean }): Promise<Project>;
  updateProject(id: string, patch: Partial<Project>): Promise<Project>;
  trustProject(id: string): Promise<Project>;
  removeProject(id: string): Promise<void>;
  listSessions(opts?: { includeArchived?: boolean }): Promise<AppSession[]>;
  createSession(input: Partial<AppSession>): Promise<AppSession>;
  updateSession(id: string, patch: Partial<AppSession>): Promise<AppSession>;
  deleteSession(id: string): Promise<void>;
  getSettings(): Promise<Settings>;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  searchFiles(root: string, q: string, limit?: number): Promise<string[]>;
  /** 读文本文件（内置编辑器 / Diff 面板；离线模式不支持，抛错） */
  readFile(path: string, maxBytes?: number): Promise<{ content: string; truncated: boolean }>;
  /** 写文本文件（变更面板「还原」用；host 校验信任目录；离线不支持） */
  writeFile(path: string, content: string): Promise<{ ok: boolean }>;
  mediaUrl(absPath: string): string;
  /** 危险清单合并下发（A-13：默认数据文件 + 自定义；离线回退 shared 默认） */
  listDangerousPatterns(): Promise<DangerousPattern[]>;
  /** 审计上报（A-10；离线模式下静默丢弃） */
  postAudit(entry: {
    sessionId: string;
    toolName: string;
    argsSummary: string;
    tier: string;
    result: string;
    matchedPatternId: string | null;
    risk: string;
  }): Promise<void>;
  /** 当前是否走 host REST */
  readonly online: boolean;
}

/* ---------- localStorage 兜底实现 ---------- */

const PROJECTS_KEY = 'ws.projects';
const SESSIONS_KEY = 'ws.sessions';

function localProjects(): Project[] {
  return loadLocal<Project[]>(PROJECTS_KEY, []);
}

function localSessions(): AppSession[] {
  return loadLocal<AppSession[]>(SESSIONS_KEY, []);
}

function localId(): string {
  return `local-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function createLocalApi(): WorkspaceApi {
  return {
    online: false,
    async listProjects() {
      return localProjects();
    },
    async addProject(input) {
      const projects = localProjects();
      if (projects.some((p) => p.path === input.path)) {
        throw new Error('该项目已在列表中');
      }
      const now = new Date().toISOString();
      const project: Project = {
        id: localId(),
        name: input.name?.trim() || input.path.split(/[\\/]/).pop() || input.path,
        path: input.path,
        trusted: input.trusted,
        createdAt: now,
        lastOpenedAt: now,
        status: 'ok',
      };
      saveLocal(PROJECTS_KEY, [...projects, project]);
      return project;
    },
    async updateProject(id, patch) {
      const projects = localProjects();
      const idx = projects.findIndex((p) => p.id === id);
      if (idx === -1) throw new Error('项目不存在');
      const next = { ...projects[idx]!, ...patch };
      projects[idx] = next;
      saveLocal(PROJECTS_KEY, projects);
      return next;
    },
    async trustProject(id) {
      return this.updateProject(id, { trusted: true });
    },
    async removeProject(id) {
      saveLocal(
        PROJECTS_KEY,
        localProjects().filter((p) => p.id !== id),
      );
    },
    async listSessions(opts) {
      const list = localSessions();
      return (opts?.includeArchived ? list : list.filter((s) => !s.archived)).sort((a, b) =>
        a.updatedAt < b.updatedAt ? 1 : -1,
      );
    },
    async createSession(input) {
      const now = new Date().toISOString();
      const session: AppSession = {
        id: localId(),
        projectId: input.projectId ?? null,
        title: input.title?.trim() || '新会话',
        status: 'idle',
        createdAt: now,
        updatedAt: now,
        pinned: false,
        archived: false,
      };
      saveLocal(SESSIONS_KEY, [...localSessions(), session]);
      return session;
    },
    async updateSession(id, patch) {
      const sessions = localSessions();
      const idx = sessions.findIndex((s) => s.id === id);
      if (idx === -1) throw new Error('会话不存在');
      const next: AppSession = { ...sessions[idx]!, ...patch, updatedAt: new Date().toISOString() };
      sessions[idx] = next;
      saveLocal(SESSIONS_KEY, sessions);
      return next;
    },
    async deleteSession(id) {
      saveLocal(
        SESSIONS_KEY,
        localSessions().filter((s) => s.id !== id),
      );
    },
    async getSettings() {
      return loadLocal<Settings | null>('ws.settings', null) ?? ({} as Settings);
    },
    async saveSettings(patch) {
      saveLocal('ws.settings', { ...loadLocal('ws.settings', {}), ...patch });
    },
    async searchFiles() {
      return [];
    },
    async readFile(): Promise<{ content: string; truncated: boolean }> {
      // 离线模式无 host 文件系统访问：编辑器改走浏览器 File API / 粘贴
      throw new Error('离线模式下无法读取文件，请使用「打开本地文件」或粘贴内容');
    },
    async writeFile(): Promise<{ ok: boolean }> {
      throw new Error('离线模式下无法写文件（还原需要 host 在线）');
    },
    mediaUrl(absPath: string) {
      // 离线模式没有回环媒体服务：dataUrl 附件不受影响
      return absPath;
    },
    async postAudit() {
      // 离线模式：审计不上报（A-10 仅 host 在线时落盘）
    },
    async listDangerousPatterns() {
      return [...DEFAULT_DANGEROUS_PATTERNS];
    },
  };
}

/* ---------- host REST 实现（失败时抛 HostApiError，由调用方 Toast） ---------- */

function createHostApi(client: HostClient): WorkspaceApi {
  return {
    online: true,
    listProjects: () => client.listProjects(),
    addProject: (input) => client.addProject(input),
    updateProject: (id, patch) => client.updateProject(id, patch),
    trustProject: (id) => client.trustProject(id),
    removeProject: async (id) => {
      await client.removeProject(id);
    },
    listSessions: (opts) => client.listSessions(opts?.includeArchived ?? false),
    createSession: (input) => client.createSession(input),
    updateSession: (id, patch) => client.updateSession(id, patch),
    deleteSession: async (id) => {
      await client.deleteSession(id);
    },
    getSettings: () => client.getSettings(),
    saveSettings: async (patch) => {
      await client.saveSettings(patch);
    },
    searchFiles: (root, q, limit) => client.searchFiles(root, q, limit ?? 30),
    readFile: (path, maxBytes) => client.readFile(path, maxBytes ?? 256 * 1024),
    writeFile: (path, content) => client.writeFile(path, content),
    mediaUrl: (absPath) => client.mediaUrl(absPath),
    postAudit: async (entry) => {
      await client.postAudit(entry);
    },
    listDangerousPatterns: async () => (await client.listDangerousPatterns()).patterns,
  };
}

/** 工厂：host 可达 → REST；否则 → localStorage 兜底 */
export function createWorkspaceApi(host: HostClient | null): WorkspaceApi {
  return host ? createHostApi(host) : createLocalApi();
}
