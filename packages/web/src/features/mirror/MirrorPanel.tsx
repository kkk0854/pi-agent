/**
 * MirrorPanel：右栏「手机镜像」Tab（B-01..B-03/B-06）。
 * - 二维码由前端生成（qrcode 包），host 只提供局域网地址（/v1/mirror/info）
 * - 写 ACL 默认关（B-02）：开关经 /v1/mirror/write-acl，全部变更留审计（B-03）
 * - 令牌轮换：旧二维码/连接立即失效
 * - 审计列表（host 已脱敏，不含令牌明文）
 */
import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { IconDeviceMobile, IconQrcode } from '@tabler/icons-react';
import { t } from '../../i18n';
import type { MirrorAuditEntry, MirrorInfo } from '../../lib/hostClient';
import { getHostClient } from '../../runtime/runtimeRef';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';

const AUDIT_LABEL: Record<MirrorAuditEntry['kind'], string> = {
  connect: '接入',
  disconnect: '断开',
  write: '写入',
  'write-denied': '写入被拒',
  'acl-on': '开启写权限',
  'acl-off': '关闭写权限',
  'token-rotate': '令牌轮换',
};

export function MirrorPanel() {
  const client = getHostClient();
  const showToast = useToast();
  const [info, setInfo] = useState<MirrorInfo | null>(null);
  const [audit, setAudit] = useState<MirrorAuditEntry[]>([]);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const reload = useCallback(async () => {
    if (!client) return;
    try {
      const nextInfo = await client.mirrorInfo();
      setInfo(nextInfo);
      setLoadFailed(false);
      const entries = await client.mirrorAudit();
      setAudit([...entries.entries].reverse());
    } catch {
      setLoadFailed(true);
    }
  }, [client]);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), 15_000);
    return () => clearInterval(timer);
  }, [reload]);

  // 二维码：优先局域网地址（手机同网段可开），无网卡回退本机地址
  useEffect(() => {
    const url = info?.lanUrl ?? info?.localUrl ?? null;
    if (!url) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(url, { width: 180, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [info]);

  if (!client) {
    return <div className="text-xs text-muted">{t('mirror.offline')}</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-auto">
      <div className="flex items-center gap-1.5 text-sm font-medium text-text">
        <IconDeviceMobile size={15} />
        {t('mirror.title')}
      </div>
      <div className="text-[11px] leading-relaxed text-muted">{t('mirror.desc')}</div>

      {loadFailed ? (
        <div className="text-xs text-muted">{t('ext.loadFailed')}</div>
      ) : (
        <>
          <div className="flex flex-col items-center gap-1.5 rounded-card border border-line bg-panel p-3">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt={t('mirror.qrHint')} className="h-[180px] w-[180px] rounded-card" />
            ) : (
              <div className="flex h-[180px] w-[180px] items-center justify-center rounded-card border border-dashed border-line text-muted">
                <IconQrcode size={40} />
              </div>
            )}
            <div className="text-[11px] text-muted">{t('mirror.qrHint')}</div>
            {info && !info.lanUrl && info.localUrl ? (
              <div className="text-[11px] text-warning">{t('mirror.noLan')}</div>
            ) : null}
            {info ? (
              <div className="text-[11px] text-muted">
                {t('mirror.connections', { n: info.connections })}
              </div>
            ) : null}
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-xs text-text">
            <input
              type="checkbox"
              checked={info?.writeEnabled ?? false}
              onChange={(e) => {
                const enabled = e.target.checked;
                void client
                  .setMirrorWriteAcl(enabled)
                  .then((res) => {
                    showToast(enabled ? t('mirror.writeAclOn') : t('mirror.writeAclOff'), {
                      level: enabled ? 'warning' : 'info',
                    });
                    setInfo((prev) => (prev ? { ...prev, writeEnabled: res.writeEnabled } : prev));
                    return reload();
                  })
                  .catch(() => showToast(t('ext.toggleFail'), { level: 'error' }));
              }}
            />
            {t('mirror.writeAcl')}
          </label>

          <div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void client
                  .rotateMirrorToken()
                  .then(() => {
                    showToast(t('mirror.rotated'), { level: 'info' });
                    return reload();
                  })
                  .catch(() => showToast(t('ext.toggleFail'), { level: 'error' }));
              }}
            >
              {t('mirror.rotate')}
            </Button>
          </div>

          <div className="min-h-0 border-t border-line pt-1.5">
            <div className="mb-1 text-xs font-medium text-text">{t('mirror.audit')}</div>
            {audit.length === 0 ? (
              <div className="text-[11px] text-muted">{t('mirror.audit.empty')}</div>
            ) : (
              <div className="max-h-40 space-y-0.5 overflow-auto">
                {audit.slice(0, 30).map((e, i) => (
                  <div key={`${e.at}-${i}`} className="text-[11px] text-muted">
                    {new Date(e.at).toLocaleTimeString()} · {AUDIT_LABEL[e.kind] ?? e.kind}
                    {e.detail ? ` · ${e.detail}` : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
