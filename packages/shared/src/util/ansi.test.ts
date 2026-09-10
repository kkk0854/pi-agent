/**
 * ansi.ts 单测：剥离 / 检测 / 转 token。
 * 用例来自实测 pi 0.85.0 的 setStatus.statusText。
 */
import { describe, expect, it } from 'vitest';
import { ansiToTokens, hasAnsi, stripAnsi } from './ansi';

/** 实测帧中的真彩色序列（\u001b[38;2;R;G;Bm ... \u001b[39m） */
const REAL_STATUS = '\u001B[38;2;138;190;183m🔌 MCP: 3 servers enabled\u001B[39m';

describe('hasAnsi', () => {
  it('检测真彩色 SGR 序列', () => {
    expect(hasAnsi(REAL_STATUS)).toBe(true);
  });
  it('纯文本为 false', () => {
    expect(hasAnsi('普通中文文本')).toBe(false);
  });
});

describe('stripAnsi', () => {
  it('剥离实测 setStatus.statusText', () => {
    expect(stripAnsi(REAL_STATUS)).toBe('🔌 MCP: 3 servers enabled');
  });
  it('剥离 256 色与粗体', () => {
    expect(stripAnsi('\u001B[1;32m✓ done\u001B[0m')).toBe('✓ done');
  });
  it('纯文本原样返回', () => {
    expect(stripAnsi('保持原样')).toBe('保持原样');
  });
  it('剥离 OSC 序列', () => {
    expect(stripAnsi('\u001B]0;title\u0007body')).toBe('body');
  });
});

describe('ansiToTokens', () => {
  it('带颜色的文本转为携带 SGR 的 token', () => {
    const tokens = ansiToTokens(REAL_STATUS);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.text).toBe('🔌 MCP: 3 servers enabled');
    expect(tokens[0]?.sgr).toBe('38;2;138;190;183');
  });

  it('多段颜色分别成 token', () => {
    const tokens = ansiToTokens('\u001B[31m红\u001B[0m普通\u001B[32m绿\u001B[0m');
    expect(tokens).toHaveLength(3);
    expect(tokens[0]).toEqual({ text: '红', sgr: '31' });
    expect(tokens[1]).toEqual({ text: '普通', sgr: undefined });
    expect(tokens[2]).toEqual({ text: '绿', sgr: '32' });
  });

  it('无 ANSI 时返回单 token 且无颜色', () => {
    const tokens = ansiToTokens('plain');
    expect(tokens).toEqual([{ text: 'plain', sgr: undefined }]);
  });
});
