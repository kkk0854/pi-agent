/**
 * 左栏（PRD §9.2）：搜索 + 项目/会话树 + 入口区 + 底部操作与宿主状态。
 * T02：项目树与会话列表由 store 驱动（host REST / localStorage 双轨）；
 * 异常项目标红（P-04）；未信任项目带标记（P-02）。
 */
import { useMemo, useState } from 'react';
import {
  IconArchive,
  IconCalendarClock,
  IconFolder,
  IconFolderPlus,
  IconLayoutKanban,
  IconMessage,
  IconPinFilled,
  IconPlus,
  IconSearch,
  IconSettings,
} from '@tabler/icons-react';
import { t } from '../../i18n';
import { cn } from '../../lib/cn';
import { useAppStore } from '../../store';
import { Button } from '../../components/ui/Button';
import { Tooltip } from '../../components/ui/Tooltip';
import { AddProjectDialog } from '../projects/AddProjectDialog';
import type { AppSession, Project } from '@pi-agent/shared';

export function Sidebar() {
  const projects = useAppStore((s) => s.projects);
  const sessions = useAppStore((s) => s.sessions);
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const hostOnline = useAppStore((s) => s.hostOnline);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const mainView = useAppStore((s) => s.mainView);
  const setMainView = useAppStore((s) => s.setMainView);
  const upsertSession = useAppStore((s) => s.upsertSession);

  const [keyword, setKeyword] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const filteredProjects = useMemo(
    () => projects.filter((p) => p.name.toLowerCase().includes(keyword.toLowerCase())),
    [projects, keyword],
  );

  const sessionsOf = (projectId: string | null): AppSession[] =>
    // C-06：固定会话置顶（组内保持原有顺序）
    sessions
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  const newSession = async (): Promise<void> => {
    const workspace = (await import('../../runtime/runtimeRef')).getWorkspace();
    if (!workspace) return;
    try {
      const session = await workspace.createSession({ projectId: currentProjectId });
      upsertSession(session);
      setCurrentSession(session.id);
    } catch {
      // 创建失败保持现状（Toast 在 ChatView 主路径上提示）
    }
  };

  if (sidebarCollapsed) return null;

  return (
    <aside className="flex h-full min-h-0 flex-col bg-panel">
      {/* 搜索 */}
      <div className="p-2.5">
        <div className="flex items-center gap-1.5 rounded-[6px] border border-line bg-bg px-2 py-1.5 text-sm text-muted">
          <IconSearch size={14} />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={t('sidebar.searchPlaceholder')}
            className="w-full bg-transparent text-text outline-none placeholder:text-muted"
          />
        </div>
      </div>

      {/* 项目/会话树 */}
      <div className="min-h-0 flex-1 overflow-auto px-2.5">
        <div className="mb-1 text-xs font-medium text-muted">{t('sidebar.projects')}</div>
        {filteredProjects.length === 0 ? (
          <div className="rounded-[6px] border border-dashed border-line px-3 py-4 text-xs text-muted">
            {projects.length === 0 ? t('sidebar.noProjects') : t('sidebar.noMatch')}
          </div>
        ) : (
          <div className="space-y-0.5">
            {filteredProjects.map((p) => (
              <ProjectNode
                key={p.id}
                project={p}
                active={p.id === currentProjectId}
                sessions={sessionsOf(p.id)}
                currentSessionId={currentSessionId}
                onSelect={() => setCurrentProject(p.id)}
                onSelectSession={setCurrentSession}
              />
            ))}
            {/* 默认工作区（projectId=null 的会话） */}
            <SessionList
              label={t('sidebar.defaultWorkspace')}
              sessions={sessionsOf(null)}
              currentSessionId={currentSessionId}
              onSelectSession={setCurrentSession}
              defaultOpen={true}
            />
          </div>
        )}
      </div>

      {/* 入口区 */}
      <div className="border-t border-line px-2.5 py-1.5">
        <button
          type="button"
          onClick={() => setMainView('kanban')}
          className={`flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm transition-colors hover:bg-bg-tertiary ${
            mainView === 'kanban' ? 'bg-bg-tertiary text-text' : 'text-secondary'
          }`}
        >
          <IconLayoutKanban size={15} />
          {t('sidebar.kanban')}
        </button>
        <button
          type="button"
          onClick={() => setMainView('settings')}
          className={`flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm transition-colors hover:bg-bg-tertiary ${
            mainView === 'settings' ? 'bg-bg-tertiary text-text' : 'text-secondary'
          }`}
        >
          <IconSettings size={15} />
          {t('settings.title')}
        </button>
        {[
          { icon: IconCalendarClock, label: t('sidebar.scheduled') },
          { icon: IconArchive, label: t('sidebar.archive') },
        ].map((item) => (
          <Tooltip key={item.label} content={t('common.disabledHint')} side="right">
            <button
              type="button"
              disabled
              className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm text-secondary opacity-60"
            >
              <item.icon size={15} />
              {item.label}
            </button>
          </Tooltip>
        ))}
      </div>

      {/* 底部：操作按钮 + 宿主状态 */}
      <div className="border-t border-line p-2.5">
        <div className="flex flex-col gap-1.5">
          <Button variant="primary" size="md" onClick={() => void newSession()}>
            <IconPlus size={15} />
            {t('sidebar.newSession')}
          </Button>
          <Button variant="secondary" size="md" onClick={() => setAddOpen(true)}>
            <IconFolderPlus size={15} />
            {t('sidebar.addProject')}
          </Button>
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-xs text-muted">
          <span className={`inline-block h-2 w-2 rounded-full ${hostOnline ? 'pa-dot-success' : 'pa-dot-error'}`} />
          {hostOnline ? t('sidebar.hostOnline') : t('sidebar.hostOffline')}
        </div>
      </div>

      <AddProjectDialog open={addOpen} onOpenChange={setAddOpen} />
    </aside>
  );
}

