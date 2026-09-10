/**
 * PermissionEngine 单测（T03）：
 * 四档策略决策、危险清单匹配、会话放行记忆、请求解析。
 */
import { describe, expect, it } from 'vitest';
import {
  PERMISSION_MARKER,
  PermissionEngine,
  parsePermissionRequest,
  summarizeToolCall,
} from './permissionEngine';
import type { ExtensionUIRequest } from '@pi-agent/shared';

function confirmReq(toolName: string, input: Record<string, unknown>): ExtensionUIRequest {
  return {
    id: 'req-1',
    method: 'confirm',
    title: PERMISSION_MARKER,
    message: JSON.stringify({ toolName, toolCallId: 'tc-1', input }),
  };
}

describe('parsePermissionRequest', () => {
  it('识别本扩展的 confirm 并解析 JSON 载荷', () => {
    const p = parsePermissionRequest(confirmReq('bash', { command: 'ls' }));
    expect(p).not.toBeNull();
    expect(p!.toolName).toBe('bash');
    expect(p!.input).toEqual({ command: 'ls' });
  });

  it('非标记 confirm / 非 JSON 载荷返回 null（走通用渲染）', () => {
    expect(parsePermissionRequest({ id: 'x', method: 'confirm', title: '其他扩展', message: 'hello' })).toBeNull();
    expect(parsePermissionRequest({ id: 'x', method: 'confirm', title: PERMISSION_MARKER, message: 'not-json' })).toBeNull();
  });
});

describe('四档策略决策', () => {
  const engine = new PermissionEngine();
  const bashWrite = { toolName: 'bash', toolCallId: '', input: { command: 'echo hi' } };
  const readTool = { toolName: 'read', toolCallId: '', input: { path: 'src/a.ts' } };

  it('① yolo：全放行；只读工具任何档位放行', () => {
    expect(engine.evaluate('s1', 'yolo', bashWrite).action).toBe('auto-allow');
    expect(engine.evaluate('s1', 'ask', readTool).action).toBe('auto-allow');
  });

  it('③ ask：写/执行弹条，读放行', () => {
    expect(engine.evaluate('s1', 'ask', bashWrite).action).toBe('prompt');
  });

  it('② notify-on-risky：常规放行、命中危险清单才弹条', () => {
    expect(engine.evaluate('s1', 'notify-on-risky', bashWrite).action).toBe('auto-allow');
    const risky = { toolName: 'bash', toolCallId: '', input: { command: 'git push --force origin main' } };
    const v = engine.evaluate('s1', 'notify-on-risky', risky);
    expect(v.action).toBe('prompt');
    expect(v.risk).toBe('risky');
    expect(v.matched?.id).toBe('git-push-force');
  });

  it('④ read-only：写/执行自动拒绝并带原因', () => {
    const v = engine.evaluate('s1', 'read-only', bashWrite);
    expect(v.action).toBe('auto-deny');
    expect(v.denyReason).toContain('只读档');
  });

  it('「本会话放行」记忆生效；危险操作不适用记忆', () => {
    const e2 = new PermissionEngine();
    e2.allowSessionForTool('s2', 'bash');
    expect(e2.evaluate('s2', 'ask', bashWrite).action).toBe('auto-allow');
    const risky = { toolName: 'bash', toolCallId: '', input: { command: 'rm -rf /tmp/x' } };
    expect(e2.evaluate('s2', 'ask', risky).action).toBe('prompt');
  });
});

describe('危险清单匹配面', () => {
  const engine = new PermissionEngine();
  const cases: [string, Record<string, unknown>, string | null][] = [
    ['删除-递归', { command: 'rm -rf build' }, 'delete-recursive'],
    ['Git-强推', { command: 'git push -f' }, 'git-push-force'],
    ['sudo', { command: 'sudo apt install x' }, 'privilege-sudo'],
    ['写系统目录', { path: 'C:\\Windows\\System32\\x.txt' }, 'sys-write-windows'],
    ['数据库DROP', { command: 'psql -c "DROP TABLE users"' }, 'db-drop'],
    ['普通写不命中', { path: 'src/index.ts' }, null],
    ['普通命令不命中', { command: 'npm test' }, null],
  ];
  for (const [name, input, expected] of cases) {
    it(name, () => {
      const toolName = 'command' in input ? 'bash' : 'write';
      const a = engine.assess(toolName, input);
      expect(a.matched?.id ?? null).toBe(expected);
    });
  }
});

describe('summarizeToolCall', () => {
  it('过 redact 且截断超长', () => {
    const s = summarizeToolCall('bash', { command: `echo ${'x'.repeat(200)}` });
    expect(s.length).toBeLessThan(200);
    expect(s.startsWith('bash')).toBe(true);
  });
});
