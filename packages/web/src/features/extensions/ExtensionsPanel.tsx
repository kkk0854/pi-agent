/**
 * ExtensionsPanel：右栏「扩展」Tab（X-02..X-04；X-05..X-07 骨架占位）。
 * - X-03 扩展列表可用：GET /v1/extensions（builtin + user 扫描）+ PATCH 启用态
 * - 技能 / 模板分区为占位空态（数据源后续批次开放，文案诚实说明）
 */
import { useCallback, useEffect, useState } from 'react';
import { IconPuzzle } from '@tabler/icons-react';
import { t } from '../../i18n';
import { cn } from '../../lib/cn';
import type { ExtensionInfo } from '../../lib/hostClient';
import { getHostClient } from '../../runtime/runtimeRef';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';

export function ExtensionsPanel() {
  const client = getHostClient();
  const showToast = useToast();
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    if (!client) return;
    try {
      const res = await client.listExtensions();
      setExtensions(res.extensions);
      setLoaded(true);
    } catch {
      showToast(t('ext.loadFailed'), { level: 'error' });
    }
  }, [client, showToast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!client) {
    return <div className="text-xs text-muted">{t('mirror.offline')}</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-auto">
      <div className="flex items-center gap-1.5 text-sm font-medium text-text">
        <IconPuzzle size={15} />
        {t('ext.title')}
      </div>

      {!loaded ? (
        <div className="text-xs text-muted">{t('ext.loading')}</div>
      ) : extensions.length === 0 ? (
        <div className="text-xs text-muted">{t('ext.empty')}</div>
      ) : (
        <div className="space-y-1.5">
          {extensions.map((ext) => (
            <div key={ext.id} className="rounded-card border border-line bg-panel px-2.5 py-2">
              <div className="flex items-center gap-2">
                <span className="truncate text-xs font-medium text-text">{ext.name}</span>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-1.5 text-[10px]',
                    ext.source === 'builtin'
                      ? 'bg-accent-soft text-accent'
                      : 'bg-line text-muted',
                  )}
                >
                  {ext.source === 'builtin' ? t('ext.source.builtin') : t('ext.source.user')}
                </span>
                <span className="ml-auto shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void client
                        .setExtensionEnabled(ext.id, !ext.enabled)
                        .then(() => reload())
                        .catch(() => showToast(t('ext.toggleFail'), { level: 'error' }));
                    }}
                  >
                    {ext.enabled ? t('ext.enabled') : t('ext.disabled')}
                  </Button>
                </span>
              </div>
              {ext.description ? (
                <div className="mt-0.5 line-clamp-2 text-[11px] text-muted">{ext.description}</div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-line pt-1.5">
        <div className="mb-1 text-xs font-medium text-text">{t('ext.skillsTitle')}</div>
        <div className="text-[11px] text-muted">{t('ext.skillsEmpty')}</div>
      </div>
      <div className="border-t border-line pt-1.5">
        <div className="mb-1 text-xs font-medium text-text">{t('ext.templatesTitle')}</div>
        <div className="text-[11px] text-muted">{t('ext.templatesEmpty')}</div>
      </div>
    </div>
  );
}
