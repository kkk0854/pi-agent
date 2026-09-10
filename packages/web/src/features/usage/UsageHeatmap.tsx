/**
 * UsageHeatmap：右栏「用量」Tab（Q-05）。
 * - 近 7 天 × 24 小时格子：tokens 总量 → 5 档色阶（accent 透明度）
 * - 数据：GET /v1/usage/summary 的 byDayHour（UsageDayHour[]，host 端聚合）
 * - 离线模式显示不可用提示
 */
import { useEffect, useMemo, useState } from 'react';
import type { UsageDayHour } from '@pi-agent/shared';
import { t } from '../../i18n';
import { cn } from '../../lib/cn';
import { getHostClient } from '../../runtime/runtimeRef';

/** 7 天 × 24 小时格子（rows=小时，cols=天），行首标小时，列首标日期 */
const HOUR_ROWS = Array.from({ length: 24 }, (_, i) => i);

interface Cell {
  day: string;
  hour: number;
  totalTokens: number;
  cost: number;
}

/** tokens → 0-4 档色阶（对数分档，避免单日峰值压扁其余格子） */
function levelOf(tokens: number, maxTokens: number): number {
  if (tokens <= 0 || maxTokens <= 0) return 0;
  const ratio = Math.log1p(tokens) / Math.log1p(maxTokens);
  return Math.min(4, Math.max(1, Math.ceil(ratio * 4)));
}

const LEVEL_CLASS = [
  'bg-line',
  'bg-accent/20',
  'bg-accent/40',
  'bg-accent/60',
  'bg-accent',
] as const;

export function UsageHeatmap() {
  const client = getHostClient();
  const [byDayHour, setByDayHour] = useState<UsageDayHour[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!client) return;
    void client
      .usageSummary()
      .then((summary) => {
        setByDayHour(summary.byDayHour ?? []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [client]);

  const { cells, days, maxTokens, totalTokens, totalCost } = useMemo(() => {
    const map = new Map<string, UsageDayHour>();
    const daySet = new Set<string>();
    let max = 0;
    let tokens = 0;
    let cost = 0;
    for (const d of byDayHour) {
      map.set(`${d.day}#${d.hour}`, d);
      daySet.add(d.day);
      max = Math.max(max, d.totalTokens);
      tokens += d.totalTokens;
      cost += d.cost;
    }
    // 列序：日期升序（旧 → 新），最多展示最近 7 个有数据的日期
    const sortedDays = [...daySet].sort().slice(-7);
    const cellMap = new Map<string, Cell>();
    for (const d of byDayHour) {
      cellMap.set(`${d.day}#${d.hour}`, { day: d.day, hour: d.hour, totalTokens: d.totalTokens, cost: d.cost });
    }
    return { cells: cellMap, days: sortedDays, maxTokens: max, totalTokens: tokens, totalCost: cost };
  }, [byDayHour]);

  if (!client) {
    return <div className="text-xs text-muted">{t('mirror.offline')}</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-auto">
      <div className="text-sm font-medium text-text">{t('usage.title')}</div>

      {loaded && byDayHour.length === 0 ? (
        <div className="text-xs text-muted">{t('usage.empty')}</div>
      ) : (
        <>
          <div className="overflow-auto">
            <table className="border-separate border-spacing-[2px]">
              <thead>
                <tr>
                  <th />
                  {days.map((day) => (
                    <th key={day} className="pb-1 text-[9px] font-normal text-muted">
                      {day.slice(5)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {HOUR_ROWS.map((hour) => (
                  <tr key={hour}>
                    <td className="pr-1 text-right text-[9px] text-muted">{hour}</td>
                    {days.map((day) => {
                      const cell = cells.get(`${day}#${hour}`);
                      const level = levelOf(cell?.totalTokens ?? 0, maxTokens);
                      return (
                        <td key={`${day}#${hour}`}>
                          <div
                            title={t('usage.cell', {
                              day,
                              hour,
                              tokens: cell?.totalTokens ?? 0,
                              cost: (cell?.cost ?? 0).toFixed(2),
                            })}
                            className={cn('h-3 w-3 rounded-[2px]', LEVEL_CLASS[level])}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-1 text-[10px] text-muted">
            {t('usage.legend.less')}
            {LEVEL_CLASS.map((cls) => (
              <span key={cls} className={cn('h-2.5 w-2.5 rounded-[2px]', cls)} />
            ))}
            {t('usage.legend.more')}
          </div>

          <div className="text-[11px] text-muted">
            {t('usage.total', { tokens: totalTokens, cost: totalCost.toFixed(2) })}
          </div>
        </>
      )}
    </div>
  );
}
