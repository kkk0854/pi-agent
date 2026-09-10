/**
 * 版本 → 能力矩阵（R-06）。基准：pi 0.85.0 实测全量支持。
 * 老版本走 supports=false 降级（UI 明示），不保证可用性。
 */
import type { RuntimeCapabilities } from './AgentRuntime';

/** 当前基线版本 */
export const PI_SUPPORTED_VERSION = '0.85.0';

/** 解析 '0.85.0' / '0.85.0-beta.1' → [0, 85, 0, ...]（忽略非数字后缀） */
export function parseVersion(version: string): number[] {
  return version
    .trim()
    .replace(/^v/, '')
    .split(/[.\-+]/)
    .map((part) => Number.parseInt(part, 10))
    .map((n) => (Number.isNaN(n) ? 0 : n));
}

/** 语义化版本比较：a<b → -1，a=b → 0，a>b → 1 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va !== vb) return va < vb ? -1 : 1;
  }
  return 0;
}

/** pi 0.85.0 实测：全部能力可用 */
const FULL_SUPPORT: RuntimeCapabilities['supports'] = {
  fork: true,
  tree: true,
  stats: true,
  commands: true,
  thinkingLevel: true,
  modelSwitch: true,
  compaction: true,
  autoRetry: true,
  extensionUI: true,
  bash: true,
  exportHtml: true,
  images: true,
  queueModes: true,
};

/** 无版本信息时（探测失败）的最小能力集 */
const MINIMAL_SUPPORT: RuntimeCapabilities['supports'] = {
  fork: false,
  tree: false,
  stats: false,
  commands: false,
  thinkingLevel: false,
  modelSwitch: false,
  compaction: false,
  autoRetry: false,
  extensionUI: true, // extension_ui_request 在低版本同样存在
  bash: true,
  exportHtml: false,
  images: true,
  queueModes: false,
};

/**
 * 按版本返回能力矩阵。
 * @param version pi --version 输出（如 '0.85.0'），缺失视为未知版本
 * @param mode real / mock
 */
export function capabilitiesForVersion(
  version?: string,
  mode: 'real' | 'mock' = 'real',
): RuntimeCapabilities {
  if (!version) {
    return {
      mode,
      supports: MINIMAL_SUPPORT,
      reason: mode === 'mock' ? 'Mock 模式' : '未获取到 pi 版本，已按最小能力集降级',
    };
  }
  const sufficient = compareVersions(version, PI_SUPPORTED_VERSION) >= 0;
  return {
    mode,
    piVersion: version,
    supports: sufficient ? FULL_SUPPORT : MINIMAL_SUPPORT,
    ...(sufficient ? {} : { reason: `pi ${version} 低于基线 ${PI_SUPPORTED_VERSION}，部分能力已降级` }),
  };
}
