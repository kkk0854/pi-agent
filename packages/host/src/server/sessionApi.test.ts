/**
 * 本地 REST 会话 API 单测（T04b · C-05/E-04 配套）：buildAutoOpenRequest 纯函数。
 */
import { describe, expect, it } from 'vitest';
import type { AppSession } from '@pi-agent/shared';
import { buildAutoOpenRequest } from './sessionApi';

function makeSession(partial: Partial<AppSession>): AppSession {
  return {
    id: 'sess-1',
    projectId: 'proj-1',
    title: '测试会话',
    status: 'idle',
    createdAt: '2026-03-11T00:00:00.000Z',
    updatedAt: '2026-03-11T00:00:00.000Z',
    ...partial,
  };
}

describe('buildAutoOpenRequest', () => {
  it('携带恢复所需的 piSessionId / piSessionPath / projectPath', () => {
    const session = makeSession({
      piSessionId: 'pi-abc',
      piSessionPath: 'D:/repo/.pi/sessions/pi-abc',
    });
    const req = buildAutoOpenRequest(session, 'D:/repo', 'read-only');
    expect(req).toEqual({
      appSessionId: 'sess-1',
      projectPath: 'D:/repo',
      piSessionPath: 'D:/repo/.pi/sessions/pi-abc',
      piSessionId: 'pi-abc',
      title: '测试会话',
      permissionTier: 'read-only',
    });
  });

  it('无恢复信息时字段缺省（不注入 undefined）', () => {
    const req = buildAutoOpenRequest(makeSession({}), undefined);
    expect('projectPath' in req).toBe(false);
    expect('piSessionPath' in req).toBe(false);
    expect('piSessionId' in req).toBe(false);
    expect(req.permissionTier).toBe('notify-on-risky');
  });
});
