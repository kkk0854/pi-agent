/**
 * 并发启动 host（写 host.json）与 web（vite，读 host.json 注入端点）。
 * host 先起、等待 host.json 就绪后再拉起 vite，保证首次打开页面即可拿到端点。
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 读 appData 下 host.json 的路径（与 host/src/config/paths.ts 保持一致） */
function hostJsonPath() {
  const override = process.env.PI_AGENT_DATA_DIR;
  if (override) return path.join(override, 'host.json');
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
    return path.join(appData, 'pi-agent', 'host.json');
  }
  if (process.platform === 'darwin') {
    return path.join(process.env.HOME || '', 'Library', 'Application Support', 'pi-agent', 'host.json');
  }
  const xdg = process.env.XDG_DATA_HOME || path.join(process.env.HOME || '', '.local', 'share');
  return path.join(xdg, 'pi-agent', 'host.json');
}

function prefixStream(stream, label) {
  let buffered = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffered += chunk;
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      if (line.length > 0) process.stdout.write(`[${label}] ${line}\n`);
    }
  });
  stream.on('end', () => {
    if (buffered.length > 0) process.stdout.write(`[${label}] ${buffered}\n`);
  });
}

/** 轮询等待 host.json 就绪（host 写盘成功即视为可连） */
function waitForHostJson(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      if (existsSync(hostJsonPath())) {
        try {
          JSON.parse(readFileSync(hostJsonPath(), 'utf8'));
          resolve(true);
          return;
        } catch {
          // 写入未完成，继续等待
        }
      }
      if (Date.now() > deadline) {
        resolve(false);
        return;
      }
      setTimeout(tick, 200);
    };
    tick();
  });
}

const children = [];

function run(cmd, args, label, cwd) {
  // stdin 必须忽略：tsx watch 在 stdin 为管道时会挂起不执行脚本（Windows 实测）
  const child = spawn(cmd, args, { cwd, shell: true, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  prefixStream(child.stdout, label);
  prefixStream(child.stderr, label);
  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      process.stdout.write(`[${label}] 进程退出，exit=${code}\n`);
    }
  });
  return child;
}

async function main() {
  process.stdout.write('[dev] 启动本地 host 服务…\n');
  run('pnpm', ['-C', 'packages/host', 'dev'], 'host', ROOT);

  const ready = await waitForHostJson(20_000);
  if (ready) {
    process.stdout.write('[dev] host.json 已就绪，启动 web（vite）…\n');
  } else {
    process.stdout.write('[dev] 未检测到 host.json（超时），web 将以离线模式注入端点。\n');
  }
  run('pnpm', ['-C', 'packages/web', 'dev'], 'web', ROOT);

  const shutdown = () => {
    for (const child of children) {
      try {
        child.kill();
      } catch {
        /* 忽略退出清理异常 */
      }
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  process.stderr.write(`[dev] 启动失败：${String(err)}\n`);
  process.exit(1);
});
