/**
 * 自动化调度纯函数单测（T04b · U-03/U-04）：nextRunAt 对四种 schedule 的计算。
 */
import { describe, expect, it } from 'vitest';
import type { Automation } from '@pi-agent/shared';
import { nextRunAt } from './automations';

/** 固定基准时刻：2026-03-11（周三）12:00:00 本地时间 */
function baseNow(): Date {
  return new Date(2026, 2, 11, 12, 0, 0, 0);
}

function makeAutomation(partial: Partial<Automation>): Automation {
  return {
    id: 'auto-test',
    title: '测试自动化',
    prompt: 'hello',
    projectId: null,
    schedule: { kind: 'daily', time: '09:00' },
    enabled: true,
    createdAt: '2026-03-01T00:00:00.000Z',
    history: [],
    ...partial,
  };
}

describe('nextRunAt', () => {
  it('daily：今天未到点 → 今天 HH:mm', () => {
    const next = nextRunAt(makeAutomation({ schedule: { kind: 'daily', time: '18:30' } }), baseNow());
    expect(next).toEqual(new Date(2026, 2, 11, 18, 30, 0, 0));
  });

  it('daily：今天已过点 → 明天 HH:mm', () => {
    const next = nextRunAt(makeAutomation({ schedule: { kind: 'daily', time: '09:00' } }), baseNow());
    expect(next).toEqual(new Date(2026, 2, 12, 9, 0, 0, 0));
  });

  it('daily：time 非法 → null', () => {
    const next = nextRunAt(makeAutomation({ schedule: { kind: 'daily', time: '99:99' } }), baseNow());
    expect(next).toBeNull();
  });

  it('weekly：本周未到 → 本周该星期 HH:mm（周日至周六循环）', () => {
    // 周三(3) 12:00 → 周五(5) 08:00
    const next = nextRunAt(
      makeAutomation({ schedule: { kind: 'weekly', time: '08:00', weekday: 5 } }),
      baseNow(),
    );
    expect(next).toEqual(new Date(2026, 2, 13, 8, 0, 0, 0));
  });

  it('weekly：当天但已过点 → 下周同一天', () => {
    const next = nextRunAt(
      makeAutomation({ schedule: { kind: 'weekly', time: '09:00', weekday: 3 } }),
      baseNow(),
    );
    expect(next).toEqual(new Date(2026, 2, 18, 9, 0, 0, 0));
  });

  it('interval：从未运行 → 立即（=now）', () => {
    const now = baseNow();
    const next = nextRunAt(
      makeAutomation({ schedule: { kind: 'interval', intervalMinutes: 30 } }),
      now,
    );
    expect(next?.getTime()).toBe(now.getTime());
  });

  it('interval：按上次运行时间 + 间隔', () => {
    const last = new Date(2026, 2, 11, 11, 0, 0).toISOString();
    const next = nextRunAt(
      makeAutomation({
        schedule: { kind: 'interval', intervalMinutes: 45 },
        history: [{ at: last, result: 'ok' }],
      }),
      baseNow(),
    );
    expect(next).toEqual(new Date(2026, 2, 11, 11, 45, 0, 0));
  });

  it('once：未来时间 → 该时间；已跑过 → null', () => {
    const at = new Date(2026, 2, 20, 10, 0, 0).toISOString();
    const pending = nextRunAt(makeAutomation({ schedule: { kind: 'once', at } }), baseNow());
    expect(pending).toEqual(new Date(2026, 2, 20, 10, 0, 0, 0));

    const fired = nextRunAt(
      makeAutomation({
        schedule: { kind: 'once', at },
        history: [{ at, result: 'ok' }],
      }),
      baseNow(),
    );
    expect(fired).toBeNull();
  });

  it('interval：intervalMinutes 缺失 → null', () => {
    const next = nextRunAt(makeAutomation({ schedule: { kind: 'interval' } }), baseNow());
    expect(next).toBeNull();
  });
});
