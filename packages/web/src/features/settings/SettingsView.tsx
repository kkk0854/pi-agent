/**
 * 设置页（V-01..V-07 精简版）：
 * - 外观主题（V-01）/ 运行时参数（V-03 并发与空闲回收）/ 审批超时策略（V-04，A-14）
 * - 诊断 Doctor（V-02：一键体检 + 复制脱敏报告）
 * - 遥测（V-07：默认关闭）
 */
import { useState } from 'react';
import { IconCopy, IconHeartRateMonitor, IconLoader2 } from '@tabler/icons-react';
import { t } from '../../i18n';
import { useAppStore } from '../../store';
import { getHostClient, getWorkspace } from '../../runtime/runtimeRef';
import { Button } from '../../components/ui/Button';
import type { DoctorReport } from '@pi-agent/shared';

type ThemePreference = 'light' | 'dark' | 'system';

const VERDICT_CLS: Record<string, string> = {
  pass: 'text-success',
  warn: 'text-warning',
  fail: 'text-danger',
};

export function SettingsView() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const settings = useAppStore((s) => s.settings);
  const replaceSettings = useAppStore((s) => s.replaceSettings);
  const online = useAppStore((s) => s.hostOnline);
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [busy, setBusy] = useState(false);

  const runDoctor = async (): Promise<void> => {
    const client = getHostClient();
    if (!client) return;
    setBusy(true);
    try {
      const r = await client.doctor();
      setReport(r);
    } catch {
      setReport(null);
    } finally {
      setBusy(false);
    }
  };

  const copyReport = (): void => {
    if (!report) return;
    const text = report.checks.map((c) => `[${c.verdict.toUpperCase()}] ${c.label}: ${c.detail}`).join('\n');
    void navigator.clipboard.writeText(`pi-agent 诊断报告（${report.at}）\n${text}`);
  };

  const patchSettings = (patch: Partial<typeof settings>): void => {
    replaceSettings({ ...settings, ...patch });
    const workspace = getWorkspace();
    if (workspace?.online) void workspace.saveSettings(patch).catch(() => undefined);
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-auto">
      <div className="border-b border-line px-4 py-2 text-sm font-medium text-text">{t('settings.title')}</div>
      <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
        {/* V-01 外观 */}
        <section className="rounded-card border border-line p-3">
          <h3 className="mb-2 text-xs font-medium text-secondary">{t('settings.appearance')}</h3>
          <div className="flex gap-2">
            {(['light', 'dark', 'system'] as ThemePreference[]).map((th) => (
              <Button key={th} size="sm" variant={theme === th ? 'primary' : 'ghost'} onClick={() => setTheme(th)}>
                {t(`settings.theme.${th}`)}
              </Button>
            ))}
          </div>
        </section>

        {/* V-03 运行时 */}
        <section className="rounded-card border border-line p-3">
          <h3 className="mb-2 text-xs font-medium text-secondary">{t('settings.runtime')}</h3>
          <label className="flex items-center justify-between py-1 text-xs text-text">
            <span>pi 最大并发会话（N-02）</span>
            <input
              type="number"
              min={1}
              max={8}
              value={settings.maxConcurrentAgents}
              onChange={(e) => patchSettings({ maxConcurrentAgents: Math.max(1, Number(e.target.value) || 3) })}
              className="w-20 rounded-md border border-line bg-bg-primary px-2 py-1 text-right"
            />
          </label>
          <label className="flex items-center justify-between py-1 text-xs text-text">
            <span>空闲回收（分钟，N-03）</span>
            <input
              type="number"
              min={5}
              max={240}
              value={Math.round(settings.idleRecycleMs / 60000)}
              onChange={(e) => patchSettings({ idleRecycleMs: Math.max(5, Number(e.target.value) || 30) * 60000 })}
              className="w-20 rounded-md border border-line bg-bg-primary px-2 py-1 text-right"
            />
          </label>
        </section>

        {/* V-04 审批（A-14） */}
        <section className="rounded-card border border-line p-3">
          <h3 className="mb-2 text-xs font-medium text-secondary">{t('settings.approval')}</h3>
          <label className="flex items-center justify-between py-1 text-xs text-text">
            <span>审批超时兜底（A-14）</span>
            <select
              value={settings.approvalTimeoutPolicy}
              onChange={(e) => patchSettings({ approvalTimeoutPolicy: e.target.value === 'allow' ? 'allow' : 'deny' })}
              className="rounded-md border border-line bg-bg-primary px-2 py-1"
            >
              <option value="deny">超时拒绝（默认）</option>
              <option value="allow">超时放行</option>
            </select>
          </label>
          <p className="mt-1 text-[11px] text-muted">审批超时 {Math.round(settings.uiRequestTimeoutMs / 1000)} 秒；四档权限在会话/项目设置中调整，②③档立即生效。</p>
        </section>

        {/* V-02 诊断 */}
        <section className="rounded-card border border-line p-3">
          <h3 className="mb-2 text-xs font-medium text-secondary">诊断（V-02）</h3>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="primary" onClick={() => void runDoctor()} disabled={!online || busy}>
              {busy ? <IconLoader2 size={14} className="animate-spin" /> : <IconHeartRateMonitor size={14} />}
              {t('settings.doctor.run')}
            </Button>
            {report ? (
              <Button size="sm" variant="ghost" onClick={copyReport}>
                <IconCopy size={14} />
                {t('settings.doctor.copy')}
              </Button>
            ) : null}
            {!online ? <span className="text-[11px] text-muted">{t('settings.doctor.offline')}</span> : null}
          </div>
          {report ? (
            <ul className="mt-2 space-y-1" data-testid="doctor-report">
              {report.checks.map((c) => (
                <li key={c.id} className="flex items-start gap-2 text-xs">
                  <span className={`w-10 shrink-0 font-mono uppercase ${VERDICT_CLS[c.verdict] ?? ''}`}>{c.verdict}</span>
                  <span className="w-36 shrink-0 text-text">{c.label}</span>
                  <span className="min-w-0 flex-1 break-all text-secondary">{c.detail}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {/* V-07 遥测 */}
        <section className="rounded-card border border-line p-3">
          <h3 className="mb-2 text-xs font-medium text-secondary">{t('settings.telemetry')}</h3>
          <p className="text-[11px] text-muted">默认关闭，且当前版本不收集任何遥测数据。</p>
        </section>
      </div>
    </div>
  );
}
