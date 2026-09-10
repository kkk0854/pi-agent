/**
 * AutomationsPanel：右栏「自动化」Tab（U-01..U-06）。
 * - U-01 表单创建：title/prompt/project/schedule → POST /v1/automations
 * - U-02 自然语言：粘贴助手回复中的 ```pi-automation 围栏 → parseAutomationFence
 *   结构化预填表单（host 不做 NL 解析）；表单提交后原文不再作为对话内容展示
 * - U-03 列表带 nextRunAt / lastRunAt；U-06 运行历史 ring（ok/error/skipped 诚实记录）
 * - 启用/停用/删除走 PATCH/DELETE；数据来自 host REST（离线提示不可用）
 */
import { useCallback, useEffect, useState } from 'react';
import type { Automation, AutomationRun, Project } from '@pi-agent/shared';
import { IconClock, IconPlayerPlay, IconPlus, IconTrash } from '@tabler/icons-react';
import { t } from '../../i18n';
import { cn } from '../../lib/cn';
import { getHostClient } from '../../runtime/runtimeRef';
import { parseAutomationFence } from '../../lib/automationFence';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';

type ScheduleKind = Automation['schedule']['kind'];

interface DraftForm {
  title: string;
  prompt: string;
  projectId: string;
  kind: ScheduleKind;
  time: string;
  weekday: number;
  intervalMinutes: number;
  at: string;
}

const INITIAL_DRAFT: DraftForm = {
  title: '',
  prompt: '',
  projectId: '',
  kind: 'daily',
  time: '09:00',
  weekday: 1,
  intervalMinutes: 60,
  at: '',
};

const WEEKDAY_KEYS = [
  'auto.weekday.0',
  'auto.weekday.1',
  'auto.weekday.2',
  'auto.weekday.3',
  'auto.weekday.4',
  'auto.weekday.5',
  'auto.weekday.6',
] as const;

const RUN_RESULT_LABEL: Record<AutomationRun['result'], 'auto.run.ok' | 'auto.run.error' | 'auto.run.skipped'> = {
  ok: 'auto.run.ok',
  error: 'auto.run.error',
  skipped: 'auto.run.skipped',
};

function scheduleOf(draft: DraftForm): Automation['schedule'] | null {
  switch (draft.kind) {
    case 'daily':
      return { kind: 'daily', time: draft.time };
    case 'weekly':
      return { kind: 'weekly', time: draft.time, weekday: draft.weekday };
    case 'interval':
      return { kind: 'interval', intervalMinutes: Math.max(1, Math.floor(draft.intervalMinutes || 0)) };
    case 'once':
      return draft.at ? { kind: 'once', at: new Date(draft.at).toISOString() } : null;
    default:
      return null;
  }
}

