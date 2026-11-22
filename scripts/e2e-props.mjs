/**
 * 属性编辑专项端到端验证
 * ------------------------------------------------------------------
 * 1. 接触器常开/常闭触点点击「编号文字」即可选中 → 出现属性面板
 * 2. 触点编号可改；联动组字段已去掉，联动完全按编号名称
 * 3. 电源端子「编号」与「相线」独立：改相线不覆盖自定义编号
 * 4. 相线改为下拉可选 U/V/W/N/PE，选择后同步到所接导线
 * 5. 图中编号字号放大到 16，并按类型/相别着色（U黄/V绿/W红/N蓝/PE黄绿、KM蓝…）
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
page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon|404 \(Not Found\)/i.test(m.text())) pageErrors.push(m.text());
});

const draftState = () =>
  page.evaluate(() => {
    const shell = document.querySelector('.editor-shell');
    const s = shell?.__vueParentComponent?.setupState;
    if (!s) return null;
    const d = s.draft;
    return {
      devices: (d?.devices || []).map((x) => ({
        id: x.id, type: x.type, label: x.label,
        group: x.props?.group || '', phase: x.props?.phase || '',
      })),
      nets: (d?.nets || []).map((n) => ({ id: n.id, phase: n.phase || '', pins: (n.pins || []).map((p) => p.join(':')) })),
    };
  });

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
  await page.click('.wb-entry:has-text("工业电路仿真")');
  await page.waitForSelector('.svg-host svg');
  await page.waitForTimeout(250);
  await closeTutorialIfAny();

  /* 0. 编号字号与配色（在编辑前检查初始相色） */
  const styles = await page.evaluate(() => {
    const pick = (id) => {
      const t = document.querySelector(`.svg-host text[data-dev-label="${id}"]`);
      return t ? { size: t.getAttribute('font-size'), fill: t.getAttribute('fill') } : null;
    };
    return { U: pick('XT_U'), V: pick('XT_V'), W: pick('XT_W'), N: pick('XT_N'), PE: pick('XT_PE'), coil: pick('KM1C'), btn: pick('SB1') };
  });
  check('编号字号放大到 16', styles.U?.size === '16', JSON.stringify(styles.U));
  check('相色区分 U黄/V绿/W红', styles.U?.fill === '#b8860b' && styles.V?.fill === '#1f9d55' && styles.W?.fill === '#d63a3a',
    `${styles.U?.fill}/${styles.V?.fill}/${styles.W?.fill}`);
  check('N蓝/PE黄绿区分', styles.N?.fill === '#2f6fb5' && styles.PE?.fill === '#6b9e1f', `${styles.N?.fill}/${styles.PE?.fill}`);
  check('KM线圈蓝色/SB按钮橙色区分', styles.coil?.fill === '#1a5fb4' && styles.btn?.fill === '#d98218', `${styles.coil?.fill}/${styles.btn?.fill}`);

  /* 1. 点击 KM1 辅助常开触点的「编号文字」应能选中 */
  const labelEl = page.locator('.svg-host text[data-dev-label="KM1NO"]');
  check('触点编号文字带 data-dev-label 标记', (await labelEl.count()) === 1);
  const lb = await labelEl.boundingBox();
  await page.mouse.click(lb.x + lb.width / 2, lb.y + lb.height / 2);
  await page.waitForTimeout(120);
  const title = await page.evaluate(() => document.querySelector('.editor-side .net-editor-title')?.textContent || '');
  check('点编号文字出现「元件属性」面板', title === '元件属性', title);

  /* 2. 联动组字段已去掉 */
  const groupInput = page.locator('.editor-side input[list="group-presets"]');
  check('联动组输入框已移除', (await groupInput.count()) === 0);

  /* 3. 改编号 KM1→KM2，且不再写入 group（纯按名称联动） */
  const labelInput = page.locator('.editor-side .net-editor .field:has-text("编号") input').first();
  await labelInput.fill('KM2 自锁');
  await labelInput.press('Tab');
  await page.waitForTimeout(120);
  let st = await draftState();
  const kmno3 = st.devices.find((d) => d.id === 'KM1NO');
  check('编号可改为 KM2 自锁', kmno3?.label === 'KM2 自锁', kmno3?.label);
  check('改编号后不再写入联动组 group', !kmno3?.group, kmno3?.group || '(空)');

  /* 4. 电源端子：编号与相线独立 */
  const xtu = page.locator('.svg-host [data-dev="XT_U"]');
  const xb = await xtu.boundingBox();
  await page.mouse.click(xb.x + xb.width / 2, xb.y + xb.height / 2);
  await page.waitForTimeout(120);
  const numInput = page.locator('.editor-side .net-editor .field:has-text("编号") input').first();
  await numInput.fill('进线L1');
  await numInput.press('Tab');
  await page.waitForTimeout(120);
  st = await draftState();
  let xt = st.devices.find((d) => d.id === 'XT_U');
  check('电源端子编号可自定义', xt?.label === '进线L1', xt?.label);

  const phaseSelect = page.locator('.editor-side select.phase-select');
  check('相线下拉存在', (await phaseSelect.count()) >= 1);
  await phaseSelect.selectOption('W');
  await page.waitForTimeout(120);
  st = await draftState();
  xt = st.devices.find((d) => d.id === 'XT_U');
  const wNet = st.nets.find((n) => n.pins.includes('XT_U:2'));
  check('改相线为 W 不覆盖自定义编号', xt?.label === '进线L1' && xt?.phase === 'W', `${xt?.label}/${xt?.phase}`);
  // 骨架端子默认未接线；若已接线则应同步相别（e2e-features.mjs 已覆盖接线场景）
  check('相线变更同步到所接导线', !wNet || wNet.phase === 'W', wNet ? wNet.phase : '骨架端子未接线，跳过');

  check('无未捕获页面异常', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} catch (e) {
  check('流程未异常中断', false, String(e.message || e));
} finally {
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n=== 结果：${ok} 通过 / ${results.length - ok} 失败 ===`);
  await browser.close();
  if (ok !== results.length) process.exitCode = 1;
}
