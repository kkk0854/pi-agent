/**
 * 展示格式化：时长、token、费用、相对时间（中文）。
 */

/** 时长：<1s → '800ms'；<60s → '12.3s'；其余 → '1m 23s' / '1h 02m' */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSec = ms / 1000;
  if (totalSec < 60) return `${totalSec.toFixed(1)}s`;
  const totalMin = Math.floor(totalSec / 60);
  const sec = Math.round(totalSec % 60);
  if (totalMin < 60) return `${totalMin}m ${sec.toString().padStart(2, '0')}s`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

/** token 数：1234 → '1.2k'，3_400_000 → '3.4M'，<1000 原样 */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** 费用（美元）：<0.01 且 >0 → '<$0.01'；无法计算 → '—' */
export function formatCost(usd: number | undefined): string {
  if (usd === undefined || usd === null || !Number.isFinite(usd)) return '—';
  if (usd <= 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

/** 相对时间（中文）：'刚刚' / '3 分钟前' / '2 小时前' / '昨天' / '5 天前' / 具体日期 */
export function formatRelativeTime(iso: string | number | Date, now: Date = new Date()): string {
  const date = iso instanceof Date ? iso : new Date(iso);
  const ts = date.getTime();
  if (Number.isNaN(ts)) return '—';
  const diffMs = now.getTime() - ts;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return '昨天';
  if (diffDay < 30) return `${diffDay} 天前`;
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}
