/**
 * HostClient：host REST 客户端（全部带令牌头；非 2xx 抛带状态码的 Error）。
 */
import type {
  AppSession,
  Automation,
  AutomationRun,
  DangerousPattern,
  DoctorReport,
  GitWorktree,
  HealthInfo,
  Project,
  SecretMeta,
  Settings,
  UsageSummary,
  HostEndpoint,
} from '@pi-agent/shared';

/** 镜像信息（与 host GET /v1/mirror/info 对齐） */
export interface MirrorInfo {
  version: string;
  writeEnabled: boolean;
  connections: number;
  /** 局域网地址（含镜像令牌；null = 无可用网卡或未监听） */
  lanUrl: string | null;
  localUrl: string | null;
}

/** 镜像审计条目（host 端已脱敏，不含令牌明文） */
export interface MirrorAuditEntry {
  at: string;
  kind: 'connect' | 'disconnect' | 'write' | 'write-denied' | 'acl-on' | 'acl-off' | 'token-rotate';
  detail: string;
}

/** 扩展信息（与 host GET /v1/extensions 对齐） */
export interface ExtensionInfo {
  id: string;
  name: string;
  enabled: boolean;
  scope: 'global';
  source: 'builtin' | 'user';
  path: string;
  description: string | null;
}

/** REST 追加轮次响应（与 host sessionApi.ts 对齐） */
export interface TurnResponse {
  status: 'turn_started' | 'queued' | 'not_found' | 'retry_later' | 'error';
  turnId?: string;
  sessionId?: string;
  detail?: string;
}

export class HostApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HostApiError';
  }
}

export class HostClient {
  constructor(private readonly endpoint: HostEndpoint) {}

