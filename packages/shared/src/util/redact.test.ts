/**
 * redact.ts 单测：各类凭据形态必须被遮蔽。
 */
import { describe, expect, it } from 'vitest';
import { redact, redactValue } from './redact';

describe('redact（字符串）', () => {
  it.each([
    ['sk-abc1234567890abcdef', 'sk-'],
    ['sk-ant-api03-xxxxxxxxxxxxxxxxxxxx', 'sk-ant-[REDACTED]'],
    ['Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'Bearer [REDACTED]'],
    ['ghp_0123456789abcdefghijklmnopqrstuvwxyz', 'gh?_[REDACTED]'],
    ['xoxb-123456789012-1234567890123-abcdefghijklmnop', 'xox?-[REDACTED]'],
    ['AKIAIOSFODNN7EXAMPLE', 'AKIA[REDACTED]'],
    ['AIzaSyD-1234567890abcdefghijklmnopqrstuv', 'AIza[REDACTED]'],
  ])('遮蔽 %s 类凭据', (input, startsWith) => {
    const out = redact(input);
    expect(out.startsWith(startsWith)).toBe(true);
    expect(out).not.toContain(input);
  });

  it('遮蔽 api_key/token/secret/password 赋值', () => {
    expect(redact('api_key = "super-secret-value-123"')).not.toContain('super-secret');
    expect(redact('{"token":"abc123456789"}')).not.toContain('abc123456789');
    expect(redact('password: hunter2secret')).not.toContain('hunter2secret');
  });

  it('遮蔽 URL query 中的 token', () => {
    const out = redact('https://example.com/v1/data?token=abc123def456&page=2');
    expect(out).not.toContain('abc123def456');
    expect(out).toContain('page=2');
  });

  it('遮蔽私钥块', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAK\n-----END RSA PRIVATE KEY-----';
    expect(redact(pem)).toBe('-----PRIVATE KEY [REDACTED]-----');
  });

  it('不含凭据的文本原样保留', () => {
    const text = 'npm test 通过，12 个用例，耗时 3.2s';
    expect(redact(text)).toBe(text);
  });
});

describe('redactValue（结构化）', () => {
  it('对象中的凭据键整体遮蔽', () => {
    const out = redactValue({ apiKey: 'sk-very-secret', name: 'my-gateway' }) as Record<string, unknown>;
    expect(out['apiKey']).toBe('[REDACTED]');
    expect(out['name']).toBe('my-gateway');
  });

  it('嵌套结构递归脱敏', () => {
    const out = redactValue({ env: { TOKEN: 'token=abcdef123456' }, list: [1, 'ghp_0123456789abcdefghijklmnopqrstuvwxyz'] }) as Record<string, unknown>;
    const env = out['env'] as Record<string, unknown>;
    const list = out['list'] as unknown[];
    expect(String(env['TOKEN'])).not.toContain('abcdef123456');
    expect(String(list[1])).not.toContain('0123456789');
  });

  it('Error 对象脱敏后保留类型信息', () => {
    const out = redactValue(new Error('request failed with api_key=sk-abcdefgh12345678')) as {
      name: string;
      message: string;
    };
    expect(out['name']).toBe('Error');
    expect(out['message']).not.toContain('sk-abcdefgh12345678');
  });

  it('基本类型原样返回', () => {
    expect(redactValue(42)).toBe(42);
    expect(redactValue(true)).toBe(true);
    expect(redactValue(null)).toBe(null);
  });
});
