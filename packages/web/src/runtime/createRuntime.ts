/**
 * createRuntime（架构 §3.7）：运行时选择与降级。
 * - settings.runtimeMode='mock' → 直接 Mock
 * - 'real' → host 端点必须健康（health 404/拒绝/超时 → 不信任 stale host.json，
 *   走「host 未运行」引导分支，降级 Mock 并给出理由）
 * - 'auto'（默认）→ 有健康端点走 real，否则 Mock
 */
import type { AgentRuntime, RuntimeInitConfig } from '@pi-agent/shared';
import { HostClient } from '../lib/hostClient';
import { HostAgentRuntime } from './HostAgentRuntime';
import { MockAgentRuntime } from './MockAgentRuntime';

export interface CreateRuntimeResult {
  runtime: AgentRuntime;
  mode: 'real' | 'mock';
  /** 降级 / 引导原因（UI 明示） */
  reason?: string;
  hostClient: HostClient | null;
}

export async function createRuntime(cfg: RuntimeInitConfig): Promise<CreateRuntimeResult> {
  const endpoint = cfg.host ?? null;
  const hostClient = endpoint ? new HostClient(endpoint) : null;

  /* 强制 Mock */
  if (cfg.mode === 'mock') {
    const runtime = new MockAgentRuntime();
    const caps = await runtime.init(cfg);
    void caps;
    return { runtime, mode: 'mock', reason: '设置指定 Mock 模式', hostClient: null };
  }

  /* 有端点：先探活（不信任 stale host.json） */
  if (endpoint) {
    const health = await HostClient.tryHealth(endpoint, 2000);
    if (health && health.ok) {
      try {
        const runtime = new HostAgentRuntime();
        await runtime.init(cfg);
        runtime.applyProbeVersion(health.pi.version ?? undefined);
        return { runtime, mode: 'real', hostClient };
      } catch (err) {
        // WS 握手失败也走引导分支
        const reason = `host 已启动但连接失败（${err instanceof Error ? err.message : '未知错误'}），已降级 Mock`;
        const runtime = new MockAgentRuntime();
        await runtime.init(cfg);
        return { runtime, mode: 'mock', reason, hostClient };
      }
    }
    // health 404 / 连接拒绝：host 未运行
    const reason =
      cfg.mode === 'real'
        ? 'host 未运行（host.json 已过期），已进入 Mock 模式。请运行 pnpm dev 启动宿主。'
        : 'host 未运行，已进入 Mock 模式。运行 pnpm dev 即可连接真实 pi。';
    const runtime = new MockAgentRuntime();
    await runtime.init(cfg);
    return { runtime, mode: 'mock', reason, hostClient: null };
  }

  /* 无端点（纯静态页 / host.json 缺失） */
  const runtime = new MockAgentRuntime();
  await runtime.init(cfg);
  return {
    runtime,
    mode: 'mock',
    reason: '未检测到本地宿主端点，已进入 Mock 模式。',
    hostClient: null,
  };
}
