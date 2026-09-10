/**
 * 文件变更监听（T04b 步骤 7 · chokidar）：
 * - 监听受信任项目根目录，防抖后把变更路径批量广播（WS sys 通道 fs.changed）
 * - host 不解析 pi 协议的不变量不受影响：watcher 只观察磁盘，不参与会话帧
 * - summarizeEvents 为纯函数（去重/截断），可单测
 */
import chokidar from 'chokidar';
import path from 'node:path';

export interface WatcherEvent {
  path: string;
  kind: 'add' | 'change' | 'unlink';
}

/** 默认忽略目录（与 routes.fs 的 SKIP_DIRS 口径一致） */
export const DEFAULT_IGNORED: readonly string[] = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.cache/**',
  '**/coverage/**',
];

/** 去重 + 相对化 + 截断（纯函数，可单测） */
export function summarizeEvents(
  events: WatcherEvent[],
  root: string,
  cap = 50,
): { root: string; paths: string[] } {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const e of events) {
    if (seen.has(e.path)) continue;
    seen.add(e.path);
    const rel = path.relative(path.resolve(root), path.resolve(e.path));
    paths.push(rel.length > 0 && !rel.startsWith('..') ? rel : e.path);
  }
  return { root, paths: paths.slice(0, cap) };
}

export interface ProjectWatcher {
  close(): Promise<void>;
}

export interface CreateWatcherOptions {
  roots: string[];
  /** 防抖窗口（ms），默认 500 */
  debounceMs?: number;
  /** 变更回调（按 root 分组、已去重截断） */
  onChange(grouped: { root: string; paths: string[] }[]): void;
  logger?: { warn(msg: string, fields?: Record<string, unknown>): void };
}

/** 创建受信任目录 watcher；chokidar 事件经防抖合并后回调 */
export function createProjectWatcher(opts: CreateWatcherOptions): ProjectWatcher {
  if (opts.roots.length === 0) {
    return { close: async () => undefined };
  }
  const debounceMs = opts.debounceMs ?? 500;
  /** root → 累积事件 */
  const buffers = new Map<string, WatcherEvent[]>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    timer = null;
    const grouped: { root: string; paths: string[] }[] = [];
    for (const [root, events] of buffers) {
      buffers.delete(root);
      if (events.length === 0) continue;
      grouped.push(summarizeEvents(events, root));
    }
    if (grouped.length > 0) opts.onChange(grouped);
  };

  const schedule = (): void => {
    if (timer !== null) return;
    timer = setTimeout(flush, debounceMs);
    timer.unref?.();
  };

  const watcher = chokidar.watch(opts.roots, {
    ignoreInitial: true,
    ignored: [...DEFAULT_IGNORED],
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
  });

  const record = (kind: WatcherEvent['kind']) => (filePath: string): void => {
    for (const root of opts.roots) {
      const absRoot = path.resolve(root);
      const absFile = path.resolve(filePath);
      if (absFile === absRoot || absFile.startsWith(absRoot + path.sep)) {
        const list = buffers.get(root) ?? [];
        list.push({ path: filePath, kind });
        buffers.set(root, list);
        break;
      }
    }
    schedule();
  };

  watcher.on('add', record('add'));
  watcher.on('change', record('change'));
  watcher.on('unlink', record('unlink'));
  watcher.on('error', (err: unknown) => {
    opts.logger?.warn('fs watcher 异常', { message: err instanceof Error ? err.message : String(err) });
  });

  return {
    close: async () => {
      if (timer !== null) clearTimeout(timer);
      await watcher.close();
    },
  };
}
