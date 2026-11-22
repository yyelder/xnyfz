/**
 * 原理图仿真编辑器端到端验证（骨架流，对齐竞品「新建即有示例元件」）
 * ------------------------------------------------------------------
 * 流程：创建家庭电路仿真 → 首次教程弹窗 → 骨架断言（L/N/PE 端子 + SA1/SA2 + EL1）
 *   → 折叠/展开元件库 → 插入单相母线 → 五段走线（含引脚→母线）
 *   → 撤销/重做 → 运行仿真 → 一灯双控翻转验证 → 保存 → 刷新持久化 → 重开作品
 *
 * 注意（与实现细节对齐）：
 *  - 新作品自带固定 id 骨架：XT_L/XT_N/XT_PE、SA1、SA2、EL1。
 *  - showPins 时每个引脚渲染 2 个 data-pin 圆（本体 + 透明命中圈），
 *    因此点击用 .first()，计数按 data-pin 去重。
 *  - 运行态用派发 pointerdown 到 [data-dev] 元素本身来模拟「点击元件操作」。
 *  - Ctrl+Z / Ctrl+Y 绑定在 .editor-shell，按键前需先让其获得焦点。
 */
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:5176';
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const pageErrors = [];
const notFound = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
page.on('console', (m) => {
  // 浏览器对 /favicon.ico 的 404 属于无害噪声，单独由 response 监听判定
  if (m.type() === 'error' && !/favicon|404 \(Not Found\)/i.test(m.text())) pageErrors.push(m.text());
});
page.on('response', (r) => {
  if (r.status() === 404) notFound.push(r.url());
});

/** 点击元素包围盒中心（绕开 Playwright strict mode 与 SVG 覆盖层） */
async function clickCenter(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('元素不可见：' + String(locator));
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** 数唯一引脚（data-pin 去重） */
const uniquePins = () =>
  page.evaluate(() => {
    const host = document.querySelector('.svg-host');
    if (!host) return 0;
    return new Set([...host.querySelectorAll('[data-pin]')].map((e) => e.getAttribute('data-pin'))).size;
  });

/** 接线检查面板：第一个 check-cell 的数字即「未接引脚」 */
const unconnectedCount = () =>
  page.evaluate(() => Number(document.querySelector('.check-cell .check-num')?.textContent || '0'));

/** 灯是否点亮（SVG 内出现点亮颜色） */
const lampLit = () =>
  page.evaluate(() => {
    const svg = document.querySelector('.svg-host svg')?.innerHTML || '';
    return svg.includes('#f5c33b') || svg.includes('rgba(245,195,59');
  });

/** 运行态点击元件（等价用户点击该元件操作） */
const tapDevice = (id) =>
  page.evaluate((devId) => {
    const el = document.querySelector(`.svg-host [data-dev="${devId}"]`);
    if (!el) throw new Error('未找到元件 ' + devId);
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        pointerId: 1,
      })
    );
  }, id);

async function closeTutorialIfAny() {
  const card = page.locator('.tutorial-card');
  if (await card.isVisible().catch(() => false)) {
    await page.click('.tutorial-card .btn.primary');
    await card.waitFor({ state: 'hidden' });
  }
}

