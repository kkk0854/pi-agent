/**
 * host 入口（T02 版）：
 * 解析参数 → 定位 appData → 载入设置 → pi 探测 → 装配 WorkspaceStore / PiSpawner /
 * SessionManager / PiBridge → 起 HTTP/WS（REST 路由 + health pi 字段）→ 写 host.json（0600）
 * → 注册退出清理（回收全部 pi 子进程）。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { newId, type HealthInfo } from '@pi-agent/shared';
import { resolveAppDirs, writeHostInfo, removeHostInfo } from './config/paths';
import { loadSettings } from './config/settings';
import { Logger } from './log/logger';
import { probePi } from './pi/probe';
import { PiSpawner } from './pi/spawn';
import { SessionManager } from './runtime/SessionManager';
import { PiBridge } from './runtime/PiBridge';
import { WorkspaceStore } from './server/workspaceStore';
import { registerWorkspaceRoutes } from './server/routes.workspace';
import { registerFsRoutes } from './server/routes.fs';
import { registerMediaRoutes } from './server/media';
import { registerPermissionsRoutes } from './server/routes.permissions';
import { registerDoctorRoute } from './server/doctor';
import { registerGitRoutes } from './server/routes.git';
import { registerUsageRoutes } from './server/usage';
import { registerAutomationsRoutes } from './server/automations';
import { registerSecretsRoutes, migrateSecretsToKeychain } from './server/secrets';
import { registerSessionApi } from './server/sessionApi';
import { createMirror } from './server/mirror';
import { registerWorktreeRoutes } from './git/worktree';
import { registerExtensionsRoutes, spawnExtensionArgs } from './server/extensions';
import { createProjectWatcher } from './fs/watcher';
import { startHttpServer } from './server/http';
import { HOST_VERSION } from './version';

/**
 * 内置审批扩展路径（仓库根 extensions/pi-agent-permissions，T03）。
 * T05：esbuild bundle 成 CJS 后 import.meta 不可用，改为多候选解析——
 * 1) 桌面壳注入 PI_AGENT_EXTENSION_DIR（Tauri sidecar / 安装包资源目录）
 * 2) cwd 候选（pnpm dev 在仓库根 / packages/host 运行）
 */
