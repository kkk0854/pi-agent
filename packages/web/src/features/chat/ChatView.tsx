/**
 * ChatView：中栏主体（S-04 空态三选一 + 会话建立 + 事件接线 + 审批/错误条 + Composer）。
 * 取代 T01 的「开发预览」占位（切换条已按派工要求移除）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { IconFolderPlus, IconMessagePlus } from '@tabler/icons-react';
import { t } from '../../i18n';
import { useAppStore } from '../../store';
import { useChatStore } from '../../store/chatStore';
import { getRuntime, getWorkspace } from '../../runtime/runtimeRef';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ChatTimeline } from './ChatTimeline';
import { Composer } from './Composer';
import { ApprovalPanel } from './ExtensionUIRenderer';
import { useApprovalStore } from '../../store/approvalStore';
import { AddProjectDialog } from '../projects/AddProjectDialog';
import type { ImageAttachment } from '@pi-agent/shared';
import type { SessionStatus } from '@pi-agent/shared';

/** 会话状态 → 中文徽标文案 */
const STATUS_LABEL: Partial<Record<SessionStatus, string>> = {
  connecting: '连接中…',
  ready: '就绪',
  running: '运行中…',
  awaitingInput: '等待输入',
  compacting: '压缩中…',
  retrying: '重试中…',
  error: '出错了',
  closed: '已关闭',
};