try {
  await page.goto(`${BASE}/?view=workbench`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.wb-entry');

  /* 1. 创建家庭电路仿真（自带双控灯示例骨架） */
  await page.click('.wb-entry:has-text("家庭电路仿真")');
  await page.waitForSelector('.editor-toolbar');
  await page.waitForSelector('.svg-host svg');
  check('创建家庭原理图并进入编辑器', true);

  const tutVisible = await page.locator('.tutorial-card').isVisible().catch(() => false);
  check('首次进入自动弹出接线教程', tutVisible);
  await closeTutorialIfAny();

  /* 2. 骨架断言：电源端子 + 双控开关 + 照明灯 */
  const devIds = await page.evaluate(() =>
    [...document.querySelectorAll('.svg-host [data-dev]')].map((el) => el.getAttribute('data-dev'))
  );
  const need = ['XT_L', 'XT_N', 'XT_PE', 'SA1', 'SA2', 'EL1'];
  check(
    '新作品自带示例骨架（端子/双控开关/灯）',
    need.every((id) => devIds.includes(id)),
    devIds.join(', ')
  );
  const pinCount = await uniquePins();
  check('骨架引脚常显（11 个唯一引脚）', pinCount === 11, `实际 ${pinCount}`);

  /* 3. 折叠 / 展开元件库 */
  await page.click('.editor-toolbar button:has-text("折叠")');
  const libHidden = await page.locator('.editor-lib').isHidden();
  check('折叠元件库', libHidden);
  await page.click('.editor-toolbar button:has-text("折叠")');
  check('展开元件库', await page.locator('.editor-lib').isVisible());

  /* 4. 插入单相母线（L/N） */
  await page.click('.editor-side button:has-text("插入单相")');
  await page.waitForTimeout(150);
  const hasBus = await page.evaluate(() => !!document.querySelector('.svg-host g[data-net="L"]'));
  check('插入单相 L+N 母线', hasBus);

  /* 5. 走线 5 段：SA1→L 端子、双控联络线×2、SA2→灯、灯→N 母线 */
  await page.click('.editor-toolbar button:has-text("走线")');
  const wires = [
    ['SA1:1', 'XT_L:1', null],
    ['SA1:2', 'SA2:2', null],
    ['SA1:3', 'SA2:3', null],
    ['SA2:1', 'EL1:1', null],
    ['EL1:2', null, 'N'],
  ];
  for (const [from, to, busNet] of wires) {
    await clickCenter(page.locator(`.svg-host [data-pin="${from}"]`).first());
    if (to) {
      await clickCenter(page.locator(`.svg-host [data-pin="${to}"]`).first());
    } else {
      const bus = page.locator(`.svg-host g[data-net="${busNet}"] line`).first();
      await clickCenter(bus);
    }
    await page.waitForTimeout(120);
  }
  const unconnected = await unconnectedCount();
  check('五段走线生效（未接引脚 2：XT_PE / XT_N）', unconnected === 2, `未接 ${unconnected}`);

  /* 6. 撤销 → 重做 */
  await page.locator('.editor-shell').focus();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  const afterUndo = await unconnectedCount();
  check('撤销恢复上一状态（未接引脚 3）', afterUndo === 3, `未接 ${afterUndo}`);
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(150);
  const afterRedo = await unconnectedCount();
  check('重做恢复（未接引脚 2）', afterRedo === 2, `未接 ${afterRedo}`);

  /* 7. 运行仿真：一灯双控翻转 */
  await page.click('.editor-toolbar button:has-text("运行仿真")');
  await page.waitForTimeout(300);
  check('运行仿真：双控初始位置灯亮', await lampLit());
  await tapDevice('SA1');
  await page.waitForTimeout(300);
  const offAfterSa1 = !(await lampLit());
  check('点击 SA1 切换位置 → 灯灭', offAfterSa1);
  await tapDevice('SA2');
  await page.waitForTimeout(300);
  check('点击 SA2 切换位置 → 灯亮（两地控制）', await lampLit());

  /* 8. 保存 + 刷新持久化 */
  await page.click('.editor-toolbar button:has-text("保存")');
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForSelector('.wb-card');
  const cardTitle = await page.evaluate(() => document.querySelector('.wb-card-title')?.textContent || '');
  check('保存后刷新作品仍在', cardTitle.length > 0, cardTitle);

  /* 9. 重新打开作品，数据完整 */
  await page.click('.wb-card');
  await page.waitForSelector('.editor-toolbar');
  await page.waitForSelector('.svg-host svg');
  await page.waitForTimeout(250);
  await closeTutorialIfAny();
  const pinsAfterReload = await uniquePins();
  const wiresAfterReload = await page.evaluate(() => {
    const svg = document.querySelector('.svg-host svg');
    return svg ? svg.querySelectorAll('g.wire').length : 0;
  });
  check(
    '重开作品：11 引脚 + 网络完整',
    pinsAfterReload === 11 && wiresAfterReload >= 6,
    `引脚 ${pinsAfterReload} / 导线组 ${wiresAfterReload}`
  );

  /* 10. 工具栏「使用教程」可重新打开 */
  await page.click('.editor-toolbar button:has-text("使用教程")');
  check('工具栏可重新打开接线教程', await page.locator('.tutorial-card').isVisible());
  await closeTutorialIfAny();
} catch (e) {
  check('流程异常中断', false, String(e.message || e).slice(0, 240));
  try {
    const diag = await page.evaluate(() => ({
      url: location.href,
      toolbar: document.querySelector('.editor-toolbar')?.innerText?.replace(/\s+/g, ' ').slice(0, 160) || '(无)',
      devs: [...document.querySelectorAll('.svg-host [data-dev]')].map((e) => e.getAttribute('data-dev')),
      checks: [...document.querySelectorAll('.check-cell .check-num')].map((e) => e.textContent),
      side: document.querySelector('.editor-side')?.innerText?.replace(/\s+/g, ' ').slice(0, 160) || '(无)',
    }));
    console.log('--- 页面诊断 ---\n' + JSON.stringify(diag, null, 2));
  } catch (_) {
    /* 页面可能已关闭 */
  }
}

check('无未捕获页面异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ').slice(0, 300));
const real404 = notFound.filter((u) => !/favicon/i.test(u));
check('无缺失资源 404', real404.length === 0, real404.slice(0, 3).join(' | ').slice(0, 300));

const pass = results.filter((r) => r.ok).length;
console.log(`\n=== 结果：${pass} 通过 / ${results.length - pass} 失败 ===`);
await browser.close();
process.exit(pass === results.length ? 0 : 1);