function resolveExtensionDir(): string {
  const envDir = process.env['PI_AGENT_EXTENSION_DIR'];
  if (envDir && envDir.length > 0 && fs.existsSync(envDir)) return path.resolve(envDir);
  const candidates = [
    path.resolve('extensions/pi-agent-permissions'),
    path.resolve('../extensions/pi-agent-permissions'),
    path.resolve('../../extensions/pi-agent-permissions'),
    path.resolve('../../../extensions/pi-agent-permissions'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // 兜底：审批扩展缺失不致命（doctor/health 呈现 found:false）
  return candidates[0]!;
}

const EXTENSION_DIR = resolveExtensionDir();

async function main(): Promise<void> {
  const dirs = resolveAppDirs();
  const logger = new Logger({ logDir: dirs.logs, level: 'info' });
  const settings = loadSettings(dirs, logger);

  // pi 探测（R-04/R-06）：结果喂给 spawner 与 health
  const probe = await probePi(settings.piPath);
  logger.info('pi 探测完成', { found: probe.found, version: probe.version, path: probe.path });

  const store = new WorkspaceStore(dirs);

  // 装配 SessionManager ↔ PiSpawner（回调相互引用，闭包惰性解析）
  const manager = new SessionManager(
    // spawner 适配器：spawn 时才解引用 spawner（此时必然已初始化）
    { spawn: (o) => spawner.spawn(o) },
    {
      onLines: (id, lines) => bridge.onSessionLines(id, lines),
      onExit: (id, payload) => bridge.onSessionExit(id, payload),
    },
    { idleRecycleMs: settings.idleRecycleMs, logger,
      // T05：扩展启用态接线——每次 spawn 时按 extensions.json 求值（停用的不进 --extension）
      extraExtensionArgs: () => spawnExtensionArgs(dirs, [EXTENSION_DIR]) },
  );

  const spawner = new PiSpawner(
    probe,
    {
      onLines: (label, lines) => manager._handleSpawnLines(label, lines),
      onStderr: (label, chunk) => manager._handleSpawnStderr(label, chunk),
      onExit: (label, _p, info) => manager._handleSpawnExit(label, info),
      onError: (label, err) => manager._handleSpawnError(label, err),
      onIdle: (label) => manager._handleSpawnIdle(label),
      logger,
    },
    settings.maxConcurrentAgents,
    settings.idleRecycleMs,
  );

  // 手机镜像（T04b 步骤 5 · B-01/02/03/06）：先于 bridge 创建，广播旁路在其后接通
  const mirror = createMirror({
    dirs,
    logger,
    sessions: () =>
      store.listSessions({ includeArchived: true }).map((s) => ({
        id: s.id,
        title: s.title,
        projectId: s.projectId,
        status: s.status,
        updatedAt: s.updatedAt,
      })),
    // 写 ACL 开启后：直接按 appSessionId 定位会话（镜像页自带会话选择）
    promptSender: (sessionId, prompt) => {
      const live = manager.get(sessionId);
      if (!live || live.status === 'closed' || live.status === 'error') return false;
      const line = JSON.stringify({ id: newId(), type: 'prompt', message: prompt });
      return manager.write(sessionId, line);
    },
  });

  // hub 在 listen 之后才存在，用持有器惰性广播；同时把会话原始行喂给镜像（旁路，不改 relay 语义）
  let hubRef: { broadcast(frame: { ch: string; type: string; payload?: unknown }): void } | null = null;
  const bridge = new PiBridge({
    sessions: manager,
    broadcast: (frame) => {
      hubRef?.broadcast(frame);
      mirror.ingestFrame(frame);
    },
    logger,
    // 默认模型兜底：pi 0.85 在部分环境忽略自身 defaultProvider 设置，落 401 provider
    defaultModel: settings.defaultModel,
  });

  logger.info('host 启动中', {
    version: HOST_VERSION,
    pid: process.pid,
    dataDir: dirs.root,
    maxConcurrentAgents: settings.maxConcurrentAgents,
  });

  // 令牌：每次启动随机生成，写入 host.json（0600），前端经构建注入读取
  const token = newId() + newId();

  // Z-10：桌面壳场景（keybridge 已注入）→ 启动即迁移文件态密钥到系统钥匙串
  void migrateSecretsToKeychain(dirs).catch(() => undefined);

  const server = await startHttpServer({
    token,
    logger,
    // health 的 pi 字段：真实 probe 数据（T02 出口要求）
    piInfo: (): HealthInfo['pi'] => ({
      found: probe.found,
      version: probe.version ?? null,
      path: probe.path ?? null,
    }),
    // WS 会话帧 → PiBridge（封套路由：session.open/write/close）
    sessionHandler: (frame) => bridge.handleFrame(frame),
    register: (app) => {
      registerWorkspaceRoutes(app, { store, dirs, logger });
      // T04b：PUT /v1/fs/write 的写入白名单 = 已添加的项目根目录（还原走治理通道）
      registerFsRoutes(app, { logger, trustedRoots: () => store.listProjects().map((p) => p.path) });
      registerMediaRoutes(app, { token, logger });
      // T03 治理域
      registerPermissionsRoutes(app, { dirs, logger });
      registerDoctorRoute(app, { probe, dirs, logger });
      registerGitRoutes(app, { logger });
      registerUsageRoutes(app, { dirs });
      registerSecretsRoutes(app, { dirs });
      // T04b 步骤 4：本地 REST 会话 API（E-01..E-04 · C-05 幂等）
      registerSessionApi(app, { store, manager, dirs, logger });
      // T04b 步骤 7：worktree 创建/绑定（G-01/G-02）
      registerWorktreeRoutes(app, { store, logger });
      // T04b 步骤 7：扩展面板数据源（X-03；builtin = 内置审批扩展目录）
      registerExtensionsRoutes(app, { dirs, builtinDirs: [EXTENSION_DIR], logger });
      // T04b 步骤 5：镜像路由（/mirror 静态页 + /mirror/api + /v1/mirror 管理）
      mirror.registerRoutes(app);
      registerAutomationsRoutes(app, {
        dirs,
        logger,
        // U-05：投递到目标项目第一个 ready 会话（无则 skipped）；prompt 直写 stdin（host 不解析）
        promptSender: (projectId, prompt) => {
          const project = projectId != null ? store.listProjects().find((p) => p.id === projectId) : undefined;
          const target = manager
            .list()
            .find((s) => s.status === 'ready' && s.attached && (project ? s.cwd === project.path : true));
          if (!target) return false;
          const line = JSON.stringify({ id: newId(), type: 'prompt', message: prompt });
          return manager.write(target.appSessionId, line);
        },
      });
    },
  });
  hubRef = server.hub;

  // 镜像（T04b）：回填端口（局域网地址用）+ 挂只读 WS upgrade
  mirror.setPort(server.port);
  mirror.attachWs(server.rawServer);

  // 文件变更监听（T04b 步骤 7）：受信任项目根目录 → sys 通道 fs.changed
  // T05：项目增删后动态重挂（10s 轮询根集合，变化即关旧建新）
  const onFsChanged = (grouped: { root: string; paths: string[] }[]): void => {
    hubRef?.broadcast({ ch: 'sys', type: 'fs.changed', payload: { changes: grouped } });
  };
  let watcher = createProjectWatcher({
    roots: store.listProjects().map((p) => p.path),
    onChange: onFsChanged,
    logger,
  });
  let watchedRoots = store.listProjects().map((p) => p.path).sort().join('\n');
  const watcherRemountTimer = setInterval(() => {
    const nextRoots = store.listProjects().map((p) => p.path);
    const nextKey = nextRoots.slice().sort().join('\n');
    if (nextKey === watchedRoots) return;
    watchedRoots = nextKey;
    const old = watcher;
    void old.close().then(() => {
      if (nextRoots.length > 0) {
        watcher = createProjectWatcher({ roots: nextRoots, onChange: onFsChanged, logger });
        logger.info('fs watcher 已按项目列表重挂', { roots: nextRoots });
      }
    });
  }, 10_000);
  watcherRemountTimer.unref?.();

  const endpoint = {
    httpUrl: server.httpUrl,
    wsUrl: server.wsUrl,
    token,
    pid: process.pid,
    version: HOST_VERSION,
    startedAt: new Date().toISOString(),
  };
  writeHostInfo(dirs, endpoint);
  logger.info('host.json 已写入（0600）', {
    httpUrl: endpoint.httpUrl,
    wsUrl: endpoint.wsUrl,
    pi: probe.found ? `${probe.version} @ ${probe.path}` : '未找到',
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('host 退出中', { signal, activeSessions: manager.count() });
    void (async () => {
      try {
        clearInterval(watcherRemountTimer); // 停止重挂轮询
        await bridge.dispose(); // 回收全部 pi 子进程
        await watcher.close(); // 停止文件监听
        mirror.dispose(); // 关闭镜像 WS 客户端
        await server.close();
        removeHostInfo(dirs);
        await logger.flush();
      } finally {
        process.exit(0);
      }
    })();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    logger.error('未捕获异常', { message: err.message, stack: err.stack });
    shutdown('uncaughtException');
  });
}

main().catch((err: unknown) => {
  console.error(`[host] 启动失败：${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
