/**
 * BranchTree：渲染会话分支树（F-01..F-05）。
 * - 通过 runtime.getTree(currentSessionId) 拉取树，用 flattenTree 展开为带缩进的扁平列表。
 * - 节点若命中某个 AppSession（id 或 piSessionId）则可点击跳转。
 * - 顶部「从此处分叉」按钮打开 ForkDialog（F-03/F-05）。
 */
import { useEffect, useState } from 'react';
import { IconGitBranch, IconGitFork, IconLoader2 } from '@tabler/icons-react';
import { t } from '../../i18n';
import { cn } from '../../lib/cn';
import { useAppStore } from '../../store';
import { getRuntime } from '../../runtime/runtimeRef';
import { flattenTree, type FlatTreeNode } from './treeReducer';
import type { SessionTreeNode } from '@pi-agent/shared';
import { ForkDialog } from './ForkDialog';

export function BranchTree() {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const [tree, setTree] = useState<SessionTreeNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forkOpen, setForkOpen] = useState(false);

  useEffect(() => {
    if (!currentSessionId) {
      setTree(null);
      return;
    }
    let cancelled = false;
    setTree(null);
    setError(null);
    const runtime = getRuntime();
    if (!runtime) {
      setError(t('branch.error'));
      return;
    }
    runtime
      .getTree(currentSessionId)
      .then((res) => {
        if (cancelled) return;
        setTree(Array.isArray(res.tree) ? res.tree : []);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [currentSessionId]);

  const flat: FlatTreeNode[] = tree ? flattenTree(tree) : [];

  const goTo = (node: FlatTreeNode): void => {
    const hit = sessions.find((s) => s.id === node.id || s.piSessionId === node.id);
    if (hit) setCurrentSession(hit.id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-text">
        <IconGitBranch size={15} />
        {t('branch.title')}
        {currentSessionId ? (
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-accent hover:bg-accent-soft"
            onClick={() => setForkOpen(true)}
          >
            <IconGitFork size={13} />
            {t('branch.forkFromLeaf')}
          </button>
        ) : null}
      </div>

      {currentSessionId === null ? (
        <div className="text-xs text-muted">{t('empty.noSession.desc')}</div>
      ) : tree === null && !error ? (
        <div className="flex items-center gap-2 text-xs text-muted">
          <IconLoader2 className="animate-spin" size={14} />
          {t('branch.loading')}
        </div>
      ) : error ? (
        <div className="text-xs text-danger">{error}</div>
      ) : flat.length === 0 ? (
        <div className="text-xs text-muted">{t('branch.empty')}</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          {flat.map((node) => {
            const current = sessions.find((s) => s.id === currentSessionId);
            const isCurrent = node.id === currentSessionId || current?.piSessionId === node.id;
            const navigateable = sessions.some((s) => s.id === node.id || s.piSessionId === node.id);
            return (
              <button
                key={node.id}
                type="button"
                disabled={!navigateable}
                onClick={() => goTo(node)}
                className={cn(
                  'flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs',
                  'hover:bg-accent-soft',
                  isCurrent ? 'bg-accent-soft font-medium text-text' : 'text-secondary',
                  !navigateable && 'cursor-default',
                )}
                style={{ paddingLeft: 8 + node.depth * 14 }}
              >
                <IconGitBranch size={12} className="shrink-0 opacity-70" />
                <span className="truncate">{node.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {currentSessionId ? (
        <ForkDialog sessionId={currentSessionId} open={forkOpen} onOpenChange={setForkOpen} />
      ) : null}
    </div>
  );
}
