/**
 * 本地 REST 会话 API（T04b 步骤 4 · E-01..E-04 · C-05 幂等骨架）：
 * - GET  /v1/host/meta            令牌文件位置等元信息（E-01：设置页「打开令牌文件位置」）
 * - GET  /v1/sessions/:id         会话详情（AppSession + 实时通道状态）
 * - POST /v1/sessions/:id/turns   追加一轮（E-04）：
 *     返回 status ∈ turn_started / queued / not_found / retry_later / error
 *     会话忙（已有在途 REST 轮次）→ 仍投递但标记 queued（streamingBehavior=followUp，
 *     pi 侧入跟进队列不打断当前轮）。
 * - 幂等键（C-05 骨架）：Idempotency-Key 头或 body.idempotencyKey；
 *   同键重放返回首次响应（replayed:true），不重复投递 prompt。
 * health（E-02）与会话列表（E-03）分别在 server/http.ts 与 routes.workspace.ts。
 */
import type { FastifyInstance } from 'fastify';
import type { AppSession, OpenSessionRequest } from '@pi-agent/shared';
import type { WorkspaceStore } from './workspaceStore';
import type { SessionManager } from '../runtime/SessionManager';
import { hostJsonPath, type AppDirs } from '../config/paths';
import { HOST_VERSION } from '../version';

export interface SessionApiDeps {
  store: WorkspaceStore;
  manager: SessionManager;
  dirs: AppDirs;
  logger: { info(msg: string, fields?: Record<string, unknown>): void; warn(msg: string, fields?: Record<string, unknown>): void };
  /** REST 追加轮次的默认权限档（auto-open 时使用；不影响 UI 内会话的档位） */
  defaultTier?: OpenSessionRequest['permissionTier'];
}

/** 在途 REST 轮次窗口：窗口内的第二次投递标记 queued */
const INFLIGHT_WINDOW_MS = 30_000;
/** 幂等缓存上限（超过后按插入序淘汰） */
const IDEMPOTENCY_CAP = 200;

interface TurnResponse {
  status: 'turn_started' | 'queued' | 'not_found' | 'retry_later' | 'error';
  turnId?: string;
  sessionId?: string;
  detail?: string;
}

