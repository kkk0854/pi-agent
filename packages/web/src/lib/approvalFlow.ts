/**
 * 审批流编排（T03）：ui.request 事件 → 策略判定 → 自动应答 / 弹条 / 超时兜底 / 审计。
 * 从 App.tsx 的事件订阅中调用 handleUiRequest；ApprovalBar 调用 resolveItem。
 */
import type { ExtensionUIRequest, ExtensionUIResponse, RiskLevel } from '@pi-agent/shared';
import { t } from '../i18n';
import { useAppStore } from '../store';
import { useApprovalStore, type PendingItem } from '../store/approvalStore';
import { getRuntime, getWorkspace } from '../runtime/runtimeRef';
import { isTauri, tauriInvoke } from '../host/tauriIpc';
import {
  parsePermissionRequest,
  permissionEngine,
  summarizeToolCall,
  type ApprovalAction,
} from './permissionEngine';
import { isWriteTool, pathOfWriteInput, buildChangeInput } from './changesPipeline';
import { useChangesStore } from '../features/changes/changesStore';

/** 审计上报（host 离线时静默丢弃；A-10 由 host 过 redact 后落 audit.jsonl） */
function postAudit(entry: {
  sessionId: string;
  toolName: string;
  argsSummary: string;
  tier: string;
  result: string;
  matchedPatternId: string | null;
  risk: RiskLevel;
}): void {
  const workspace = getWorkspace();
  if (!workspace?.online) return;
  void workspace.postAudit(entry).catch(() => undefined);
}

/**
 * 写盘前快照（T04b W-06..08）：审批扩展对写工具无条件发 confirm，
 * confirm 到达时文件尚未被写 → 立即读当前内容缓存为 original。
 */
export function snapshotForWrite(path: string): void {
  const workspace = getWorkspace();
  if (!workspace?.online) return;
  void workspace
    .readFile(path)
    .then((r) => useChangesStore.getState().setSnapshot(path, r.content))
    .catch(() => undefined);
}

/** tool.end（写工具）→ 读修改后内容 + 取快照 → 变更入列（读失败诚实跳过） */
export function recordWriteToolEnd(path: string): void {
  const workspace = getWorkspace();
  if (!workspace?.online) return;
  void workspace
    .readFile(path)
    .then((r) => {
      const original = useChangesStore.getState().takeSnapshot(path);
      const input = buildChangeInput({ toolName: 'write', path, original, modified: r.content });
      if (input) useChangesStore.getState().add(input);
    })
    .catch(() => undefined);
}

/** 会话生效档位（会话 > 项目 > 全局） */
function tierOf(sessionId: string): string {
  const st = useAppStore.getState();
  const session = st.sessions.find((s) => s.id === sessionId);
  return st.effectiveTier(sessionId, session?.projectId ?? null);
}

/** 应答并清理（含超时定时器） */
function respond(item: PendingItem, resp: ExtensionUIResponse): void {
  const runtime = getRuntime();
  useApprovalStore.getState().take(item.req.id);
  if (runtime) {
    void runtime.respondExtensionUI(item.sessionId, item.req.id, resp).catch(() => undefined);
  }
}

/** 审批超时兜底（A-14：默认 deny，可配 allow） */
function scheduleTimeout(item: PendingItem): void {
  const wait = Math.max(0, item.timeoutAt - Date.now());
  setTimeout(() => {
    const still = useApprovalStore.getState().items.find((i) => i.req.id === item.req.id);
    if (!still) return; // 已被用户处理
    const policy = useAppStore.getState().settings.approvalTimeoutPolicy;
    const allow = policy === 'allow';
    respond(still, { confirmed: allow });
    postAudit({
      sessionId: still.sessionId,
      toolName: still.toolName ?? '(extension-ui)',
      argsSummary: still.argsSummary ?? still.req.message ?? '',
      tier: still.tier ?? tierOf(still.sessionId),
      result: allow ? 'timeout-allow' : 'timeout-deny',
      matchedPatternId: still.matchedPatternId ?? null,
      risk: still.risk ?? 'normal',
    });
  }, wait);
}

