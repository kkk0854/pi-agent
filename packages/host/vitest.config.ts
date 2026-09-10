import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // 临时目录固定到 node_modules 下：避免 vitest/jsdom 的临时产物落到仓库根目录
    pool: 'forks',
  },
  cacheDir: 'node_modules/.vite-host-test',
});