export function registerSessionApi(app: FastifyInstance, deps: SessionApiDeps): void {
  const { store, manager, dirs, logger } = deps;

  /** 幂等缓存：key → (httpStatus, body) */
  const idempotencyCache = new Map<string, { code: number; body: TurnResponse }>();
  /** 在途 REST 轮次：appSessionId → 最近投递时间 */
  const inflightTurns = new Map<string, number>();

  const remember = (key: string, code: number, body: TurnResponse): void => {
    if (idempotencyCache.size >= IDEMPOTENCY_CAP) {
      const oldest = idempotencyCache.keys().next().value;
      if (oldest !== undefined) idempotencyCache.delete(oldest);
    }
    idempotencyCache.set(key, { code, body });
  };

  /* ---------- E-01：host 元信息（令牌文件位置等） ---------- */

  app.get('/v1/host/meta', async () => {
    return {
      version: HOST_VERSION,
      dataDir: dirs.root,
      tokenFile: hostJsonPath(dirs),
      startedAt: new Date().toISOString(),
    };
  });

  /* ---------- 会话详情 ---------- */

  app.get<{ Params: { id: string } }>(
    '/v1/sessions/:id',
    async (request, reply): Promise<Record<string, unknown> | undefined> => {
      const session = store
        .listSessions({ includeArchived: true })
        .find((s) => s.id === request.params.id);
      if (!session) {
        void reply.code(404);
        return undefined;
      }
      const live = manager.get(session.id);
      return {
        ...session,
        channel: live
          ? { status: live.status, attached: live.attached, pid: live.pid ?? null, startedAt: live.startedAt }
          : null,
      };
    },
  );

  /* ---------- E-04：追加一轮 ---------- */

  app.post<{ Params: { id: string }; Body: { prompt?: string; idempotencyKey?: string } }>(
    '/v1/sessions/:id/turns',
    async (request, reply): Promise<TurnResponse | undefined> => {
      const { id } = request.params;
      const body = request.body ?? {};
      const prompt = typeof body.prompt === 'string' ? body.prompt : '';
      if (prompt.trim().length === 0) {
        void reply.code(400);
        return { status: 'error', detail: 'prompt 必填' };
      }
      const headerKey = request.headers['idempotency-key'];
      const key = typeof headerKey === 'string' && headerKey.length > 0 ? headerKey : body.idempotencyKey;

      // C-05 幂等骨架：同键重放首次响应
      if (key && idempotencyCache.has(key)) {
        const cached = idempotencyCache.get(key)!;
        void reply.code(cached.code);
        return { ...cached.body, detail: `${cached.body.detail ?? ''}（幂等重放）`.trim() };
      }

      const respond = (code: number, resp: TurnResponse): TurnResponse => {
        void reply.code(code);
        if (key) remember(key, code, resp);
        return resp;
      };

      const session = store.listSessions({ includeArchived: true }).find((s) => s.id === id);
      if (!session) {
        return respond(404, { status: 'not_found', sessionId: id, detail: '会话不存在' });
      }

      // 会话未连接 → 尽力自动拉起（恢复 piSessionPath），失败则 retry_later
      const live = manager.get(id);
      if (!live || live.status === 'closed' || live.status === 'error') {
        try {
          const project = session.projectId
            ? store.listProjects().find((p) => p.id === session.projectId)
            : undefined;
          const openReq: OpenSessionRequest = {
            appSessionId: id,
            ...(project ? { projectPath: project.path } : {}),
            ...(session.piSessionPath ? { piSessionPath: session.piSessionPath } : {}),
            ...(session.piSessionId ? { piSessionId: session.piSessionId } : {}),
            title: session.title,
            permissionTier: deps.defaultTier ?? 'notify-on-risky',
          };
          manager.open(id, openReq);
          logger.info('REST 追加轮次：会话已自动拉起', { appSessionId: id });
        } catch (err) {
          logger.warn('REST 追加轮次：会话拉起失败', {
            appSessionId: id,
            message: err instanceof Error ? err.message : String(err),
          });
          return respond(503, {
            status: 'retry_later',
            sessionId: id,
            detail: '会话未连接且自动拉起失败，请在应用内打开会话后重试',
          });
        }
      }

      // busy 判定（骨架）：窗口内已有 REST 投递 → queued（pi 以 followUp 入队，不打断）
      const lastSent = inflightTurns.get(id);
      const busy = lastSent !== undefined && Date.now() - lastSent < INFLIGHT_WINDOW_MS;

      const turnId = `turn-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const line = JSON.stringify({
        id: turnId,
        type: 'prompt',
        message: prompt,
        // 协议约束 3：显式 streamingBehavior，忙时入跟进队列
        streamingBehavior: 'followUp',
      });
      const ok = manager.write(id, line);
      if (!ok) {
        return respond(503, {
          status: 'retry_later',
          sessionId: id,
          detail: '会话通道暂不可写（进程未就绪或已退出）',
        });
      }
      inflightTurns.set(id, Date.now());
      logger.info('REST 追加轮次已投递', { appSessionId: id, turnId, queued: busy });
      return respond(202, {
        status: busy ? 'queued' : 'turn_started',
        turnId,
        sessionId: id,
      });
    },
  );
}

/** 供单测：从 AppSession 合成 auto-open 请求（导出以便复用与测试） */
export function buildAutoOpenRequest(
  session: AppSession,
  projectPath: string | undefined,
  defaultTier: OpenSessionRequest['permissionTier'] = 'notify-on-risky',
): OpenSessionRequest {
  return {
    appSessionId: session.id,
    ...(projectPath ? { projectPath } : {}),
    ...(session.piSessionPath ? { piSessionPath: session.piSessionPath } : {}),
    ...(session.piSessionId ? { piSessionId: session.piSessionId } : {}),
    title: session.title,
    permissionTier: defaultTier,
  };
}