/* ---------- 项目节点 + 会话列表 ---------- */

function ProjectNode({
  project,
  active,
  sessions,
  currentSessionId,
  onSelect,
  onSelectSession,
}: {
  project: Project;
  active: boolean;
  sessions: AppSession[];
  currentSessionId: string | null;
  onSelect(): void;
  onSelectSession(id: string): void;
}) {
  const [open, setOpen] = useState(true);
  const abnormal = project.status !== 'ok';
  return (
    <div>
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-[6px] px-2 py-1.5 text-sm transition-colors',
          active ? 'bg-accent-soft text-text' : 'text-secondary hover:bg-accent-soft',
          abnormal && 'text-danger hover:text-danger',
        )}
        title={abnormal ? `${project.path}（${project.status === 'missing' ? '目录不存在' : '无访问权限'}）` : project.path}
      >
        <IconFolder size={14} className={cn('shrink-0', abnormal && 'text-danger')} />
        <span className="min-w-0 flex-1 truncate text-left">{project.name}</span>
        {!project.trusted ? (
          <span className="shrink-0 rounded-full border border-warning/50 px-1 text-[10px] text-warning">未信任</span>
        ) : null}
        {abnormal ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" /> : null}
      </button>
      {open ? (
        <div className="ml-4 border-l border-line pl-1.5">
          {sessions.length === 0 ? (
            <div className="px-2 py-1 text-[11px] text-muted">{t('sidebar.noSessions')}</div>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelectSession(s.id)}
                className={cn(
                  'flex w-full items-center gap-1.5 rounded-[6px] px-2 py-1 text-xs transition-colors',
                  s.id === currentSessionId
                    ? 'bg-accent-soft text-text'
                    : 'text-secondary hover:bg-accent-soft',
                )}
              >
                <IconMessage size={12} className="shrink-0 opacity-60" />
                <span className="min-w-0 flex-1 truncate text-left">{s.title}</span>
                {s.pinned ? <IconPinFilled size={11} className="shrink-0 text-accent" /> : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function SessionList({
  label,
  sessions,
  currentSessionId,
  onSelectSession,
  defaultOpen,
}: {
  label: string;
  sessions: { id: string; title: string; pinned?: boolean }[];
  currentSessionId: string | null;
  onSelectSession(id: string): void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  if (sessions.length === 0 && !defaultOpen) return null;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-[6px] px-2 py-1.5 text-sm text-secondary hover:bg-accent-soft"
      >
        <IconFolder size={14} className="shrink-0 opacity-60" />
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      </button>
      {open ? (
        <div className="ml-4 border-l border-line pl-1.5">
          {sessions.length === 0 ? (
            <div className="px-2 py-1 text-[11px] text-muted">{t('sidebar.noSessions')}</div>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelectSession(s.id)}
                className={cn(
                  'flex w-full items-center gap-1.5 rounded-[6px] px-2 py-1 text-xs transition-colors',
                  s.id === currentSessionId ? 'bg-accent-soft text-text' : 'text-secondary hover:bg-accent-soft',
                )}
              >
                <IconMessage size={12} className="shrink-0 opacity-60" />
                <span className="min-w-0 flex-1 truncate text-left">{s.title}</span>
                {s.pinned ? <IconPinFilled size={11} className="shrink-0 text-accent" /> : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
