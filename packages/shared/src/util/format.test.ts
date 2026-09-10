import { describe, expect, it } from 'vitest';
import { formatCost, formatDurationMs, formatRelativeTime, formatTokens } from './format';

describe('formatDurationMs', () => {
  it('非法输入返回占位符', () => {
    expect(formatDurationMs(Number.NaN)).toBe('—');
    expect(formatDurationMs(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatDurationMs(-1)).toBe('—');
  });

  it('小于 1 秒以毫秒展示（四舍五入）', () => {
    expect(formatDurationMs(0)).toBe('0ms');
    expect(formatDurationMs(800)).toBe('800ms');
    expect(formatDurationMs(999)).toBe('999ms');
  });

  it('1 秒到 60 秒保留一位小数', () => {
    expect(formatDurationMs(1000)).toBe('1.0s');
    expect(formatDurationMs(12340)).toBe('12.3s');
    expect(formatDurationMs(59900)).toBe('59.9s');
  });

  it('1 分钟以内向上取整到分钟边界不出现 60 秒', () => {
    // 边界回归：round(59.9)=60 应进位为下一分钟
    expect(formatDurationMs(119_900)).toBe('2m 00s');
    expect(formatDurationMs(125_000)).toBe('2m 05s');
    expect(formatDurationMs(120_000)).toBe('2m 00s');
  });

  it('分钟区间的整秒补零', () => {
    expect(formatDurationMs(60_000)).toBe('1m 00s');
    expect(formatDurationMs(65_000)).toBe('1m 05s');
    expect(formatDurationMs(3_599_400)).toBe('59m 59s');
  });

  it('小时区间分钟补零，秒进位到小时', () => {
    expect(formatDurationMs(3_600_000)).toBe('1h 00m');
    expect(formatDurationMs(3_725_000)).toBe('1h 02m');
    // 59m59.9s → 进位 1h 00m 而非 0h 60m
    expect(formatDurationMs(3_599_900)).toBe('1h 00m');
  });
});

describe('formatTokens', () => {
  it('非法输入返回占位符', () => {
    expect(formatTokens(Number.NaN)).toBe('—');
    expect(formatTokens(-5)).toBe('—');
  });

  it('小于 1000 原样四舍五入', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(999.6)).toBe('1000');
  });

  it('千位区间保留一位小数 k', () => {
    expect(formatTokens(1234)).toBe('1.2k');
    expect(formatTokens(10_000)).toBe('10.0k');
    expect(formatTokens(999_999)).toBe('1000.0k');
  });

  it('百万区间保留一位小数 M', () => {
    expect(formatTokens(3_400_000)).toBe('3.4M');
    expect(formatTokens(1_000_000)).toBe('1.0M');
  });
});

describe('formatCost', () => {
  it('无法计算返回占位符', () => {
    expect(formatCost(undefined)).toBe('—');
    expect(formatCost(Number.NaN)).toBe('—');
    expect(formatCost(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('零与非负零返回 $0.00', () => {
    expect(formatCost(0)).toBe('$0.00');
  });

  it('极小费用展示 <$0.01', () => {
    expect(formatCost(0.001)).toBe('<$0.01');
    expect(formatCost(0.009)).toBe('<$0.01');
  });

  it('常规费用保留两位小数', () => {
    expect(formatCost(0.01)).toBe('$0.01');
    expect(formatCost(1.234)).toBe('$1.23');
    expect(formatCost(12)).toBe('$12.00');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-09-10T12:00:00');

  it('非法日期返回占位符', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('—');
  });

  it('一分钟内返回 刚刚', () => {
    expect(formatRelativeTime('2026-09-10T11:59:30', now)).toBe('刚刚');
    expect(formatRelativeTime(new Date('2026-09-10T12:00:00'), now)).toBe('刚刚');
  });

  it('一小时内按分钟', () => {
    expect(formatRelativeTime('2026-09-10T11:57:00', now)).toBe('3 分钟前');
    expect(formatRelativeTime('2026-09-10T11:01:00', now)).toBe('59 分钟前');
  });

  it('一天内按小时', () => {
    expect(formatRelativeTime('2026-09-10T09:00:00', now)).toBe('3 小时前');
  });

  it('昨天与 30 天内按天', () => {
    expect(formatRelativeTime('2026-09-09T11:00:00', now)).toBe('昨天');
    expect(formatRelativeTime('2026-09-05T12:00:00', now)).toBe('5 天前');
  });

  it('超过 30 天返回 YYYY-MM-DD', () => {
    expect(formatRelativeTime('2026-07-04T12:00:00', now)).toBe('2026-07-04');
  });
});