  /** 供 HostBridge 的 HTTP 委托复用（TauriHostBridge 的 fs/workspace 直连用） */
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.endpoint.httpUrl}${path}`, {
      ...init,
      headers: {
        // 仅在确有 body 时声明 JSON：无 body 的 POST 若带该头，Fastify 会把空 body 当
        // 非法 JSON 解析并返回 400（FST_ERR_CTP_EMPTY_JSON_BODY）
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        'x-pi-agent-token': this.endpoint.token,
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new HostApiError(res.status, `${init.method ?? 'GET'} ${path} → ${res.status}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /* 健康 */
  async health(): Promise<HealthInfo> {
    return this.request<HealthInfo>('/v1/health');
  }

  /** 探活：host 不可达（404/拒绝/超时）返回 null —— createRuntime 引导分支依据 */
  static async tryHealth(endpoint: HostEndpoint, timeoutMs = 2000): Promise<HealthInfo | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${endpoint.httpUrl}/v1/health`, {
        headers: { 'x-pi-agent-token': endpoint.token },
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      return (await res.json()) as HealthInfo;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /* 项目 */
  listProjects(): Promise<Project[]> {
    return this.request<Project[]>('/v1/projects');
  }
  addProject(input: { path: string; name?: string; trusted: boolean }): Promise<Project> {
    return this.request<Project>('/v1/projects', { method: 'POST', body: JSON.stringify(input) });
  }
  updateProject(id: string, patch: Partial<Project>): Promise<Project> {
    return this.request<Project>(`/v1/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }
  trustProject(id: string): Promise<Project> {
    return this.request<Project>(`/v1/projects/${id}/trust`, { method: 'POST' });
  }
  removeProject(id: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/v1/projects/${id}`, { method: 'DELETE' });
  }

  /* 会话 */
  listSessions(includeArchived = false): Promise<AppSession[]> {
    return this.request<AppSession[]>(`/v1/sessions?includeArchived=${includeArchived ? 1 : 0}`);
  }
  createSession(input: Partial<AppSession>): Promise<AppSession> {
    return this.request<AppSession>('/v1/sessions', { method: 'POST', body: JSON.stringify(input) });
  }
  updateSession(id: string, patch: Partial<AppSession>): Promise<AppSession> {
    return this.request<AppSession>(`/v1/sessions/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }
  deleteSession(id: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/v1/sessions/${id}`, { method: 'DELETE' });
  }

  /* 设置 */
  getSettings(): Promise<Settings> {
    return this.request<Settings>('/v1/settings');
  }
  saveSettings(patch: Partial<Settings>): Promise<Settings> {
    return this.request<Settings>('/v1/settings', { method: 'PUT', body: JSON.stringify(patch) });
  }

  /* 文件 */
  searchFiles(root: string, q: string, limit = 30): Promise<string[]> {
    const qs = new URLSearchParams({ root, q, limit: String(limit) });
    return this.request<string[]>(`/v1/fs/search?${qs.toString()}`);
  }

  /** 读文本文件（内置编辑器 / Diff 面板用，上限默认 256KB） */
  readFile(path: string, maxBytes = 256 * 1024): Promise<{ content: string; truncated: boolean }> {
    const qs = new URLSearchParams({ path, max: String(maxBytes) });
    return this.request<{ content: string; truncated: boolean }>(`/v1/fs/read?${qs.toString()}`);
  }

  /**
   * 写文本文件（变更面板「还原」用，T04b）。
   * host 侧仅允许写入受信任项目目录内路径（其余 403），不绕过治理。
   */
  writeFile(path: string, content: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>('/v1/fs/write', {
      method: 'PUT',
      body: JSON.stringify({ path, content }),
    });
  }

  /* 媒体回环 URL */
  mediaUrl(absPath: string): string {
    return `${this.endpoint.httpUrl}/v1/media?t=${encodeURIComponent(this.endpoint.token)}&p=${encodeURIComponent(absPath)}`;
  }

  /* ---------- T03 治理域 ---------- */

  /** 审计上报（A-10） */
  postAudit(entry: {
    sessionId: string;
    toolName: string;
    argsSummary: string;
    tier: string;
    result: string;
    matchedPatternId: string | null;
    risk: string;
  }): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>('/v1/audit', { method: 'POST', body: JSON.stringify(entry) });
  }

  listAudit(limit = 500): Promise<{ entries: unknown[]; total: number }> {
    return this.request<{ entries: unknown[]; total: number }>(`/v1/audit?limit=${limit}`);
  }

  /** 危险清单（A-13：host 合并默认 + 自定义下发） */
  listDangerousPatterns(): Promise<{ patterns: DangerousPattern[] }> {
    return this.request<{ patterns: DangerousPattern[] }>('/v1/permissions/dangerous');
  }
  addDangerousPattern(input: { category?: string; pattern: string; description?: string }): Promise<DangerousPattern> {
    return this.request<DangerousPattern>('/v1/permissions/dangerous', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  removeDangerousPattern(id: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/v1/permissions/dangerous/${id}`, { method: 'DELETE' });
  }

  /** 诊断（V-02） */
  doctor(): Promise<DoctorReport> {
    return this.request<DoctorReport>('/v1/doctor');
  }

  /** Git 分支 chip（G-01） */
  listWorktrees(projectPath: string): Promise<{ worktrees: GitWorktree[] }> {
    const qs = new URLSearchParams({ path: projectPath });
    return this.request<{ worktrees: GitWorktree[] }>(`/v1/git/worktrees?${qs.toString()}`);
  }

  /** 用量（Q-04） */
  postUsage(record: {
    sessionId: string;
    projectId: string | null;
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
    cost: number;
  }): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>('/v1/usage', { method: 'POST', body: JSON.stringify(record) });
  }
  usageSummary(): Promise<UsageSummary> {
    return this.request<UsageSummary>('/v1/usage/summary');
  }

  /** 自动化（U-01..U-06） */
  listAutomations(): Promise<{ automations: Automation[]; history: AutomationRun[] }> {
    return this.request<{ automations: Automation[]; history: AutomationRun[] }>('/v1/automations');
  }
  createAutomation(input: Partial<Automation>): Promise<Automation> {
    return this.request<Automation>('/v1/automations', { method: 'POST', body: JSON.stringify(input) });
  }
  updateAutomation(id: string, patch: Partial<Automation>): Promise<Automation> {
    return this.request<Automation>(`/v1/automations/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }
  deleteAutomation(id: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/v1/automations/${id}`, { method: 'DELETE' });
  }

  /** 密钥存管（原文永不回传） */
  listSecrets(): Promise<{ secrets: SecretMeta[] }> {
    return this.request<{ secrets: SecretMeta[] }>('/v1/secrets');
  }
  saveSecret(key: string, value: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/v1/secrets/${key}`, { method: 'PUT', body: JSON.stringify({ value }) });
  }
  deleteSecret(key: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/v1/secrets/${key}`, { method: 'DELETE' });
  }

  /* ---------- T04b：镜像 / 扩展 / worktree ---------- */

  /** 镜像信息（局域网地址 + 写 ACL 状态；二维码由前端生成） */
  mirrorInfo(): Promise<MirrorInfo> {
    return this.request<MirrorInfo>('/v1/mirror/info');
  }
  /** 镜像写 ACL 开关（默认关；每次变更留审计） */
  setMirrorWriteAcl(enabled: boolean): Promise<{ writeEnabled: boolean }> {
    return this.request<{ writeEnabled: boolean }>('/v1/mirror/write-acl', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    });
  }
  rotateMirrorToken(): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>('/v1/mirror/rotate-token', { method: 'POST' });
  }
  mirrorAudit(): Promise<{ entries: MirrorAuditEntry[] }> {
    return this.request<{ entries: MirrorAuditEntry[] }>('/v1/mirror/audit');
  }

  /** 扩展列表（X-03：builtin + user 扫描，含启用态） */
  listExtensions(): Promise<{ extensions: ExtensionInfo[] }> {
    return this.request<{ extensions: ExtensionInfo[] }>('/v1/extensions');
  }
  /** 启用/停用扩展（持久化到 appData/extensions.json） */
  setExtensionEnabled(id: string, enabled: boolean): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/v1/extensions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
  }

  /** 创建 worktree（G-02） */
  createWorktree(input: {
    projectPath: string;
    name: string;
    location: 'cli-home' | 'sibling';
    startPoint?: string;
  }): Promise<{ path: string; branch: string }> {
    return this.request<{ path: string; branch: string }>('/v1/git/worktrees', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  /** 绑定 worktree 到会话（写入 AppSession.worktreePath，G-01） */
  bindWorktree(sessionId: string, worktreePath: string): Promise<AppSession> {
    return this.request<AppSession>('/v1/git/worktrees/bind', {
      method: 'POST',
      body: JSON.stringify({ sessionId, worktreePath }),
    });
  }

  /** 本地 REST：追加一轮（E-04；status ∈ turn_started/queued/not_found/retry_later/error） */
  appendTurn(sessionId: string, prompt: string, idempotencyKey?: string): Promise<TurnResponse> {
    return this.request<TurnResponse>(`/v1/sessions/${encodeURIComponent(sessionId)}/turns`, {
      method: 'POST',
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
      body: JSON.stringify({ prompt }),
    });
  }
}
