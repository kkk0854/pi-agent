/**
 * ForkDialog：从分叉点派生新会话（F-01..F-05）。
 * - 打开时调用 runtime.getForkMessages(sessionId) 拉取可选分叉点（F-02）。
 * - 用户选择一个 entryId → forkFromEntry 完成 fork + 新建 AppSession + 切换（F-03 上下文截断由 pi 侧完成）。
 * 依赖：Dialog / Button / Toast / runtime / forkFlow。
 */
import { useEffect, useState } from 'react';
import { IconGitFork, IconLoader2 } from '@tabler/icons-react';
import { t } from '../../i18n';
import { cn } from '../../lib/cn';
import { Dialog, DialogContent } from '../../components/ui/Dialog';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { getRuntime } from '../../runtime/runtimeRef';
import { useAppStore } from '../../store';
import type { ForkPoint } from '@pi-agent/shared';
import { forkFromEntry } from './forkFlow';

export interface ForkDialogProps {
  sessionId: string;
  /** 当前会话标题，用于派生命名 */
  sessionTitle?: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** 分叉成功后回调（拿到新会话 id） */
  onForked?: (newSessionId: string) => void;
}

export function ForkDialog({ sessionId, sessionTitle, open, onOpenChange, onForked }: ForkDialogProps) {
  const [points, setPoints] = useState<ForkPoint[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showToast = useToast();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPoints(null);
    setSelected(null);
    setError(null);
    const runtime = getRuntime();
    if (!runtime) {
      setError(t('fork.failed'));
      return;
    }
    runtime
      .getForkMessages(sessionId)
      .then((list) => {
        if (cancelled) return;
        setPoints(list);
        if (list.length > 0) setSelected(list[0]!.entryId);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open, sessionId]);

  const doFork = async (): Promise<void> => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = useAppStore.getState().sessions.find((s) => s.id === sessionId);
      const newId = await forkFromEntry(
        {
          sessionId,
          projectId: session?.projectId ?? null,
          currentTitle: sessionTitle ?? session?.title,
        },
        selected,
      );
      showToast(t('fork.done'), { level: 'success' });
      onForked?.(newId);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      showToast(t('fork.failed'), { level: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('fork.title')} description={t('fork.desc')} className="w-[min(520px,94vw)]">
        {points === null ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <IconLoader2 className="animate-spin" size={16} />
            {t('fork.loading')}
          </div>
        ) : points.length === 0 ? (
          <div className="text-sm text-muted">{t('fork.empty')}</div>
        ) : (
          <div className="max-h-[320px] space-y-1 overflow-auto">
            <div className="mb-1 text-xs text-muted">{t('fork.points')}</div>
            {points.map((p) => (
              <button
                key={p.entryId}
                type="button"
                onClick={() => setSelected(p.entryId)}
                className={cn(
                  'w-full rounded-card border px-3 py-2 text-left text-sm transition-colors',
                  selected === p.entryId ? 'border-accent bg-accent-soft' : 'border-line hover:bg-accent-soft',
                )}
              >
                <div className="font-medium text-text">{p.label}</div>
                {p.preview ? <div className="mt-0.5 line-clamp-2 text-xs text-muted">{p.preview}</div> : null}
              </button>
            ))}
          </div>
        )}
        {error ? <div className="mt-2 text-xs text-danger">{error}</div> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!selected || busy || (points?.length ?? 0) === 0}
            onClick={() => void doFork()}
          >
            {busy ? <IconLoader2 className="animate-spin" size={14} /> : <IconGitFork size={14} />}
            {t('fork.confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
