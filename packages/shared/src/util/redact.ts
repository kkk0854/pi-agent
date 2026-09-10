/**
 * 凭据脱敏（R-08 / Q-03，硬性）：写日志前必须过 redact。
 * 覆盖：sk-*、sk-ant-*、Bearer、api_key/token/secret/password 赋值、
 * ghp_/gho_/ghs_/ghu_、xoxb-、AKIA、私钥块、URL query 中的 key/token。
 */

interface RedactPattern {
  name: string;
  pattern: RegExp;
  replacement: string;
}

/** 替换为固定占位符（保留长度信息有助于排查但避免泄露，统一用 [REDACTED]） */
const MASK = '[REDACTED]';

export const REDACT_PATTERNS: readonly RedactPattern[] = [
  // 注意：anthropic 前缀必须先于通用 sk- 匹配，否则会被通用规则先吃掉
  { name: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{8,}\b/g, replacement: 'sk-ant-[REDACTED]' },
  { name: 'openai-key', pattern: /\bsk-[A-Za-z0-9_-]{8,}\b/g, replacement: 'sk-[REDACTED]' },
  { name: 'bearer', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, replacement: 'Bearer [REDACTED]' },
  { name: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, replacement: 'gh?_[REDACTED]' },
  { name: 'slack-token', pattern: /\bxox[bpars]-[A-Za-z0-9-]{10,}\b/g, replacement: 'xox?-[REDACTED]' },
  { name: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: 'AKIA[REDACTED]' },
  {
    name: 'kv-credential',
    // api_key / apikey / token / secret / password / access_token 的赋值右侧
    pattern: /\b(api[_-]?key|apikey|access[_-]?token|token|secret|password|passwd|pwd)\b(['"]?\s*[:=]\s*)(['"]?)[^\s'",;}&)\]]{4,}/gi,
    replacement: '$1$2$3[REDACTED]',
  },
  {
    name: 'url-query',
    // URL query 中的 key/token/access_token/api_key
    pattern: /([?&](?:key|token|access_token|api_key|apikey|sig|signature)=)[^&\s'"]+/gi,
    replacement: '$1[REDACTED]',
  },
  {
    name: 'private-key-block',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '-----PRIVATE KEY [REDACTED]-----',
  },
  { name: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/g, replacement: 'AIza[REDACTED]' },
];

/** 对任意文本做脱敏（日志唯一入口的强制步骤） */
export function redact(text: string): string {
  let out = text;
  for (const { pattern, replacement } of REDACT_PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** 递归脱敏对象/数组；基本类型转字符串后处理；返回新结构（不改原值） */
export function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redact(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message), stack: redact(value.stack ?? '') };
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // 键名本身就是凭据类（如 { apiKey: '...' }）：直接整体遮蔽
      if (/^(api[_-]?key|apikey|secret|password|token)$/i.test(k)) {
        out[k] = MASK;
      } else {
        out[k] = redactValue(v);
      }
    }
    return out;
  }
  return redact(String(value));
}
