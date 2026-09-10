/**
 * 诊断（V-02）：一键体检 pi 找到/版本/鉴权/Provider 连通/项目可写/日志路径。
 * 输出 pass-warn-fail 结构化报告（设置页展示 + 一键复制脱敏报告）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { DoctorCheck, DoctorReport } from '@pi-agent/shared';
import type { PiProbe } from '../pi/probe';
import type { AppDirs } from '../config/paths';

export interface DoctorDeps {
  probe: PiProbe;
  dirs: AppDirs;
  logger: { info(msg: string, fields?: Record<string, unknown>): void };
}

/** Provider 连通性：对 baseUrl 的 /v1/models 发无凭据 HEAD/GET，任何 HTTP 响应即视为可达 */
async function checkProviderReachable(baseUrl: string, timeoutMs = 5000): Promise<{ ok: boolean; detail: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/v1/models`;
    const res = await fetch(url, { signal: ctrl.signal });
    // 401/403 也算「网络可达」（鉴权单独判定，避免把网关挂掉误报为 key 错）
    return { ok: true, detail: `HTTP ${res.status}（网络可达）` };
  } catch (err) {
    return { ok: false, detail: `无法连接：${err instanceof Error ? err.message : String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

/** 从 pi 配置目录解析 baseUrl（models.json 的 providers[*].baseUrl，取第一个） */
function resolveProviderBaseUrl(): string | null {
  const candidates = [
    path.join(os.homedir(), '.pi', 'agent', 'models.json'),
    path.join(os.homedir(), '.pi', 'agent', 'config.json'),
  ];
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        providers?: Record<string, { baseUrl?: string }>;
        models?: Record<string, { baseUrl?: string }>;
      };
      const pools = [parsed.providers, parsed.models];
      for (const pool of pools) {
        if (!pool) continue;
        for (const cfg of Object.values(pool)) {
          if (cfg && typeof cfg.baseUrl === 'string' && cfg.baseUrl.startsWith('http')) {
            return cfg.baseUrl;
          }
        }
      }
    } catch {
      // 下一候选
    }
  }
  return null;
}

export async function runDoctor(deps: DoctorDeps): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  /* 1. pi 可执行 */
  checks.push(
    deps.probe.found
      ? { id: 'pi-found', label: 'pi 可执行文件', verdict: 'pass', detail: deps.probe.path ?? '已找到' }
      : { id: 'pi-found', label: 'pi 可执行文件', verdict: 'fail', detail: deps.probe.message },
  );

  /* 2. 版本基线 */
  if (deps.probe.found) {
    checks.push(
      deps.probe.meetsBaseline
        ? { id: 'pi-version', label: 'pi 版本', verdict: 'pass', detail: deps.probe.version ?? '未知' }
        : { id: 'pi-version', label: 'pi 版本', verdict: 'warn', detail: `${deps.probe.version ?? '未知'}（低于功能基线 0.85.0，部分能力将降级）` },
    );
    /* 3. 鉴权：探测信息不足以判定 API key，标记 warn 提示实跑验证 */
    checks.push({
      id: 'pi-auth',
      label: 'Provider 鉴权',
      verdict: 'warn',
      detail: '鉴权依赖 pi 自身配置（~/.pi/agent），请通过实际对话验证；401 时检查 models.json 的 apiKey。',
    });
    /* 4. Provider 连通 */
    const baseUrl = resolveProviderBaseUrl();
    if (baseUrl) {
      const reach = await checkProviderReachable(baseUrl);
      checks.push({
        id: 'provider-reach',
        label: 'Provider 网络连通',
        verdict: reach.ok ? 'pass' : 'fail',
        detail: `${baseUrl} → ${reach.detail}`,
      });
    } else {
      checks.push({ id: 'provider-reach', label: 'Provider 网络连通', verdict: 'warn', detail: '未在 ~/.pi/agent 配置中找到 baseUrl' });
    }
  }

  /* 5. 数据目录可写 */
  try {
    const probeFile = path.join(deps.dirs.root, '.doctor-probe');
    fs.writeFileSync(probeFile, 'ok', 'utf8');
    fs.unlinkSync(probeFile);
    checks.push({ id: 'data-writable', label: '数据目录可写', verdict: 'pass', detail: deps.dirs.root });
  } catch (err) {
    checks.push({
      id: 'data-writable',
      label: '数据目录可写',
      verdict: 'fail',
      detail: `${deps.dirs.root}：${err instanceof Error ? err.message : String(err)}`,
    });
  }

  /* 6. 日志路径 */
  checks.push(
    fs.existsSync(deps.dirs.logs)
      ? { id: 'logs-path', label: '日志目录', verdict: 'pass', detail: deps.dirs.logs }
      : { id: 'logs-path', label: '日志目录', verdict: 'warn', detail: `${deps.dirs.logs}（尚不存在，首次写日志时创建）` },
  );

  deps.logger.info('诊断完成', {
    pass: checks.filter((c) => c.verdict === 'pass').length,
    warn: checks.filter((c) => c.verdict === 'warn').length,
    fail: checks.filter((c) => c.verdict === 'fail').length,
  });
  return { at: new Date().toISOString(), checks };
}

export function registerDoctorRoute(app: FastifyInstance, deps: DoctorDeps): void {
  app.get('/v1/doctor', async () => runDoctor(deps));
}
