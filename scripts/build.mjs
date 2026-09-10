/**
 * 构建编排：T01 阶段仅构建 web 产物（vite build）。
 * shared 以 TS 源码形式被 web/host 直接消费（moduleResolution: bundler + tsx），
 * host 打包 sidecar（make-sidecar.mjs）留待 T05。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const result = spawnSync('pnpm', ['-C', 'packages/web', 'build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  cwd: ROOT,
  env: process.env,
});

if (result.status !== 0) {
  process.stderr.write('[build] web 构建失败\n');
  process.exit(result.status ?? 1);
}
process.stdout.write('[build] 完成（T01：仅 web 产物；shared/host 随 dev 运行，无需独立构建）\n');
