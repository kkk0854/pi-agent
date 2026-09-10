/** changesPipeline 单测（T04b：ChangeFile 映射） */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  isWriteTool,
  pathOfWriteInput,
  buildChangeInput,
  trackWriteToolStart,
  takeWriteToolEnd,
  resetWriteTracking,
} from './changesPipeline';

describe('isWriteTool', () => {
  it('识别写类工具（大小写/空白容忍）', () => {
    expect(isWriteTool('write')).toBe(true);
    expect(isWriteTool(' Edit ')).toBe(true);
    expect(isWriteTool('Multi_Edit')).toBe(true);
    expect(isWriteTool('write_file')).toBe(true);
  });
  it('读类工具不是写', () => {
    expect(isWriteTool('read')).toBe(false);
    expect(isWriteTool('grep')).toBe(false);
    expect(isWriteTool('bash')).toBe(false);
  });
});

describe('pathOfWriteInput', () => {
  it('常见键名逐个探测', () => {
    expect(pathOfWriteInput({ path: 'a.ts' })).toBe('a.ts');
    expect(pathOfWriteInput({ file_path: 'b.py' })).toBe('b.py');
    expect(pathOfWriteInput({ filePath: 'c.go' })).toBe('c.go');
    expect(pathOfWriteInput({ target: 'd.rs' })).toBe('d.rs');
    expect(pathOfWriteInput({ file: 'e.java' })).toBe('e.java');
  });
  it('嵌套 args/input 也能找到', () => {
    expect(pathOfWriteInput({ args: { path: 'nested.ts' } })).toBe('nested.ts');
    expect(pathOfWriteInput({ input: { file_path: 'nested2.ts' } })).toBe('nested2.ts');
  });
  it('无路径返回 null', () => {
    expect(pathOfWriteInput({ command: 'ls' })).toBeNull();
    expect(pathOfWriteInput(null)).toBeNull();
    expect(pathOfWriteInput({ path: '' })).toBeNull();
  });
});

describe('buildChangeInput', () => {
  it('modified 可得时构建（original 可为 null）', () => {
    const input = buildChangeInput({ toolName: 'write', path: 'a.ts', original: null, modified: 'new' });
    expect(input).toEqual({ path: 'a.ts', original: null, modified: 'new' });
  });
  it('modified 读取失败返回 null（跳过）', () => {
    expect(buildChangeInput({ toolName: 'write', path: 'a.ts', original: 'old', modified: null })).toBeNull();
  });
});

describe('在途写工具登记', () => {
  beforeEach(() => resetWriteTracking());

  it('start 登记 → end 取回并清除', () => {
    expect(trackWriteToolStart('t1', 'write', { path: 'a.ts' })).toBe('a.ts');
    expect(takeWriteToolEnd('t1')).toBe('a.ts');
    expect(takeWriteToolEnd('t1')).toBeNull();
  });
  it('非写工具不登记', () => {
    expect(trackWriteToolStart('t2', 'read', { path: 'a.ts' })).toBeNull();
    expect(takeWriteToolEnd('t2')).toBeNull();
  });
  it('无法确定路径不登记', () => {
    expect(trackWriteToolStart('t3', 'edit', { command: 'x' })).toBeNull();
    expect(takeWriteToolEnd('t3')).toBeNull();
  });
});
