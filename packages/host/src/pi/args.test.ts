/** buildPiArgs 单测：argv 组装硬约束（--mode rpc / 只读档 --tools / 恢复参数 / 数组直传） */
import { describe, expect, it } from 'vitest';
import type { OpenSessionRequest } from '@pi-agent/shared';
import { buildPiArgs } from './args';

const HOME = 'C:\\Users\\tester';

function baseReq(patch: Partial<OpenSessionRequest> = {}): OpenSessionRequest {
  return {
    appSessionId: 'app-1',
    permissionTier: 'ask',
    ...patch,
  };
}

describe('buildPiArgs', () => {
  it('始终携带 --mode rpc，且为数组形式（不走 shell 拼接）', () => {
    const { argv } = buildPiArgs(baseReq(), { homeDir: HOME });
    expect(Array.isArray(argv)).toBe(true);
    expect(argv.slice(0, 2)).toEqual(['--mode', 'rpc']);
  });

  it('只读档（④）映射 --tools read,grep,find,ls', () => {
    const { argv } = buildPiArgs(baseReq({ permissionTier: 'read-only' }), { homeDir: HOME });
    const i = argv.indexOf('--tools');
    expect(i).toBeGreaterThan(-1);
    expect(argv[i + 1]).toBe('read,grep,find,ls');
  });

  it('非只读档不带 --tools', () => {
    for (const tier of ['yolo', 'notify-on-risky', 'ask'] as const) {
      const { argv } = buildPiArgs(baseReq({ permissionTier: tier }), { homeDir: HOME });
      expect(argv).not.toContain('--tools');
    }
  });

  it('显式 tools 优先于档位映射', () => {
    const { argv } = buildPiArgs(
      baseReq({ permissionTier: 'read-only', tools: ['read', 'grep'] }),
      { homeDir: HOME },
    );    const i = argv.indexOf('--tools');
    expect(argv[i + 1]).toBe('read,grep');
  });

  it('cwd：worktreePath > projectPath > home（默认工作区 P-05）', () => {
    expect(buildPiArgs(baseReq(), { homeDir: HOME }).cwd).toBe(HOME);
    expect(buildPiArgs(baseReq({ projectPath: 'D:\\proj' }), { homeDir: HOME }).cwd).toBe('D:\\proj');
    expect(
      buildPiArgs(baseReq({ projectPath: 'D:\\proj', worktreePath: 'D:\\wt' }), { homeDir: HOME }).cwd,
    ).toBe('D:\\wt');
  });

  it('cwd 不进 argv', () => {
    const { argv, cwd } = buildPiArgs(baseReq({ projectPath: 'D:\\my project' }), { homeDir: HOME });
    expect(argv.join(' ')).not.toContain('my project');
    expect(cwd).toBe('D:\\my project');
  });

  it('恢复参数：--session 路径优先于 --session-id（C-03）', () => {
    const { argv } = buildPiArgs(
      baseReq({ piSessionPath: 'D:\\sessions\\a.jsonl', piSessionId: 'pi-1' }),
      { homeDir: HOME },
    );    expect(argv).toEqual(expect.arrayContaining(['--session', 'D:\\sessions\\a.jsonl']));
    expect(argv).not.toContain('--session-id');
  });

  it('仅有 piSessionId 时用 --session-id', () => {
    const { argv } = buildPiArgs(baseReq({ piSessionId: 'pi-1' }), { homeDir: HOME });
    expect(argv).toEqual(expect.arrayContaining(['--session-id', 'pi-1']));
  });

  it('--name / --provider / --model / --thinking 按请求组装', () => {
    const { argv } = buildPiArgs(
      baseReq({
        title: '重构登录模块',
        model: { provider: 'anthropic', modelId: 'claude-sonnet-4-5' },
        thinking: 'high',
      }),
      { homeDir: HOME },
    );    expect(argv).toEqual(
      expect.arrayContaining([
        '--name',
        '重构登录模块',
        '--provider',
        'anthropic',
        '--model',
        'claude-sonnet-4-5',
        '--thinking',
        'high',
      ]),
    );
  });

  it('extraArgs 原样追加到末尾', () => {
    const { argv } = buildPiArgs(baseReq({ extraArgs: ['--no-banner'] }), { homeDir: HOME });
    expect(argv[argv.length - 1]).toBe('--no-banner');
  });

  it('title 含首尾空白时被裁剪；空 title 不产生 --name', () => {
    expect(buildPiArgs(baseReq({ title: '  hi  ' }), { homeDir: HOME })).toEqual(
      expect.objectContaining({ argv: expect.arrayContaining(['--name', 'hi']) }),
    );
    expect(buildPiArgs(baseReq({ title: '   ' }), { homeDir: HOME }).argv).not.toContain('--name');
  });

  it('extensionPath 注入 --extension（T03 审批扩展）；未提供时不出现', () => {
    const withExt = buildPiArgs(baseReq(), { homeDir: HOME, extensionPath: 'C:\\ext\\pi-agent-permissions' });
    const i = withExt.argv.indexOf('--extension');
    expect(i).toBeGreaterThan(0);
    expect(withExt.argv[i + 1]).toBe('C:\\ext\\pi-agent-permissions');
    // --mode rpc 仍在前（硬约束）
    expect(withExt.argv.slice(0, 2)).toEqual(['--mode', 'rpc']);

    const withoutExt = buildPiArgs(baseReq(), { homeDir: HOME });
    expect(withoutExt.argv).not.toContain('--extension');
  });
});
