/**
 * CommandPalette：命令面板（P-06..P-08 · M-09/M-10 · A-07）。
 * - 全局 Cmd/Ctrl+K 打开（App 监听）。
 * - 命令列表动态构建：新建会话 / 跳转到会话 / 从当前会话分叉 / 运行诊断 / 切换主题 / 演示用示例变更。
 * - 过滤与分组走 lib/commandPalette 纯函数（已单测）；本组件负责渲染 + 键盘导航。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../i18n';
import { cn } from '../../lib/cn';
import { Dialog, DialogContent } from '../../components/ui/Dialog';
import { useToast } from '../../components/ui/Toast';
import { useAppStore } from '../../store';
import { useChangesStore } from '../changes/changesStore';
import { getRuntime, getWorkspace, getHostClient } from '../../runtime/runtimeRef';
import { forkFromEntry } from '../branch/forkFlow';
import { useCommandPaletteStore } from './commandPaletteStore';
import { filterCommands, groupCommands, type CommandItem } from '../../lib/commandPalette';

export function CommandPalette() {
  const open = useCommandPaletteStore((s) => s.open);
  const setOpen = useCommandPaletteStore((s) => s.setOpen);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const showToast = useToast();

  const sessions = useAppStore((s) => s.sessions);
  const currentSessionId = useAppStore((s) => s.currentSessionId);

  const items = useMemo<CommandItem[]>(() => buildCommands({ sessions, currentSessionId, showToast }), [sessions, currentSessionId, showToast]);

  const filtered = useMemo(() => filterCommands(items, query), [items, query]);
  const groups = useMemo(() => groupCommands(filtered), [filtered]);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const runAt = (index: number): void => {
    const item = filtered[index];
    if (!item) return;
    item.run();
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runAt(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  // 选中项滚动入视野
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, filtered]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setOpen(false);
      }}
    >
      <DialogContent title={t('cmd.title')} className="w-[min(560px,94vw)]">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('cmd.placeholder')}
          className="w-full rounded-card border border-line bg-bg px-3 py-2 text-sm text-text outline-none placeholder:text-muted focus-visible:border-accent"
        />
        <div ref={listRef} className="mt-2 max-h-[320px] overflow-auto">
          {filtered.length === 0 ? (
            <div className="px-1 py-3 text-xs text-muted">{t('cmd.empty')}</div>
          ) : (
            groups.map((g) => (
              <div key={g.group} className="mb-2">
                <div className="px-1 py-1 text-[11px] uppercase tracking-wide text-muted">{g.group}</div>
                {g.items.map((item) => {
                  const index = filtered.indexOf(item);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-index={index}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => runAt(index)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm',
                        index === active ? 'bg-accent-soft text-text' : 'text-secondary hover:bg-accent-soft',
                      )}
                    >
                      <span className="font-medium">{item.title}</span>
                      {item.hint ? <span className="ml-auto truncate text-xs text-muted">{item.hint}</span> : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface BuildCtx {
  sessions: { id: string; title: string }[];
  currentSessionId: string | null;
  showToast: (title: string, opts?: { level?: 'info' | 'success' | 'warning' | 'error'; description?: string }) => void;
}

function buildCommands({ sessions, currentSessionId, showToast }: BuildCtx): CommandItem[] {
  const cmds: CommandItem[] = [];

  // 新建会话
  cmds.push({
    id: 'new-session',
    title: t('cmd.newSession'),
    group: t('cmd.group.session'),
    keywords: 'new session create 新建 会话',
    run: () => {
      void (async () => {
        const ws = getWorkspace();
        if (!ws) {
          showToast(t('app.offlineBadge'), { level: 'warning' });
          return;
        }
        const st = useAppStore.getState();
        const projectId =
          (currentSessionId ? st.sessions.find((s) => s.id === currentSessionId)?.projectId : null) ??
          st.sessions[0]?.projectId ??
          null;
        try {
          const created = await ws.createSession({ projectId, title: t('session.new') });
          st.upsertSession(created);
          st.setCurrentSession(created.id);
          showToast(t('session.new'), { level: 'success' });
        } catch (e) {
          showToast(e instanceof Error ? e.message : String(e), { level: 'error' });
        }
      })();
    },
  });

  // 跳转到会话
  for (const s of sessions) {
    cmds.push({
      id: `jump-${s.id}`,
      title: `${t('cmd.jumpSession')}：${s.title}`,
      hint: s.id === currentSessionId ? '·' : undefined,
      group: t('cmd.group.session'),
      keywords: `jump goto session ${s.title}`,
      run: () => useAppStore.getState().setCurrentSession(s.id),
    });
  }

  // 从当前会话分叉
  cmds.push({
    id: 'fork-current',
    title: t('cmd.fork'),
    group: t('cmd.group.action'),
    keywords: 'fork branch 分叉 分支',
    run: () => {
      void (async () => {
        const sid = useAppStore.getState().currentSessionId;
        if (!sid) {
          showToast(t('empty.noSession.title'), { level: 'warning' });
          return;
        }
        const session = useAppStore.getState().sessions.find((s) => s.id === sid);
        const runtime = getRuntime();
        if (!runtime) {
          showToast(t('fork.failed'), { level: 'error' });
          return;
        }
        try {
          const points = await runtime.getForkMessages(sid);
          if (points.length === 0) {
            showToast(t('fork.empty'), { level: 'warning' });
            return;
          }
          const point = points.find((p) => /开始|root|start/i.test(p.label)) ?? points[0]!;
          await forkFromEntry(
            { sessionId: sid, projectId: session?.projectId ?? null, currentTitle: session?.title },
            point.entryId,
          );
          showToast(t('fork.done'), { level: 'success' });
        } catch (e) {
          showToast(e instanceof Error ? e.message : String(e), { level: 'error' });
        }
      })();
    },
  });

  // 固定 / 取消固定当前会话（C-06）
  const pinCommand = (unpin: boolean): CommandItem => ({
    id: unpin ? 'unpin-session' : 'pin-session',
    title: t(unpin ? 'cmd.unpinSession' : 'cmd.pinSession'),
    group: t('cmd.group.session'),
    keywords: unpin ? 'unpin session 取消固定 会话 置顶' : 'pin session 固定 会话 置顶',
    run: () => {
      void (async () => {
        const st = useAppStore.getState();
        const sid = st.currentSessionId;
        if (!sid) {
          showToast(t('empty.noSession.title'), { level: 'warning' });
          return;
        }
        const session = st.sessions.find((s) => s.id === sid);
        if (!session) return;
        st.upsertSession({ ...session, pinned: !unpin });
        const ws = getWorkspace();
        if (ws?.online) {
          try {
            await ws.updateSession(sid, { pinned: !unpin });
          } catch {
            // host 持久化失败不影响本地态（下次同步会覆盖）
          }
        }
        showToast(t(unpin ? 'session.unpin' : 'session.pin'), { level: 'success' });
      })();
    },
  });
  cmds.push(pinCommand(false));
  cmds.push(pinCommand(true));

  // 运行诊断
  cmds.push({
    id: 'run-diagnostics',
    title: t('cmd.runDiagnostics'),
    group: t('cmd.group.action'),
    keywords: 'doctor diagnose health 诊断 健康检查',
    run: () => {
      void (async () => {
        const client = getHostClient();
        if (!client) {
          showToast(t('settings.doctor.offline'), { level: 'warning' });
          return;
        }
        try {
          const report = await client.doctor();
          const issues = report.checks.filter((c) => c.verdict !== 'pass').length;
          if (issues === 0) showToast(t('cmd.diagnosticsOk'), { level: 'success' });
          else showToast(t('cmd.diagnosticsIssue', { n: issues }), { level: 'warning' });
        } catch (e) {
          showToast(e instanceof Error ? e.message : String(e), { level: 'error' });
        }
      })();
    },
  });

  // 切换主题
  const themeCmd = (id: string, labelKey: 'cmd.themeLight' | 'cmd.themeDark' | 'cmd.themeSystem', theme: 'light' | 'dark' | 'system') => ({
    id,
    title: t(labelKey),
    group: t('cmd.group.theme'),
    keywords: `theme ${theme} 主题`,
    run: () => useAppStore.getState().setTheme(theme),
  });
  cmds.push(themeCmd('theme-light', 'cmd.themeLight', 'light'));
  cmds.push(themeCmd('theme-dark', 'cmd.themeDark', 'dark'));
  cmds.push(themeCmd('theme-system', 'cmd.themeSystem', 'system'));

  // 演示：插入示例变更（W-06..W-08 可演示用；真实数据将由 T04b 的工具事件驱动）
  cmds.push({
    id: 'demo-change',
    title: t('cmd.demoChange'),
    group: t('cmd.group.action'),
    keywords: 'demo change diff sample 示例 变更',
    run: () => {
      const store = useChangesStore.getState();
      store.add({
        path: 'src/utils/format.ts',
        original: 'export function format(n: number) {\n  return n.toString();\n}\n',
        modified: 'export function format(n: number, prefix = ""): string {\n  return `${prefix}${n}`;\n}\n',
      });
      store.add({
        path: 'README.md',
        original: '# pi-agent\n',
        modified: '# pi-agent\n\n> 图形化工坊（对标 grok-app）\n',
      });
      showToast(t('changes.title'), { level: 'success' });
    },
  });

  return cmds;
}
