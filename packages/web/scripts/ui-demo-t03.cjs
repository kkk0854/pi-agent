/**
 * T03 UI 演示驱动脚本（验收证据采集）：
 * host + vite 运行 → 设置页 Doctor 全项 → 看板 → 新会话发写文件消息（ask 档）→
 * ApprovalBar 弹条截图 → 放行 → 完成截图 → 看板归类截图。
 */
const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');

const requireGlobal = createRequire(
  'C:/Users/hang/.workbuddy/binaries/node/versions/22.22.2-2/node_modules/empty.js',
);
const { chromium } = requireGlobal('playwright-core');

const ROOT = 'C:/Users/hang/WorkBuddy/2026-09-09-15-48-04/pi-agent';
const SHOT_DIR = path.join(ROOT, 'docs', 'screenshots');
const EXE = 'C:/Users/hang/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const TARGET = path.join(ROOT, 'e2e-approval-ui.txt');

function log(msg) {
  process.stdout.write(`[ui-t03] ${new Date().toISOString()} ${msg}\n`);
}

async function main() {
  fs.rmSync(TARGET, { force: true });
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

  /* 1. 设置页 + Doctor（V-02） */
  await page.locator('button', { hasText: '设置' }).first().click({ timeout: 10000 });
  await page.waitForTimeout(500);
  const doctorBtn = page.locator('button', { hasText: /运行诊断/ }).first();
  await doctorBtn.click({ timeout: 8000 });
  await page.locator('[data-testid="doctor-report"]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOT_DIR, 't03-doctor.png') });
  log('截图1：Doctor 诊断报告');

  /* 2. 项目准备（REST 直操作，跳过对话框流程） */
  const projects = await page.evaluate(async () => {
    const ep = window.__PI_AGENT_HOST__;
    const res = await fetch(`${ep.httpUrl}/v1/projects`, { headers: { 'x-pi-agent-token': ep.token } });
    return res.json();
  });
  const proj = projects[0];
  if (proj) {
    await page.evaluate(async (p) => {
      const ep = window.__PI_AGENT_HOST__;
      if (!p.trusted) {
        await fetch(`${ep.httpUrl}/v1/projects/${p.id}/trust`, {
          method: 'POST',
          headers: { 'x-pi-agent-token': ep.token },
        });
      }
    }, proj);
  }

  /* 3. 回聊天区（看板卡片直达），新建会话 */
  await page.locator('button', { hasText: '看板' }).first().click({ timeout: 8000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOT_DIR, 't03-kanban-idle.png') });
  log('截图2：看板（空闲列）');
  // 看板空 → 回聊天新建会话：直接点侧栏项目 + 新建会话（主区仍在看板也可新建）
  const projectNode = page.locator('button', { hasText: 'pi-agent' }).first();
  if (await projectNode.count()) await projectNode.click({ timeout: 5000 }).catch(() => undefined);
  await page.getByRole('button', { name: /新建会话/ }).first().click({ timeout: 10000 });
  await page.waitForTimeout(2500);

  /* 4. 发写文件消息（全局默认 ask 档 → 审批条应弹出） */
  const composer = page.locator('textarea').last();
  await composer.click();
  await composer.fill('请用 write 工具在当前目录创建文件 e2e-approval-ui.txt，内容只写 ok。');
  await composer.press('Enter');
  log('消息已发送，等待审批条…');

  await page.locator('[data-testid="approval-bar"]').waitFor({ timeout: 90000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOT_DIR, 't03-approval-bar.png') });
  log('截图3：审批条（工具名 + 参数摘要 + 风险级别 + 倒计时 + 三按钮）');

  /* 5. 放行 → 等完成 */
  await page.locator('button', { hasText: /^允许$/ }).last().click({ timeout: 8000 });
  log('已放行，等待执行完成…');
  await page.waitForTimeout(20000);
  await page.screenshot({ path: path.join(SHOT_DIR, 't03-approved-completed.png') });
  log(`截图4：放行后完成态（文件存在=${fs.existsSync(TARGET)}）`);

  /* 6. 看板归类（已完成列应有该会话） */
  await page.locator('button', { hasText: '看板' }).first().click({ timeout: 8000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOT_DIR, 't03-kanban-done.png') });
  log('截图5：看板（已完成列）');

  await browser.close();
  log('T03 UI 演示完成');
}

main().catch((err) => {
  process.stderr.write(`[ui-t03-fail] ${err && err.message}\n`);
  process.exit(1);
});
