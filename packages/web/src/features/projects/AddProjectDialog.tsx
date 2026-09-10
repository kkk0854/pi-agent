/**
 * 添加项目对话框（P-02 目录信任确认两步流）：
 * 第一步输入路径 → host 校验并入库（trusted:false）；
 * 第二步展示目录信息 + 信任确认复选框 → 确认后 POST /trust 生效。
 * 用户跳过信任：项目保留但标记「未信任」，选中该项目时强制只读档。
 */
import { useState } from 'react';
import { t } from '../../i18n';
import { Button } from '../../components/ui/Button';
import { Dialog, DialogContent } from '../../components/ui/Dialog';
import { useToast } from '../../components/ui/Toast';
import { getWorkspace } from '../../runtime/runtimeRef';
import { useAppStore } from '../../store';
import type { Project } from '@pi-agent/shared';

export function AddProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [step, setStep] = useState<'input' | 'trust'>('input');
  const [pending, setPending] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const showToast = useToast();
  const upsertProject = useAppStore((s) => s.upsertProject);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);

  const reset = (): void => {
    setPath('');
    setName('');
    setConfirmed(false);
    setStep('input');
    setPending(null);
    setBusy(false);
  };

  const submitPath = async (): Promise<void> => {
    const workspace = getWorkspace();
    const trimmed = path.trim();
    if (!workspace || trimmed.length === 0) return;
    setBusy(true);
    try {
      const project = await workspace.addProject({ path: trimmed, name: name.trim() || undefined, trusted: false });
      setPending(project);
      upsertProject(project);
      setStep('trust');
    } catch (err) {
      showToast(t('project.addFailed'), {
        description: err instanceof Error ? err.message : String(err),
        level: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const confirmTrust = async (): Promise<void> => {
    if (!pending) return;
    const workspace = getWorkspace();
    if (!workspace) return;
    setBusy(true);
    try {
      const trusted = await workspace.trustProject(pending.id);
      upsertProject(trusted);
      setCurrentProject(trusted.id);
      showToast(t('project.trustDone'), { level: 'success' });
      onOpenChange(false);
      reset();
    } catch (err) {
      showToast(t('project.addFailed'), {
        description: err instanceof Error ? err.message : String(err),
        level: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const skipTrust = (): void => {
    if (pending) {
      // 未信任项目保留在列表中（P-02：不信任不启动写权限）
      setCurrentProject(pending.id);
      showToast(t('project.untrustedHint'), { level: 'warning' });
    }
    onOpenChange(false);
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent title={t('project.addTitle')} description={t('project.addDesc')}>
        {step === 'input' ? (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs text-secondary">{t('project.pathLabel')}</span>
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder={t('project.pathPlaceholder')}
                className="w-full rounded-[6px] border border-line bg-bg px-2.5 py-1.5 text-sm text-text outline-none focus:border-accent"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-secondary">{t('project.nameLabel')}</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('project.namePlaceholder')}
                className="w-full rounded-[6px] border border-line bg-bg px-2.5 py-1.5 text-sm text-text outline-none focus:border-accent"
              />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" disabled={busy || path.trim().length === 0} onClick={() => void submitPath()}>
                {busy ? t('project.checking') : t('common.confirm')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-card border border-line bg-panel px-3 py-2 text-sm">
              <div className="font-medium text-text">{pending?.name}</div>
              <div className="mt-0.5 break-all font-mono text-xs text-muted">{pending?.path}</div>
            </div>
            <p className="text-xs leading-relaxed text-secondary">{t('project.trustExplain')}</p>
            <label className="flex items-start gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 accent-[var(--pa-accent,#6c5ce7)]"
              />
              <span>{t('project.trustConfirm')}</span>
            </label>
            <div className="flex justify-between gap-2 pt-1">
              <Button variant="ghost" onClick={skipTrust} disabled={busy}>
                {t('project.skipTrust')}
              </Button>
              <div className="flex gap-2">
                <Button variant="secondary" disabled={busy} onClick={() => setStep('input')}>
                  {t('project.back')}
                </Button>
                <Button variant="primary" disabled={!confirmed || busy} onClick={() => void confirmTrust()}>
                  {busy ? t('project.checking') : t('project.trustAndOpen')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
