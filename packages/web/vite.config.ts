/**
 * Vite 配置（架构 §2.5）：
 * - React + Tailwind 4 插件；@shared 别名
 * - 开发插件 host-info：读取 {appData}/pi-agent/host.json，把 {httpUrl,wsUrl,token,pid}
 *   注入 window.__PI_AGENT_HOST__（host 未启动时注入 null，前端进入离线模式提示）。
 *   拉起 host 进程由根 scripts/dev.mjs 负责（host 先起、写完 host.json 再起 vite）。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { HostEndpoint } from '@pi-agent/shared';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const SHARED_SRC = path.resolve(ROOT, 'packages/shared/src');

/** 读取 host.json（与 host/src/config/paths.ts 的目录逻辑一致） */
export function readHostEndpoint(): HostEndpoint | null {
  const envDir = process.env['PI_AGENT_DATA_DIR'];
  let file: string;
  if (envDir && envDir.length > 0) {
    file = path.join(envDir, 'host.json');
  } else if (process.platform === 'win32') {
    const appData = process.env['APPDATA'] ?? path.join(process.env['USERPROFILE'] ?? '', 'AppData', 'Roaming');
    file = path.join(appData, 'pi-agent', 'host.json');
  } else if (process.platform === 'darwin') {
    file = path.join(process.env['HOME'] ?? '', 'Library', 'Application Support', 'pi-agent', 'host.json');
  } else {
    const xdg = process.env['XDG_DATA_HOME'] ?? path.join(process.env['HOME'] ?? '', '.local', 'share');
    file = path.join(xdg, 'pi-agent', 'host.json');
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<HostEndpoint>;
    if (
      typeof parsed.httpUrl === 'string' &&
      typeof parsed.wsUrl === 'string' &&
      typeof parsed.token === 'string' &&
      typeof parsed.pid === 'number'
    ) {
      return parsed as HostEndpoint;
    }
    return null;
  } catch {
    return null;
  }
}

/** dev 插件：注入 host 端点到 window.__PI_AGENT_HOST__ */
function hostInfoPlugin(): Plugin {
  return {
    name: 'pi-agent-host-info',
    transformIndexHtml() {
      const endpoint = readHostEndpoint();
      return [
        {
          tag: 'script',
          children: `window.__PI_AGENT_HOST__ = ${JSON.stringify(endpoint)};`,
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), hostInfoPlugin()],
  resolve: {
    alias: {
      '@pi-agent/shared': path.resolve(SHARED_SRC, 'index.ts'),
      '@shared': SHARED_SRC,
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
