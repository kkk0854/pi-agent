/**
 * 扩展管理（X-03）：列出内置 + 用户扩展，启用/禁用（全局级）。
 * - 内置：随 host 安装的 extensions/（当前为内置审批扩展）
 * - 用户：appData/extensions/ 下的目录
 * - 启用状态持久化 appData/extensions.json（0600）；缺省 enabled=true
 * - 项目级启停（X-03 完整版）随会话粒度配置在 T05 评估
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppDirs } from '../config/paths';

export interface ExtensionInfo {
  id: string;
  name: string;
  enabled: boolean;
  scope: 'global';
  source: 'builtin' | 'user';
  path: string;
  /** package.json 的 description（缺失为 null） */
  description: string | null;
}

export interface ExtensionsRouteDeps {
  dirs: AppDirs;
  /** 内置扩展目录（host 装配处注入） */
  builtinDirs: string[];
  logger: { info(msg: string, fields?: Record<string, unknown>): void; warn(msg: string, fields?: Record<string, unknown>): void };
}

function statePath(dirs: AppDirs): string {
  return path.join(dirs.root, 'extensions.json');
}

function readEnabledMap(dirs: AppDirs): Record<string, boolean> {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(dirs), 'utf8')) as Record<string, unknown>;
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'boolean') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeEnabledMap(dirs: AppDirs, map: Record<string, boolean>): void {
  fs.writeFileSync(statePath(dirs), JSON.stringify(map, null, 2), { encoding: 'utf8', mode: 0o600 });
}

/**
 * 计算 pi spawn 的 --extension 参数（T05 遗留收口）：
 * - builtin + user 全扫描，respect extensions.json 启用态（缺省启用）
 * - 停用的内置审批扩展会被排除（审批治理随之关闭，由设置页明示）
 * 返回扁平 argv（['--extension', path, ...]），SessionManager 每次 spawn 时求值。
 */
export function spawnExtensionArgs(dirs: AppDirs, builtinDirs: string[]): string[] {
  const enabledMap = readEnabledMap(dirs);
  const args: string[] = [];
  for (const dir of builtinDirs) {
    for (const item of scanExtensions(dir, 'builtin')) {
      if (enabledMap[item.id] !== false) {
        args.push('--extension', item.path);
      }
    }
  }
  for (const item of scanExtensions(dirs.extensions, 'user')) {
    if (enabledMap[item.id] !== false) {
      args.push('--extension', item.path);
    }
  }
  return args;
}

/** 列举一个目录下的扩展子目录（含 package.json 才算） */
function scanExtensions(dir: string, source: ExtensionInfo['source']): { id: string; name: string; path: string; description: string | null }[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: { id: string; name: string; path: string; description: string | null }[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const full = path.join(dir, e.name);
    let manifest: { name?: unknown; description?: unknown } | null = null;
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(path.join(full, 'package.json'), 'utf8'));
      if (parsed !== null && typeof parsed === 'object') {
        manifest = parsed as { name?: unknown; description?: unknown };
      }
    } catch {
      continue; // 无 package.json 不算扩展
    }
    const name = typeof manifest?.name === 'string' ? manifest.name : e.name;
    const description = typeof manifest?.description === 'string' ? manifest.description : null;
    out.push({ id: `${source}:${e.name}`, name, path: full, description });
  }
  return out;
}

export function registerExtensionsRoutes(app: FastifyInstance, deps: ExtensionsRouteDeps): void {
  app.get('/v1/extensions', async (): Promise<{ extensions: ExtensionInfo[] }> => {
    const enabledMap = readEnabledMap(deps.dirs);
    const items: ExtensionInfo[] = [];
    for (const dir of deps.builtinDirs) {
      for (const item of scanExtensions(dir, 'builtin')) {
        items.push({ ...item, enabled: enabledMap[item.id] !== false, scope: 'global', source: 'builtin' });
      }
    }
    for (const item of scanExtensions(deps.dirs.extensions, 'user')) {
      items.push({ ...item, enabled: enabledMap[item.id] !== false, scope: 'global', source: 'user' });
    }
    return { extensions: items };
  });

  app.patch<{ Params: { id: string }; Body: { enabled?: boolean } }>(
    '/v1/extensions/:id',
    async (request, reply): Promise<ExtensionInfo | undefined> => {
      const { id } = request.params;
      const body = request.body ?? {};
      if (typeof body.enabled !== 'boolean') {
        void reply.code(400);
        return undefined;
      }
      // id 必须真实存在（builtin 或 user），防伪造持久化垃圾
      const all = [
        ...deps.builtinDirs.flatMap((dir) => scanExtensions(dir, 'builtin' as const)),
        ...scanExtensions(deps.dirs.extensions, 'user' as const),
      ];
      const target = all.find((e) => e.id === id);
      if (!target) {
        void reply.code(404);
        return undefined;
      }
      const map = readEnabledMap(deps.dirs);
      map[id] = body.enabled;
      writeEnabledMap(deps.dirs, map);
      deps.logger.info('扩展状态已更新', { id, enabled: body.enabled });
      return {
        id,
        name: target.name,
        enabled: body.enabled,
        scope: 'global',
        source: id.startsWith('builtin:') ? 'builtin' : 'user',
        path: target.path,
        description: target.description,
      };
    },
  );
}
