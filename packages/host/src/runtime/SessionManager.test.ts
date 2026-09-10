/** SessionManager 状态机单测（注入替身进程，不真起 pi） */
import { describe, expect, it, vi } from 'vitest';
import type { OpenSessionRequest } from '@pi-agent/shared';
import { SessionManager, type ExitPayload, type SessionProcessLike } from './SessionManager';

interface FakeProcess extends SessionProcessLike {
  emitLines(lines: string[]): void;
  emitExit(info: { code: number | null; signal: NodeJS.Signals | null; graceful: boolean }): void;
}

function makeHarness(opts: { idleRecycleMs?: number } = {}) {
  const spawned: FakeProcess[] = [];
  const linesLog: { id: string; lines: string[] }[] = [];
  const exits: { id: string; payload: ExitPayload }[] = [];

  const manager = new SessionManager(
    {
      spawn: () => {
        let terminated = false;
        // 创建时刻的 label = appSessionId（open 包装器保证 currentId 已切好）
        const label = currentId;
        const p: FakeProcess = {
          writeLine: (line) => {
            if (terminated) return false;
            writes.push(line);
            return true;
          },
          terminate: async () => {
            terminated = true;
          },
          stderr: () => '',
          pid: 1000 + spawned.length,
          emitLines: (lines) => manager._handleSpawnLines(label, lines),
          emitExit: (info) => manager._handleSpawnExit(label, info),
        };
        const writes: string[] = [];
        void writes;
        spawned.push(p);
        return p;
      },
    },
    {
      onLines: (id, lines) => linesLog.push({ id, lines }),
      onExit: (id, payload) => exits.push({ id, payload }),
    },
    { idleRecycleMs: opts.idleRecycleMs ?? 0 },
  );

  let currentId = 'app-1';
  // open 时把 currentId 切到对应会话，替身 emit 才能路由
  const origOpen = manager.open.bind(manager);
  manager.open = (id: string, req: OpenSessionRequest) => {
    currentId = id;
    return origOpen(id, req);
  };

  const req: OpenSessionRequest = { appSessionId: 'app-1', permissionTier: 'ask' };
  return { manager, spawned, linesLog, exits, req };
}

describe('SessionManager 状态机', () => {
  it('open → connecting；首行到达 → ready；行经 onLines 转发', () => {
    const h = makeHarness();
    const record = h.manager.open('app-1', h.req);
    expect(record.status).toBe('connecting');
    expect(record.attached).toBe(true);

    h.spawned[0]!.emitLines(['{"type":"agent_start"}']);
    expect(h.manager.get('app-1')?.status).toBe('ready');
    expect(h.linesLog).toEqual([{ id: 'app-1', lines: ['{"type":"agent_start"}'] }]);
  });

  it('write 透传到进程 stdin；closed 后写失败', async () => {
    const h = makeHarness();
    h.manager.open('app-1', h.req);
    expect(h.manager.write('app-1', '{"type":"get_state"}')).toBe(true);

    h.spawned[0]!.emitExit({ code: 0, signal: null, graceful: true });
    expect(h.manager.write('app-1', 'x')).toBe(false);
    expect(h.manager.get('app-1')).toBeUndefined();
  });

  it('优雅退出 → closed，error 为 null，不产生崩溃分类', async () => {
    const h = makeHarness();
    h.manager.open('app-1', h.req);
    h.spawned[0]!.emitExit({ code: 0, signal: null, graceful: true });
    expect(h.exits[0]!.payload.error).toBeNull();
    expect(h.manager.count()).toBe(0);
  });

  it('非优雅退出 → classifyCrash 四类分类（stderr 命中 auth）', () => {
    const h = makeHarness();
    h.manager.open('app-1', h.req);
    h.manager._handleSpawnStderr('app-1', 'Error: 401 unauthorized');
    h.spawned[0]!.emitExit({ code: 1, signal: null, graceful: false });
    expect(h.exits[0]!.payload.error?.code).toBe('auth_failed');
  });

  it('close(recycle:true) 终止进程并移除记录', async () => {
    const h = makeHarness();
    h.manager.open('app-1', h.req);
    await h.manager.close('app-1', { recycle: true });
    expect(h.manager.get('app-1')).toBeUndefined();
  });

  it('close(recycle:false) 仅分离：进程保留、可重新附着', async () => {
    const h = makeHarness();
    h.manager.open('app-1', h.req);
    await h.manager.close('app-1', { recycle: false });
    const record = h.manager.get('app-1');
    expect(record?.attached).toBe(false);
    expect(h.manager.count()).toBe(1);

    // 幂等重开：不 spawn 新进程
    const before = h.spawned.length;
    h.manager.open('app-1', h.req);
    expect(h.spawned.length).toBe(before);
    expect(h.manager.get('app-1')?.attached).toBe(true);
  });

  it('空闲回收：sweep 只回收超过 idleRecycleMs 的会话', async () => {
    vi.useFakeTimers();
    try {
      const h = makeHarness({ idleRecycleMs: 1_800_000 });
      h.manager.open('app-1', { appSessionId: 'app-1', permissionTier: 'ask' });

      // 30min 内：不回收
      const t0 = Date.now();
      expect(await h.manager.sweep(t0 + 29 * 60_000)).toEqual([]);
      expect(h.manager.count()).toBe(1);

      // 超过 30min：回收
      const recycled = await h.manager.sweep(t0 + 31 * 60_000);
      expect(recycled).toEqual(['app-1']);
      expect(h.manager.count()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('同 appSessionId 幂等重开不产生第二个进程', () => {
    const h = makeHarness();
    h.manager.open('app-1', h.req);
    h.manager.open('app-1', h.req);
    expect(h.spawned.length).toBe(1);
  });

  it('dispose 回收全部会话', async () => {
    const h = makeHarness();
    h.manager.open('app-1', { appSessionId: 'app-1', permissionTier: 'ask' });
    h.manager.open('app-2', { appSessionId: 'app-2', permissionTier: 'read-only' });
    expect(h.manager.count()).toBe(2);
    await h.manager.dispose();
    expect(h.manager.count()).toBe(0);
  });
});