export function ChatView() {
  const projects = useAppStore((s) => s.projects);
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const sessions = useAppStore((s) => s.sessions);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const upsertSession = useAppStore((s) => s.upsertSession);
  const effectiveTier = useAppStore((s) => s.effectiveTier);
  const runtimeMode = useAppStore((s) => s.runtimeMode);
  const runtimeReason = useAppStore((s) => s.runtimeReason);

  const messages = useChatStore((s) => s.messages);
  const status = useChatStore((s) => s.status);
  const error = useChatStore((s) => s.error);
  // A-09：挂起审批按会话索引（切走不丢，回来仍可处理）
  const pendingItems = useApprovalStore((s) => s.items).filter((i) => i.sessionId === currentSessionId);
  const statusText = useChatStore((s) => s.statusText);
  const lastUserText = useChatStore((s) => s.lastUserText);
  const setSession = useChatStore((s) => s.setSession);
  const appendUserMessage = useChatStore((s) => s.appendUserMessage);
  const clearError = useChatStore((s) => s.clearError);

  const [addOpen, setAddOpen] = useState(false);
  const openedRef = useRef<Set<string>>(new Set());
  const openingRef = useRef<string | null>(null);

  const currentProject = projects.find((p) => p.id === currentProjectId) ?? null;
  const currentSession = sessions.find((s) => s.id === currentSessionId) ?? null;

  /* 切会话 → 重置聊天区 */
  useEffect(() => {
    setSession(currentSessionId);
  }, [currentSessionId, setSession]);

  /* 打开会话（含幂等防抖） */
  useEffect(() => {
    const runtime = getRuntime();
    if (!currentSessionId || !runtime || !currentSession) return;
    if (openedRef.current.has(currentSessionId) || openingRef.current === currentSessionId) return;
    openingRef.current = currentSessionId;

    // P-02：未信任项目强制只读档
    const tier =
      currentProject && !currentProject.trusted ? 'read-only' : effectiveTier(currentSessionId, currentProjectId);
    runtime
      .openSession({
        appSessionId: currentSessionId,
        projectPath: currentProject?.path,
        permissionTier: tier,
        title: currentSession.title,
        piSessionPath: currentSession.piSessionPath,
        piSessionId: currentSession.piSessionId,
      })
      .then(async () => {
        openedRef.current.add(currentSessionId);
        // C-03：有历史 pi 会话路径时，恢复优先走 switch_session（而非重建进程上下文）
        if (currentSession.piSessionPath) {
          try {
            await runtime.switchSession(currentSessionId, currentSession.piSessionPath);
          } catch {
            // switch 失败不阻断：恢复路径不可用时退回当前新会话继续
          }
        }
        if (runtime.kind === 'host') {
          upsertSession({ ...currentSession, status: 'ready' });
        }
      })
      .catch((err: { message?: string }) => {
        useChatStore.getState().applyEvent({
          t: 'error',
          sessionId: currentSessionId,
          code: 'connect_timeout',
          message: err.message ?? '打开会话失败',
          recoverable: true,
        });
      })
      .finally(() => {
        openingRef.current = null;
      });
  }, [currentSessionId, currentSession, currentProject, currentProjectId, effectiveTier, upsertSession]);

  /* N-08 流式落盘节流：会话状态变更按 3s 节流回写（避免每帧打 host REST） */
  const lastPersistRef = useRef(0);
  useEffect(() => {
    if (!currentSessionId || !currentSession) return;
    const now = Date.now();
    if (now - lastPersistRef.current < 3000) return;
    lastPersistRef.current = now;
    const workspace = getWorkspace();
    if (!workspace?.online) return;
    void workspace.updateSession(currentSessionId, { status: status ?? 'idle' }).catch(() => undefined);
  }, [status, currentSessionId, currentSession]);

  /* 新建会话（优先挂到当前项目；未信任项目会话强制只读） */
  const createSession = useCallback(async (): Promise<void> => {
    const workspace = getWorkspace();
    if (!workspace) return;
    try {
      const session = await workspace.createSession({ projectId: currentProjectId });
      upsertSession(session);
      setCurrentSession(session.id);
    } catch (err) {
      // 创建失败静默降级为本地临时会话（保证可演示）
      const fallback = {
        id: `tmp-${Date.now()}`,
        projectId: currentProjectId,
        title: t('session.new'),
        status: 'idle' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      upsertSession(fallback);
      setCurrentSession(fallback.id);
      void err;
    }
  }, [currentProjectId, setCurrentSession, upsertSession]);

  /* 发送 */
  const handleSend = useCallback(
    (text: string, images: ImageAttachment[]): void => {
      const runtime = getRuntime();
      if (!runtime || !currentSessionId) return;
      appendUserMessage(text || `[图片 ×${images.length}]`);
      void runtime.send({
        sessionId: currentSessionId,
        text: text || '[图片]',
        images: images.length > 0 ? images : undefined,
      });
    },
    [currentSessionId, appendUserMessage],
  );

  const handleStop = useCallback((): void => {
    const runtime = getRuntime();
    if (runtime && currentSessionId) void runtime.abort(currentSessionId);
  }, [currentSessionId]);

  const handleRegenerate = useCallback((): void => {
    const runtime = getRuntime();
    if (runtime && currentSessionId && lastUserText) {
      void runtime.send({ sessionId: currentSessionId, text: lastUserText });
    }
  }, [currentSessionId, lastUserText]);

  const handleSlash = useCallback(
    (name: string): void => {
      const runtime = getRuntime();
      if (!runtime || !currentSessionId) return;
      if (name === 'clear') {
        setSession(currentSessionId);
        return;
      }
      if (name === 'compact') {
        void runtime.compact(currentSessionId);
        return;
      }
      // 其余斜杠命令透传为 prompt（X-01 雏形）
      void runtime.send({ sessionId: currentSessionId, text: `/${name}` });
    },
    [currentSessionId, setSession],
  );

  /* ---------- 空态分流（S-04） ---------- */
  if (projects.length === 0) {
    return (
      <div className="flex h-full flex-col">
        {runtimeMode === 'mock' && runtimeReason ? <ReasonBanner reason={runtimeReason} /> : null}
        <EmptyState
          className="flex-1"
          icon={<IconFolderPlus stroke={1.5} />}
          title={t('empty.noProject.title')}
          description={t('empty.noProject.desc')}
          action={
            <Button variant="primary" onClick={() => setAddOpen(true)}>
              {t('empty.noProject.action')}
            </Button>
          }
        />
        <AddProjectDialog open={addOpen} onOpenChange={setAddOpen} />
      </div>
    );
  }

  if (!currentSessionId) {
    return (
      <div className="flex h-full flex-col">
        {runtimeMode === 'mock' && runtimeReason ? <ReasonBanner reason={runtimeReason} /> : null}
        <EmptyState
          className="flex-1"
          icon={<IconMessagePlus stroke={1.5} />}
          title={t('empty.noSession.title')}
          description={t('empty.noSession.desc')}
          action={
            <Button variant="primary" onClick={() => void createSession()}>
              {t('empty.noSession.action')}
            </Button>
          }
        />
      </div>
    );
  }

  /* ---------- 会话主体 ---------- */
  const statusEntries = Object.entries(statusText);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {runtimeMode === 'mock' && runtimeReason ? <ReasonBanner reason={runtimeReason} /> : null}

      {/* 状态条 */}
      <div className="flex h-7 shrink-0 items-center gap-3 border-b border-line px-4 text-[11px] text-muted">
        <span>{currentSession?.title ?? t('session.new')}</span>
        {status ? (
          <span className={status === 'error' ? 'text-danger' : status === 'running' ? 'text-accent' : ''}>
            {STATUS_LABEL[status] ?? status}
          </span>
        ) : null}
        {currentProject && !currentProject.trusted ? (
          <span className="rounded-full border border-warning/50 px-1.5 text-warning">未信任 · 只读</span>
        ) : null}
        {statusEntries.map(([k, v]) => (
          <span key={k}>{v}</span>
        ))}
      </div>

      {/* 错误条（四类错误文案互不混淆，来自 shared） */}
      {error ? (
        <div className="mx-4 mt-2 flex items-start gap-2 rounded-card border border-danger/50 bg-danger/5 px-3 py-2 text-xs text-danger">
          <span className="flex-1">{error.message}</span>
          {error.recoverable ? (
            <Button size="sm" variant="danger" onClick={clearError}>
              {t('common.close')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* 审批条 / 扩展 UI（A-02/A-11：绝不 window.confirm；A-09 来自 approvalStore） */}
      <ApprovalPanel items={pendingItems} />

      {/* 消息时间线 / 空消息提示 */}
      <div className="min-h-0 flex-1 overflow-auto">
        {messages.length === 0 ? (
          <EmptyState title={t('empty.noMessage.title')} description={t('empty.noMessage.desc')} />
        ) : (
          <ChatTimeline messages={messages} />
        )}
      </div>

      <Composer
        disabled={runtimeMode === null}
        running={status === 'running'}
        sessionId={currentSessionId}
        projectPath={currentProject?.path ?? null}
        onSend={handleSend}
        onStop={handleStop}
        onRegenerate={handleRegenerate}
        onSlashCommand={handleSlash}
      />
    </div>
  );
}

/** 降级 / 引导横幅（host 未运行 → Mock 模式徽章与引导文案） */
function ReasonBanner({ reason }: { reason: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-line bg-warning/5 px-4 py-1.5 text-xs text-warning">
      <span className="rounded-full border border-warning/50 px-1.5 py-0.5 font-medium">{t('app.mockBadge')}</span>
      <span className="min-w-0 flex-1 truncate" title={reason}>
        {reason}
      </span>
    </div>
  );
}