/** 推送审批条条目（带风险与档位上下文） */
function pushApproval(sessionId: string, req: ExtensionUIRequest, payload: NonNullable<ReturnType<typeof parsePermissionRequest>>): void {
  const st = useAppStore.getState();
  const tier = tierOf(sessionId);
  const verdict = permissionEngine.evaluate(sessionId, tier as never, payload);
  const argsSummary = payload.summary ?? summarizeToolCall(payload.toolName, payload.input);
  const item: PendingItem = {
    sessionId,
    req,
    kind: 'approval',
    receivedAt: Date.now(),
    timeoutAt: Date.now() + (req.timeout ?? st.settings.uiRequestTimeoutMs),
    toolName: payload.toolName,
    argsSummary,
    risk: verdict.risk,
    tier,
    matchedPatternId: verdict.matched?.id ?? null,
    matchedDescription: verdict.matched?.description ?? null,
  };
  useApprovalStore.getState().push(item);
  scheduleTimeout(item);

  // A-09：桌面壳下挂起审批发系统通知；点击（窗口聚焦）经深链切到该会话
  if (isTauri()) {
    void tauriInvoke('notify', {
      title: t('notify.approvalTitle'),
      body: t('notify.approvalBody', { tool: payload.toolName, summary: argsSummary ?? '' }),
      sessionId,
    }).catch(() => undefined);
  }
}

/**
 * ui.request 事件入口（App 事件订阅调用）。
 * - 内置审批扩展的 confirm（title 标记）→ 策略引擎判定 → auto-allow / auto-deny / 弹条
 * - 其他扩展 UI → kind='ui' 入 store，由 ExtensionUIRenderer 应用内渲染（A-11）
 */
export function handleUiRequest(sessionId: string, req: ExtensionUIRequest): void {
  const payload = parsePermissionRequest(req);
  if (!payload) {
    const st = useAppStore.getState();
    useApprovalStore.getState().push({
      sessionId,
      req,
      kind: 'ui',
      receivedAt: Date.now(),
      timeoutAt: Date.now() + (req.timeout ?? st.settings.uiRequestTimeoutMs),
    });
    return;
  }

  const tier = tierOf(sessionId);
  const verdict = permissionEngine.evaluate(sessionId, tier as never, payload);

  // T04b：写工具先快照 original（写盘前），无论判定结果如何（deny 则快照自然作废）
  if (isWriteTool(payload.toolName)) {
    const p = pathOfWriteInput(payload.input);
    if (p) snapshotForWrite(p);
  }

  const auditBase = {
    sessionId,
    toolName: payload.toolName,
    argsSummary: payload.summary ?? summarizeToolCall(payload.toolName, payload.input),
    tier,
    matchedPatternId: verdict.matched?.id ?? null,
    risk: verdict.risk,
  };

  if (verdict.action === 'auto-allow') {
    postAudit({ ...auditBase, result: 'auto-allow' });
    const runtime = getRuntime();
    if (runtime) {
      void runtime.respondExtensionUI(sessionId, req.id, { confirmed: true }).catch(() => undefined);
    }
    return;
  }
  if (verdict.action === 'auto-deny') {
    postAudit({ ...auditBase, result: 'auto-deny' });
    const runtime = getRuntime();
    if (runtime) {
      void runtime.respondExtensionUI(sessionId, req.id, { confirmed: false }).catch(() => undefined);
    }
    return;
  }
  // 弹审批条（risk='risky' 命中危险清单 / ask 档常规写执行）
  postAudit({ ...auditBase, result: 'prompted' });
  pushApproval(sessionId, req, payload);
}

/** 用户决策（ApprovalBar 回调）：scope='session' 记忆本会话放行 */
export function resolveItem(requestId: string, decision: { allow: boolean; scope: 'once' | 'session' | 'deny' }): void {
  const item = useApprovalStore.getState().items.find((i) => i.req.id === requestId);
  if (!item) return;

  if (item.kind === 'approval') {
    const toolName = item.toolName ?? '(unknown)';
    if (decision.allow && decision.scope === 'session') {
      permissionEngine.allowSessionForTool(item.sessionId, toolName);
    }
    respond(item, { confirmed: decision.allow });
    postAudit({
      sessionId: item.sessionId,
      toolName,
      argsSummary: item.argsSummary ?? item.req.message ?? '',
      tier: item.tier ?? tierOf(item.sessionId),
      result: decision.allow ? (decision.scope === 'session' ? 'allow-session' : 'allow') : 'deny',
      matchedPatternId: item.matchedPatternId ?? null,
      risk: item.risk ?? 'normal',
    });
    return;
  }

  // 通用扩展 UI：取消即 cancelled（ExtensionUIRenderer 的提交走 respondExtensionUiValue）
  respond(item, { cancelled: true });
}

/** ExtensionUIRenderer 提交（select/input/editor/confirm 的应答） */
export function respondExtensionUiValue(requestId: string, resp: { value: string } | { confirmed: boolean } | { cancelled: true }): void {
  const item = useApprovalStore.getState().items.find((i) => i.req.id === requestId);
  if (!item) return;
  respond(item, resp);
}

/** 导出给 UI 层做动作标签（审批条按钮） */
export function actionLabel(a: ApprovalAction): string {
  switch (a) {
    case 'auto-allow':
      return '自动放行';
    case 'auto-deny':
      return '自动拒绝';
    default:
      return '待审批';
  }
}
