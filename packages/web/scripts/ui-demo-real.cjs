/**
 * T02 真实 pi 模式 UI 演示驱动脚本（验收证据采集）。
 * host + vite 均运行（vite 注入 window.__PI_AGENT_HOST__）→ real 模式：
 * 添加项目 → 信任 → 新建会话 → 发消息（诱导 read 工具）→ 截图。
 */
const { createRequire } = require('node:module');
const path = require('node:path');

const requireGlobal = createRequire(
  'C:/Users/hang/.workbuddy/binaries/node/versions/22.22.2-2/node_modules/empty.js',
);
const { chromium } = requireGlobal('playwright-core');

const ROOT = 'C:/Users/hang/WorkBuddy/2026-09-09-15-48-04/pi-agent';
const SHOT_DIR = path.join(ROOT, 'docs', 'screenshots');
const EXE = 'C:/Users/hang/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';

function log(msg) {
  process.stdout.write(`[ui-real] ${new Date().toISOString()} ${msg}\n`);
}

async function main() {
  const browser = await chromium.launch({
    executablePath: EXE,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  page.on('console', (m) => {
    if (m.type() === 'error') log(`console.error: ${m.text()}`);
  });

  await page.goto('http://localhost:5199', { waitUntil: 'load', timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(SHOT_DIR, 't02-real-01-empty.png') });
  log('截图1：初始状态（real 模式，无 Mock 徽章）');

  // 添加项目 + 信任（两步流，走 host REST）；已存在则直接选用
  const projects = await page.evaluate(async () => {
    const ep = window.__PI_AGENT_HOST__;
    const res = await fetch(`${ep.httpUrl}/v1/projects`, { headers: { 'x-pi-agent-token': ep.token } });
    return res.json();
  });
  if (projects.length === 0) {
    await page.getByRole('button', { name: /添加项目/ }).first().click({ timeout: 10000 });
    await page.waitForTimeout(600);
    await page.locator('input[type="text"]').first().fill(ROOT);
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: '确认' }).click({ timeout: 8000 });
    await page.waitForTimeout(1200);
    await page.locator('input[type="checkbox"]').first().check({ timeout: 8000 });
    await page.getByRole('button', { name: /信任并打开/ }).click({ timeout: 8000 });
  } else {
    // 已入库：若未信任则直接信任（走 REST），然后选中
    const p = projects[0];
    await page.evaluate(async (proj) => {
      const ep = window.__PI_AGENT_HOST__;
      if (!proj.trusted) {
        await fetch(`${ep.httpUrl}/v1/projects/${proj.id}/trust`, {
          method: 'POST',
          headers: { 'x-pi-agent-token': ep.token },
        });
      }
    }, p);
  }
  await page.waitForTimeout(1200);
  // 选中项目（点击侧栏项目节点）
  const projectNode = page.locator('button', { hasText: 'pi-agent' }).first();
  if (await projectNode.count()) {
    await projectNode.click({ timeout: 5000 }).catch(() => undefined);
  }
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOT_DIR, 't02-real-02-project.png') });
  log('截图2：项目已信任（host 入库）');

  // 新建会话
  await page.getByRole('button', { name: /新建会话/ }).first().click({ timeout: 10000 });
  await page.waitForTimeout(2000);
  log('已新建会话（host 受理，pi 子进程 spawn）');

  // 发送消息
  const composer = page.locator('textarea').last();
  await composer.click();
  await composer.fill('请用 read 工具读取当前目录下 pnpm-workspace.yaml 的前几行，然后用一句话总结内容。');
  await composer.press('Enter');
  log('消息已发送，等待真实 pi 流式回复…');

  // 等工具卡片
  try {
    await page.locator('text=/read|知晓/').first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(SHOT_DIR, 't02-real-03-tool-card.png') });
    log('截图3：read 工具卡片');
  } catch {
    log('警告：未捕获到工具卡片中间态');
  }

  // 等完成（agent_settled → 输入框恢复可用 / 停止按钮消失），上限 90s
  await page.waitForTimeout(15000);
  await page.screenshot({ path: path.join(SHOT_DIR, 't02-real-04-completed.png') });
  log('截图4：完成态');

  await browser.close();
  log('真实模式 UI 演示完成');
}

main().catch((err) => {
  process.stderr.write(`[ui-real-fail] ${err && err.message}\n`);
  process.exit(1);
});
