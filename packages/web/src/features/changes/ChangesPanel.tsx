/**
 * ChangesPanel：右栏「变更」Tab（W-06..W-08）。
 * - 列出本轮被修改的文件，点击某条打开 DiffPanel。
 * - 顶部提供 全部接受 / 全部拒绝（批量决策）。
 * 数据来自 useChangesStore（由命令面板「插入示例变更（演示）」或后续 T04b 的 tool 事件驱动）。
 */
import { useState } from 'react';
import { IconFile, IconGitCompare } from '@tabler/icons-react';
import { t } from '../../i18n';
import { cn } from '../../lib/cn';
import { getWorkspace } from '../../runtime/runtimeRef';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { useChangesStore } from './changesStore';
import { DiffPanel } from '../diff/DiffPanel';

const STATUS_DOT: Record<string, string> = {
  pending: 'bg-warning',
  accepted: 'bg-success',
  rejected: 'bg-danger',
};

export function ChangesPanel() {
  const files = useChangesStore((s) => s.files);
  const acceptAll = useChangesStore((s) => s.acceptAll);
  const rejectAll = useChangesStore((s) => s.rejectAll);
  const accept = useChangesStore((s) => s.accept);
  const reject = useChangesStore((s) => s.reject);
  const restore = useChangesStore((s) => s.restore);
  const showToast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);

  const pendingCount = files.filter((f) => f.status === 'pending').length;
  const active = files.find((f) => f.id === openId) ?? null;

  if (active) {
    return (
      <DiffPanel
        change={active}
        onAccept={(id) => {
          accept(id);
          showToast(t('changes.status.accepted'), { level: 'success' });
          setOpenId(null);
        }}
        onReject={(id) => {
          reject(id);
          showToast(t('changes.status.rejected'), { level: 'info' });
          setOpenId(null);
        }}
        onRestore={(id) => {
          // T04b 真链路：original 有值 → 经 host PUT /v1/fs/write 写回（信任目录校验）；
          // 无 original（快照未捕获）→ 仅标记拒绝；离线 → 提示失败。
          const change = files.find((f) => f.id === id);
          if (!change) return;
          if (change.original === null) {
            restore(id);
            showToast(t('changes.restore.noOriginal'), { level: 'info' });
            setOpenId(null);
            return;
          }
          const ws = getWorkspace();
          if (!ws?.online) {
            showToast(t('changes.restore.fail'), { level: 'error' });
            return;
          }
          ws.writeFile(change.path, change.original)
            .then(() => {
              restore(id);
              showToast(t('changes.restore.done'), { level: 'success' });
              setOpenId(null);
            })
            .catch(() => {
              showToast(t('changes.restore.fail'), { level: 'error' });
            });
        }}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-text">
        <IconGitCompare size={15} />
        {t('changes.title')}
        {pendingCount > 0 ? (
          <span className="ml-1 rounded-full bg-accent-soft px-1.5 text-[11px] text-accent">
            {pendingCount} {t('changes.files')}
          </span>
        ) : null}
      </div>

      {files.length === 0 ? (
        <div className="text-xs text-muted">{t('changes.empty')}</div>
      ) : (
        <>
          <div className="mb-2 flex gap-2">
            <Button size="sm" variant="secondary" onClick={acceptAll}>
              {t('changes.acceptAll')}
            </Button>
            <Button size="sm" variant="ghost" onClick={rejectAll}>
              {t('changes.rejectAll')}
            </Button>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-auto">
            {files.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setOpenId(f.id)}
                className="flex w-full items-center gap-2 rounded-card border border-line bg-panel px-2.5 py-2 text-left hover:bg-accent-soft"
              >
                <span className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_DOT[f.status] ?? 'bg-muted')} />
                <IconFile size={14} className="shrink-0 text-muted" />
                <span className="truncate font-mono text-xs text-text">{f.path}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
