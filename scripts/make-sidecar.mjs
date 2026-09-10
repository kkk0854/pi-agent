/**
 * make-sidecar.mjs（T05 · Z-01）：把 packages/host 打包成 Tauri sidecar。
 * 方案：esbuild bundle（host 全依赖内联，含 workspace @pi-agent/shared 源码）
 *   + 复制当前 Node 运行时为独立 exe（pi-agent-host-<triple>.exe）→ Rust 端
 *   `node-copy.exe pi-agent-host.cjs` 启动，等于内嵌 Node runtime，无需系统安装 Node。
 * 产物：
 *   src-tauri/binaries/pi-agent-host.cjs
 *   src-tauri/binaries/pi-agent-host-<target-triple>.exe
 */
import { createRequire } from 'node:module';
import { mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repoRoot, 'src-tauri', 'binaries');
mkdirSync(outDir, { recursive: true });

// esbuild 从根 devDependencies 解析（pnpm -w 安装）
const require = createRequire(path.join(repoRoot, 'package.json'));
const esbuild = require('esbuild');

await esbuild.build({
  entryPoints: [path.join(repoRoot, 'packages', 'host', 'src', 'index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: path.join(outDir, 'pi-agent-host.cjs'),
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  // host 通过工作区符号链接引用 shared 源码（exports 指向 .ts），esbuild 直接转译
});

// 目标三元组：优先取 rustc 默认 host（与 tauri externalBin 命名一致），失败回退按平台猜测
import { execFileSync } from 'node:child_process';

function rustcHostTriple(): string | null {
  try {
    const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8', timeout: 15000 });
    const m = /host:\s*(\S+)/.exec(out);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const isArm = process.arch === 'arm64';
const triple =
  rustcHostTriple() ??
  (process.platform === 'win32'
    ? isArm
      ? 'aarch64-pc-windows-msvc'
      : 'x86_64-pc-windows-msvc'
    : process.platform === 'darwin'
      ? isArm
        ? 'aarch64-apple-darwin'
        : 'x86_64-apple-darwin'
      : isArm
        ? 'aarch64-unknown-linux-gnu'
        : 'x86_64-unknown-linux-gnu');

const sidecarExe = path.join(outDir, `pi-agent-host-${triple}${process.platform === 'win32' ? '.exe' : ''}`);
copyFileSync(process.execPath, sidecarExe);

console.log(`[make-sidecar] bundle → ${path.join(outDir, 'pi-agent-host.cjs')}`);
console.log(`[make-sidecar] node runtime copy → ${sidecarExe}`);
console.log('[make-sidecar] 说明：node-copy 方案 = 内嵌与构建机同 major 的 Node 运行时；');
console.log('[make-sidecar] 目标机无需安装 Node（Node 单文件方案中 boxednode/caxa 需网络下载工具链，未采用）。');
