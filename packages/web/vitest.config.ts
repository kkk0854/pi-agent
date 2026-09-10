/** Vitest 独立配置（不加载 vite.config 的插件，避免 dev 专用插件干扰测试） */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHARED_SRC = path.resolve(HERE, '../shared/src');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@pi-agent/shared': path.resolve(SHARED_SRC, 'index.ts'),
      '@shared': SHARED_SRC,
      '@': path.resolve(HERE, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // 临时目录固定到 node_modules 下：避免 jsdom/vitest 的临时产物（快照等）落到仓库根目录
    pool: 'forks',
  },
  cacheDir: 'node_modules/.vite-web-test',
});
