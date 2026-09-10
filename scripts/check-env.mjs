/**
 * 环境体检（Doctor 的 CLI 版）：
 * 检查 Node / pnpm / pi CLI / Rust 是否可用并输出摘要表。
 */
import { execSync } from 'node:child_process';
import process from 'node:process';

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', shell: true, timeout: 8000 }).trim();
  } catch {
    return null;
  }
}

const rows = [
  ['Node', 'node --version', '>=22'],
  ['pnpm', 'pnpm --version', '任意 11.x'],
  ['pi CLI', 'pi --version', '0.85.0 基线'],
  ['Rust（T05 用）', 'rustc --version', '任意 1.x'],
];

let ok = true;
process.stdout.write('pi-agent 环境体检\n=================\n');
for (const [label, cmd, expected] of rows) {
  const version = run(cmd);
  const found = version !== null;
  if (found === false && label !== 'Rust（T05 用）') ok = false;
  process.stdout.write(
    `${label.padEnd(16)} ${found ? '✓' : '✗'}  ${version ?? '未找到'}（期望：${expected}）\n`,
  );
}
process.stdout.write(ok ? '\n结论：环境就绪。\n' : '\n结论：存在缺失项，详见上方输出（Rust 仅 T05 需要）。\n');
process.exit(ok ? 0 : 0); // 体检不阻断启动
