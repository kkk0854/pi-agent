/* eslint-disable no-irregular-whitespace -- U+2028/U+2029 正是本测试的验证对象 */
/**
 * jsonl.ts 单测：严格 \n 分帧（禁 readline 语义）。
 * 重点：CRLF trim、U+2028/U+2029 不切分、部分行缓冲、跨 chunk 切分、end() 冲刷。
 */
import { describe, expect, it } from 'vitest';
import { createJsonlSplitter, encodeJsonl } from './jsonl';

describe('createJsonlSplitter', () => {
  it('单 chunk 多行', () => {
    const s = createJsonlSplitter();
    expect(s.push('{"a":1}\n{"b":2}\n{"c":3}\n')).toEqual([
      '{"a":1}',
      '{"b":2}',
      '{"c":3}',
    ]);
    expect(s.end()).toEqual([]);
  });

  it('部分行缓冲：跨 chunk 的行在补齐后返回', () => {
    const s = createJsonlSplitter();
    expect(s.push('{"a":1}\n{"b"')).toEqual(['{"a":1}']);
    expect(s.push(':2}\n')).toEqual(['{"b":2}']);
    expect(s.end()).toEqual([]);
  });

  it('end() 冲出未以 \\n 结尾的最后一线', () => {
    const s = createJsonlSplitter();
    expect(s.push('line-1\npartial')).toEqual(['line-1']);
    expect(s.end()).toEqual(['partial']);
  });

  it('CRLF：行尾 \\r 被剔除', () => {
    const s = createJsonlSplitter();
    expect(s.push('{"a":1}\r\n{"b":2}\r\n')).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('U+2028 / U+2029 不作为分隔符（禁 readline 的核心原因）', () => {
    const s = createJsonlSplitter();
    const line = `{"text":"行内含 U+2028 U+2029 结束"}`;
    expect(s.push(`${line}\n`)).toEqual([line]);
  });

  it('JSON 字符串内的转义 \\n 不会误切', () => {
    const s = createJsonlSplitter();
    const obj = { message: '第一行\n第二行' };
    expect(s.push(encodeJsonl(obj))).toEqual(['{"message":"第一行\\n第二行"}']);
  });

  it('空行被跳过', () => {
    const s = createJsonlSplitter();
    expect(s.push('\n\n{"a":1}\n\n')).toEqual(['{"a":1}']);
  });

  it('高频小 chunk（逐字符喂入）结果正确', () => {
    const s = createJsonlSplitter();
    const input = '{"x":42}\n{"y":"z"}\n';
    const out: string[] = [];
    for (const ch of input) out.push(...s.push(ch));
    out.push(...s.end());
    expect(out).toEqual(['{"x":42}', '{"y":"z"}']);
  });
});
