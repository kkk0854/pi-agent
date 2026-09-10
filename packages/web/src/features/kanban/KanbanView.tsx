/**
 * 看板四列（K-01/K-02）：需要我处理 / 正在执行 / 已完成 / 空闲。
 * 实时归类：挂起审批（A-09）> 活动状态（activityStore）> 其余空闲。
 * 卡片直达：点击 → 选中会话并回到聊天视图。
 */
import { useMemo, type ReactNode } from 'react';
import { IconAlertTriangle, IconPlayerPlay, IconCheck, IconMoon } from '@tabler/icons-react';
import { t } from '../../i18n';
import { useAppStore } from '../../store';
import { useApprovalStore } from '../../store/approvalStore';
import { useActivityStore } from '../../store/activityStore';

export function KanbanView() {
  const sessions = useAppStore((s) => s.sessions);
  const projects = useAppStore((s) => s.projects);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const setMainView = useAppStore((s) => s.setMainView);
  const approvals = useApprovalStore((s) => s.items);
  const activity = useActivityStore((s) => s.bySession);

  const columns = useMemo(() => {
    const projectName = (projectId: string | null): string =>
      projects.find((p) => p.id === projectId)?.name ?? '默认工作区';
    const pending = new Set(approvals.map((a) => a.sessionId));

    const buckets: { id: 'todo' | 'running' | 'done' | 'idle'; title: string; icon: ReactNode; sessions: typeof sessions }[] = [
      { id: 'todo', title: '需要我处理', icon: <IconAlertTriangle size={14} className="text-warning" />, sessions: [] },
      { id: 'running', title: '正在执行', icon: <IconPlayerPlay size={14} className="text-accent" />, sessions: [] },
      { id: 'done', title: '已完成', icon: <IconCheck size={14} className="text-success" />, sessions: [] },
      { id: 'idle', title: '空闲', icon: <IconMoon size={14} className="text-secondary" />, sessions: [] },
    ];
    for (const s of sessions) {
      if (s.archived) continue;
      if (pending.has(s.id)) buckets[0]!.sessions.push(s);
      else if (activity[s.id] === 'running') buckets[1]!.sessions.push(s);
      else if (activity[s.id] === 'ready') buckets[2]!.sessions.push(s);
      else buckets[3]!.sessions.push(s);
    }
    return buckets.map((b) => ({ ...b, projectName }));
  }, [sessions, projects, approvals, activity]);

  const open = (id: string): void => {
    setCurrentSession(id);
    setMainView('chat');
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="border-b border-line px-4 py-2 text-sm font-medium text-text">{t('kanban.title')}</div>
      <div className="grid min-h-0 flex-1 grid-cols-4 gap-3 overflow-auto p-3" data-testid="kanban">
        {columns.map((col) => (
          <div key={col.id} className="flex min-h-0 flex-col rounded-card border border-line bg-bg-secondary">
            <div className="flex items-center gap-1.5 border-b border-line px-2.5 py-2 text-xs font-medium text-text">
              {col.icon}
              <span>{col.title}</span>
              <span className="ml-auto text-secondary">{col.sessions.length}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {col.sessions.length === 0 ? (
                <div className="px-1 py-2 text-[11px] text-muted">{t('kanban.empty')}</div>
              ) : (
                col.sessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => open(s.id)}
                    className={`mb-1.5 w-full rounded-md border px-2 py-1.5 text-left transition-colors hover:bg-bg-tertiary ${
                      s.id === currentSessionId ? 'border-accent' : 'border-line'
                    }`}
                  >
                    <div className="truncate text-xs text-text">{s.title || '新会话'}</div>
                    <div className="truncate text-[11px] text-muted">{col.projectName(s.projectId)}</div>
                  </button>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