function formatTime(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export function AutomationsPanel() {
  const client = getHostClient();
  const showToast = useToast();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [creating, setCreating] = useState(false);
  const [fenceInput, setFenceInput] = useState('');
  const [draft, setDraft] = useState<DraftForm>(INITIAL_DRAFT);
  const [expanded, setExpanded] = useState(false);

  const reload = useCallback(async () => {
    if (!client) return;
    try {
      const res = await client.listAutomations();
      setAutomations(res.automations);
    } catch {
      /* 轮询失败静默：下个周期重试 */
    }
  }, [client]);

  useEffect(() => {
    if (!client) return;
    void reload();
    void client.listProjects().then(setProjects).catch(() => setProjects([]));
    // 30s 轮询：nextRunAt / 运行历史随 host tick 更新
    const timer = setInterval(() => void reload(), 30_000);
    return () => clearInterval(timer);
  }, [client, reload]);

  if (!client) {
    return <div className="text-xs text-muted">{t('mirror.offline')}</div>;
  }

  const applyFence = (): void => {
    const parsed = parseAutomationFence(fenceInput);
    if (!parsed) {
      showToast(t('auto.fenceInvalid'), { level: 'error' });
      return;
    }
    // U-02：围栏内容被结构化吸收进表单，原文不再作为对话内容展示
    setDraft((d) => ({
      ...d,
      title: parsed.title || d.title,
      prompt: parsed.prompt || d.prompt,
      kind: parsed.schedule.kind,
      ...(parsed.schedule.time ? { time: parsed.schedule.time } : {}),
      ...(parsed.schedule.weekday !== undefined ? { weekday: parsed.schedule.weekday } : {}),
      ...(parsed.schedule.intervalMinutes !== undefined
        ? { intervalMinutes: parsed.schedule.intervalMinutes }
        : {}),
      ...(parsed.schedule.at ? { at: parsed.schedule.at } : {}),
    }));
    setFenceInput('');
    showToast(t('auto.fenceParsed'), { level: 'success' });
  };

  const submit = async (): Promise<void> => {
    const schedule = scheduleOf(draft);
    if (draft.title.trim().length === 0 || draft.prompt.trim().length === 0 || !schedule) {
      showToast(t('auto.createFailed'), { level: 'error' });
      return;
    }
    setCreating(true);
    try {
      await client.createAutomation({
        title: draft.title.trim(),
        prompt: draft.prompt.trim(),
        projectId: draft.projectId || null,
        schedule,
        enabled: true,
      });
      showToast(t('auto.created'), { level: 'success' });
      setDraft(INITIAL_DRAFT);
      setExpanded(false);
      await reload();
    } catch {
      showToast(t('auto.createFailed'), { level: 'error' });
    } finally {
      setCreating(false);
    }
  };

  const totalRuns = automations.reduce((acc, a) => acc + a.history.length, 0);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-auto">
      <div className="flex items-center gap-1.5 text-sm font-medium text-text">
        <IconPlayerPlay size={15} />
        {t('auto.title')}
        <span className="ml-auto">
          <Button
            size="sm"
            variant={expanded ? 'ghost' : 'secondary'}
            onClick={() => setExpanded((v) => !v)}
          >
            <IconPlus size={13} /> {t('auto.new')}
          </Button>
        </span>
      </div>

      {expanded ? (
        <div className="space-y-2 rounded-card border border-line bg-panel p-2.5">
          {/* U-02：自然语言围栏 → 结构化预填 */}
          <div>
            <div className="mb-1 text-xs text-muted">{t('auto.fenceLabel')}</div>
            <textarea
              value={fenceInput}
              onChange={(e) => setFenceInput(e.target.value)}
              placeholder={t('auto.fencePlaceholder')}
              rows={3}
              className="w-full rounded-card border border-line bg-input p-2 font-mono text-xs text-text outline-none focus:border-accent"
            />
            {fenceInput.trim().length > 0 ? (
              <Button size="sm" variant="ghost" onClick={applyFence}>
                {t('auto.fenceLabel')} →
              </Button>
            ) : null}
          </div>

          <input
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder={t('auto.namePlaceholder')}
            className="w-full rounded-card border border-line bg-input p-2 text-xs text-text outline-none focus:border-accent"
          />
          <textarea
            value={draft.prompt}
            onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))}
            placeholder={t('auto.promptPlaceholder')}
            rows={3}
            className="w-full rounded-card border border-line bg-input p-2 text-xs text-text outline-none focus:border-accent"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={draft.projectId}
              onChange={(e) => setDraft((d) => ({ ...d, projectId: e.target.value }))}
              className="rounded-card border border-line bg-input p-2 text-xs text-text outline-none"
            >
              <option value="">{t('auto.projectAny')}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              value={draft.kind}
              onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value as ScheduleKind }))}
              className="rounded-card border border-line bg-input p-2 text-xs text-text outline-none"
            >
              <option value="daily">{t('auto.schedule.daily')}</option>
              <option value="weekly">{t('auto.schedule.weekly')}</option>
              <option value="interval">{t('auto.schedule.interval')}</option>
              <option value="once">{t('auto.schedule.once')}</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {draft.kind === 'daily' || draft.kind === 'weekly' ? (
              <input
                type="time"
                value={draft.time}
                onChange={(e) => setDraft((d) => ({ ...d, time: e.target.value }))}
                className="rounded-card border border-line bg-input p-2 text-xs text-text outline-none"
              />
            ) : null}
            {draft.kind === 'weekly' ? (
              <select
                value={draft.weekday}
                onChange={(e) => setDraft((d) => ({ ...d, weekday: Number(e.target.value) }))}
                className="rounded-card border border-line bg-input p-2 text-xs text-text outline-none"
              >
                {WEEKDAY_KEYS.map((key, w) => (
                  <option key={key} value={w}>
                    {t(key)}
                  </option>
                ))}
              </select>
            ) : null}
            {draft.kind === 'interval' ? (
              <input
                type="number"
                min={1}
                value={draft.intervalMinutes}
                onChange={(e) => setDraft((d) => ({ ...d, intervalMinutes: Number(e.target.value) }))}
                className="rounded-card border border-line bg-input p-2 text-xs text-text outline-none"
              />
            ) : null}
            {draft.kind === 'once' ? (
              <input
                type="datetime-local"
                value={draft.at}
                onChange={(e) => setDraft((d) => ({ ...d, at: e.target.value }))}
                className="rounded-card border border-line bg-input p-2 text-xs text-text outline-none"
              />
            ) : null}
          </div>
          <Button size="sm" variant="primary" disabled={creating} onClick={() => void submit()}>
            {creating ? t('auto.creating') : t('auto.create')}
          </Button>
        </div>
      ) : null}

      {automations.length === 0 ? (
        <div className="text-xs text-muted">{t('auto.empty')}</div>
      ) : (
        <div className="space-y-1.5">
          {automations.map((a) => (
            <div key={a.id} className="rounded-card border border-line bg-panel px-2.5 py-2">
              <div className="flex items-center gap-2">
                <span
                  className={cn('h-2 w-2 shrink-0 rounded-full', a.enabled ? 'bg-success' : 'bg-muted')}
                />
                <span className="truncate text-xs font-medium text-text">{a.title}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void client
                        .updateAutomation(a.id, { enabled: !a.enabled })
                        .then(() => reload());
                    }}
                  >
                    {a.enabled ? t('auto.disable') : t('auto.enable')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void client.deleteAutomation(a.id).then(() => {
                        showToast(t('auto.deleted'), { level: 'info' });
                        return reload();
                      });
                    }}
                  >
                    <IconTrash size={13} />
                  </Button>
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted">
                <span className="inline-flex items-center gap-1">
                  <IconClock size={11} />
                  {t('auto.nextRun')}: {a.nextRunAt ? formatTime(a.nextRunAt) : '—'}
                </span>
                <span>
                  {t('auto.lastRun')}: {formatTime(a.lastRunAt)}
                </span>
              </div>
              {a.history.length > 0 ? (
                <div className="mt-1 border-t border-line pt-1">
                  <div className="text-[11px] text-muted">{t('auto.history', { n: a.history.length })}</div>
                  <div className="mt-0.5 space-y-0.5">
                    {a.history
                      .slice(-5)
                      .reverse()
                      .map((h, i) => (
                        <div key={`${h.at}-${i}`} className="text-[11px] text-muted">
                          <span
                            className={cn(
                              'mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle',
                              h.result === 'ok'
                                ? 'bg-success'
                                : h.result === 'error'
                                  ? 'bg-danger'
                                  : 'bg-warning',
                            )}
                          />
                          {formatTime(h.at)} · {t(RUN_RESULT_LABEL[h.result])}
                          {h.detail ? ` · ${h.detail}` : ''}
                        </div>
                      ))}
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {totalRuns > 0 ? (
        <div className="mt-1 text-[11px] text-muted">{t('auto.history', { n: totalRuns })}</div>
      ) : null}
    </div>
  );
}
