/**
 * T02 Mock 模式 UI 演示驱动脚本（验收证据采集）。
 * 用全局 playwright-core + 本机 Chromium 直驱页面：
 * 1. 打开应用（无 host → 自动 Mock 分支）
 * 2. 添加项目（信任确认）→ 新建会话 → 发送消息
 * 3. 等待流式回答完成（思考折叠 + 工具卡片）
 * 4. 分阶段截图到 docs/screenshots/
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
  process.stdout.write(`[ui] ${new Date().toISOString()} ${msg}\n`);
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

  // 1. 打开应用
  await page.goto('http://localhost:5199', { waitUntil: 'load', timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(SHOT_DIR, 't02-mock-01-empty.png') });
  log('截图1：初始状态（Mock 徽章 / 引导横幅）');

  // 2. 添加项目：点击侧栏「添加项目」，填路径，信任确认
  const addProjectBtn = page.getByRole('button', { name: /添加项目/ }).first();
  await addProjectBtn.click({ timeout: 10000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOT_DIR, 't02-mock-02-add-project-dialog.png') });
  // 对话框内输入项目路径（第一步）
  const pathInput = page.locator('input[type="text"]').first();
  await pathInput.fill('C:\\Users\\hang\\WorkBuddy\\2026-09-09-15-48-04\\pi-agent\\docs');
  log('已填项目路径');
  await page.waitForTimeout(400);
  // 第一步确认
  await page.getByRole('button', { name: '确认' }).click({ timeout: 8000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SHOT_DIR, 't02-mock-03-trust-step.png') });
  log('截图3：信任确认步骤');
  // 第二步：勾选信任复选框 → 信任并打开
  await page.locator('input[type="checkbox"]').first().check({ timeout: 8000 });
  await page.getByRole('button', { name: /信任并打开/ }).click({ timeout: 8000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SHOT_DIR, 't02-mock-04-project-trusted.png') });
  log('截图4：项目已信任并选中');

  // 3. 新建会话
  const newSessionBtn = page.getByRole('button', { name: /新建会话/ }).first();
  await newSessionBtn.click({ timeout: 10000 });
  await page.waitForTimeout(1500);
  log('已新建会话');

  // 4. 发送消息
  const composer = page.locator('textarea').last();
  await composer.click();
  await composer.fill('请帮我分析这个项目的结构');
  await page.screenshot({ path: path.join(SHOT_DIR, 't02-mock-04-composer-typed.png') });
  await composer.press('Enter');
  log('消息已发送，等待流式回复…');

  // 5. 等待工具卡片出现（read 工具执行中）
  try {
    await page.locator('text=/read|知晓/').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SHOT_DIR, 't02-mock-05-tool-card.png') });
    log('截图5：工具卡片（含思考/工具阶段）');
  } catch {
    log('警告：未捕获到工具卡片中间态（可能太快）');
  }

  // 6. 等待完成（停止按钮变回 / 输入框可用）
  await page.waitForTimeout(9000);
  await page.screenshot({ path: path.join(SHOT_DIR, 't02-mock-06-completed.png') });
  log('截图6：完成态（思考折叠 + 完整回答）');

  // 7. 展开思考折叠的细节截图
  const thinkToggle = page.locator('text=/思考/').first();
  if (await thinkToggle.count()) {
    try {
      await thinkToggle.click({ timeout: 3000 });
      await page.waitForTimeout(600);
    } catch { /* 展开失败不影响验收 */ }
  }
  await page.screenshot({ path: path.join(SHOT_DIR, 't02-mock-07-final.png') });
  log('截图7：最终态');

  await browser.close();
  log('UI 演示完成');
}

main().catch((err) => {
  process.stderr.write(`[ui-fail] ${err && err.message}\n`);
  process.exit(1);
});
