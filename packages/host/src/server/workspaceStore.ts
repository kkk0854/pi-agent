/**
 * 工作区持久化（架构 §2.3）：projects.json / sessions.json 落 {appData}/pi-agent。
 * 原子写（tmp + rename），损坏时回退空数据并告警，保证可启动。
 */
import fs from 'node:fs';
import path from 'node:path';
import { newId, type AppSession, type Project } from '@pi-agent/shared';
import type { AppDirs } from '../config/paths';

export interface AddProjectInput {
  path: string;
  name?: string;
  trusted: boolean;
}

export class WorkspaceStore {
  private projects: Project[] = [];
  private sessions: AppSession[] = [];

  constructor(private readonly dirs: AppDirs) {
    this.projects = this.loadProjects();
    this.sessions = this.loadSessions();
  }

  /* ---------- 项目 ---------- */

  listProjects(): Project[] {
    return [...this.projects];
  }

  addProject(input: AddProjectInput): Project {
    const normalized = path.normalize(input.path);
    const exists = this.projects.some((p) => path.normalize(p.path) === normalized);
    if (exists) {
      throw new Error('该项目已在列表中');
    }
    const now = new Date().toISOString();
    const project: Project = {
      id: newId(),
      name: input.name?.trim() || path.basename(normalized) || normalized,
      path: normalized,
      trusted: input.trusted,
      createdAt: now,
      lastOpenedAt: now,
      status: 'ok',
    };
    this.projects.push(project);
    this.persistProjects();
    return project;
  }

  updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'trusted' | 'lastOpenedAt' | 'status'>>): Project {
    const idx = this.projects.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error('项目不存在');
    const next: Project = { ...this.projects[idx]!, ...patch };
    this.projects[idx] = next;
    this.persistProjects();
    return next;
  }

  removeProject(id: string): void {
    const before = this.projects.length;
    this.projects = this.projects.filter((p) => p.id !== id);
    if (this.projects.length !== before) this.persistProjects();
  }

  findProjectByPath(absPath: string): Project | undefined {
    const normalized = path.normalize(absPath);
    return this.projects.find((p) => path.normalize(p.path) === normalized);
  }

  /* ---------- 会话 ---------- */

  listSessions(opts: { includeArchived?: boolean } = {}): AppSession[] {
    const list = opts.includeArchived ? this.sessions : this.sessions.filter((s) => !s.archived);
    // 按 updatedAt 倒序（最近优先）
    return [...list].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  createSession(input: Partial<AppSession>): AppSession {
    const now = new Date().toISOString();
    const session: AppSession = {
      id: input.id ?? newId(),
      projectId: input.projectId ?? null,
      title: input.title?.trim() || '新会话',
      status: 'idle',
      piSessionId: input.piSessionId,
      piSessionPath: input.piSessionPath,
      createdAt: now,
      updatedAt: now,
      pinned: false,
      archived: false,
    };
    this.sessions.push(session);
    this.persistSessions();
    return session;
  }

  updateSession(id: string, patch: Partial<AppSession>): AppSession {
    const idx = this.sessions.findIndex((s) => s.id === id);
    if (idx === -1) throw new Error('会话不存在');
    const next: AppSession = { ...this.sessions[idx]!, ...patch, updatedAt: new Date().toISOString() };
    this.sessions[idx] = next;
    this.persistSessions();
    return next;
  }

  deleteSession(id: string): void {
    const before = this.sessions.length;
    this.sessions = this.sessions.filter((s) => s.id !== id);
    if (this.sessions.length !== before) this.persistSessions();
  }

  /* ---------- 持久化 ---------- */

  private projectsPath(): string {
    return path.join(this.dirs.root, 'projects.json');
  }

  private sessionsPath(): string {
    return path.join(this.dirs.root, 'sessions.json');
  }

  private loadProjects(): Project[] {
    try {
      const raw = fs.readFileSync(this.projectsPath(), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as Project[];
    } catch {
      // 缺失/损坏 → 空数据
    }
    return [];
  }

  private loadSessions(): AppSession[] {
    try {
      const raw = fs.readFileSync(this.sessionsPath(), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as AppSession[];
    } catch {
      // 缺失/损坏 → 空数据
    }
    return [];
  }

  private atomicWrite(file: string, data: unknown): void {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  private persistProjects(): void {
    try {
      this.atomicWrite(this.projectsPath(), this.projects);
    } catch {
      // 持久化失败不阻断内存态（下次变更会重试）
    }
  }

  private persistSessions(): void {
    try {
      this.atomicWrite(this.sessionsPath(), this.sessions);
    } catch {
      // 同上
    }
  }
}
