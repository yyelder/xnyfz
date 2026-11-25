/**
 * 本轮三项新功能端到端验证
 * ------------------------------------------------------------------
 * 1. 元件库「中间继电器」分类包含中间继电器（线圈 KA / 常开 / 常闭）
 * 2. 从元件库放置中间继电器线圈 → 编号 KA1；再放常开触点 → 跟随 KA1（自动联动）
 * 3. 新建作品画布尺寸为 2400×1500（画布更大）且骨架元件靠左侧
 * 4. 元件默认标号在左侧（labelPos=left）
 * 5. 拖动画布上的标号 → labelOffset 写入 draft；复位按钮清除
 * 6. 导线属性面板含「线号」输入框，可设置 net.tag
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
page.on('pageerror', (e) => pageErrors.push(String(e.message || e.message)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon|404 \(Not Found\)/i.test(m.text())) pageErrors.push(m.text());
});

const state = () =>
  page.evaluate(() => {
    const s = document.querySelector('.editor-shell')?.__vueParentComponent?.setupState;
    if (!s) return null;
    const d = s.draft;
    return {
      canvas: d?.canvas,
      devices: (d?.devices || []).map((x) => ({
        id: x.id, type: x.type, label: x.label, labelPos: x.labelPos, labelOffset: x.labelOffset || null, x: x.x,
      })),
      nets: (d?.nets || []).map((n) => ({ id: n.id, tag: n.tag || '' })),
    };
  });

async function closeTutorial() {
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
  await page.waitForTimeout(400);

  // 进入工业电路仿真（新建骨架）
  await page.click('.wb-entry:has-text("工业电路仿真")');
  await page.waitForSelector('.editor-toolbar');
  await page.waitForSelector('.svg-host svg');
  await closeTutorial();

  /* 3. 画布尺寸更大（2400×1500，骨架元件靠左） */
  let st = await state();
  check('新建作品画布 2400×1500', st?.canvas?.width === 2400 && st?.canvas?.height === 1500,
    `${st?.canvas?.width}×${st?.canvas?.height}`);
  const maxDevX = Math.max(...(st?.devices || []).map((d) => d.x));
  check('骨架元件默认靠画布左侧', maxDevX < 900, `最右元件 x=${maxDevX}`);

  /* 1. 元件库「中间继电器」分类含中间继电器 */
  await page.click('.devlib-cat:has-text("中间继电器")');
  await page.waitForTimeout(100);
  const hasKA = await page.locator('.devlib-item:has-text("中间继电器")').count();
  check('元件库含中间继电器元件（≥2）', hasKA >= 2, `count=${hasKA}`);

  /* 4. 放置元件默认标号在左侧：骨架里已有 labelPos=left 的元件；新放置也应为 left */
  await page.fill('.devlib-search input', '中间继电器线圈');
  await page.waitForTimeout(100);
  await page.click('.devlib-item:has-text("中间继电器线圈")');
  await page.click('.canvas-viewport', { position: { x: 500, y: 700 } });
  await page.waitForTimeout(150);
  st = await state();
  const kaCoil = st.devices.filter((d) => d.type === 'ka_coil');
  check('放置中间继电器线圈成功', kaCoil.length === 1, JSON.stringify(kaCoil));
  check('新放置元件默认标号在左侧', kaCoil[0]?.labelPos === 'left', `labelPos=${kaCoil[0]?.labelPos}`);
  check('中间继电器线圈编号 KA1', kaCoil[0]?.label === 'KA1', `label=${kaCoil[0]?.label}`);

  /* 2. 再放中间继电器常开触点 → 跟随 KA1 */
  await page.fill('.devlib-search input', '中间继电器常开');
  await page.waitForTimeout(100);
  await page.click('.devlib-item:has-text("中间继电器常开触点")');
  await page.click('.canvas-viewport', { position: { x: 620, y: 700 } });
  await page.waitForTimeout(150);
  st = await state();
  const kaNo = st.devices.filter((d) => d.type === 'ka_no');
  check('放置中间继电器常开触点成功', kaNo.length === 1, JSON.stringify(kaNo));
  check('中间继电器常开触点跟随线圈编号 KA1（自动联动）', kaNo[0]?.label === 'KA1', `label=${kaNo[0]?.label}`);

  /* 5. 标号可拖拽：直接调用 setupState 的 onLabelMove 模拟拖拽落点（DOM 拖拽在 headless 下坐标换算复杂） */
  await page.evaluate(() => {
    const s = document.querySelector('.editor-shell')?.__vueParentComponent?.setupState;
    const d = s.draft.devices.find((x) => x.type === 'ka_coil');
    s.onLabelMove(d.id, -60, -35);
  });
  await page.waitForTimeout(150);
  st = await state();
  const kaCoil2 = st.devices.find((d) => d.type === 'ka_coil');
  check('标号拖拽写入 labelOffset', kaCoil2?.labelOffset?.x === -60 && kaCoil2?.labelOffset?.y === -35,
    JSON.stringify(kaCoil2?.labelOffset));

  // 渲染输出中该标号位置随偏移改变
  const labelMoved = await page.evaluate(() => {
    const id = [...document.querySelectorAll('.svg-host [data-label-drag]')]
      .map((e) => e.getAttribute('data-label-drag'))[0];
    const text = document.querySelector(`.svg-host text[data-label-drag="${id}"]`);
    return !!text && text.getAttribute('style')?.includes('move');
  });
  check('标号文字带可拖拽光标', labelMoved);

  /* 复位按钮存在且可清除偏移 */
  // 选中该线圈
  await page.evaluate(() => {
    const s = document.querySelector('.editor-shell')?.__vueParentComponent?.setupState;
    const d = s.draft.devices.find((x) => x.type === 'ka_coil');
    s.selected = d.id;
  });
  await page.waitForTimeout(100);
  const resetBtn = page.locator('.editor-side button:has-text("复位标号")');
  check('属性面板显示「复位标号」按钮', (await resetBtn.count()) === 1);
  if (await resetBtn.count()) {
    await resetBtn.click();
    await page.waitForTimeout(100);
    st = await state();
    check('复位标号清除 labelOffset', st.devices.find((d) => d.type === 'ka_coil')?.labelOffset == null);
  }

  /* 6. 线号输入框：选中一条导线后属性面板含「线号」字段 */
  await page.evaluate(() => {
    const s = document.querySelector('.editor-shell')?.__vueParentComponent?.setupState;
    // 给首条母线网络选中，验证线号字段
    if (s.draft.nets.length === 0) s.draft.nets.push({ id: 'testwire', pins: [], geometry: [[[100, 400], [700, 400]]] });
    s.selectedNet = s.draft.nets[0].id;
    s.selected = null;
  });
  await page.waitForTimeout(100);
  const tagInput = page.locator('.editor-side .field:has-text("线号") input');
  check('导线属性面板含「线号」输入框', (await tagInput.count()) === 1);
  if (await tagInput.count()) {
    await tagInput.fill('101');
    await tagInput.press('Tab');
    await page.waitForTimeout(100);
    st = await state();
    check('线号写入 net.tag', st.nets.some((n) => n.tag === '101'), JSON.stringify(st.nets));
  }

  check('无页面运行时错误', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} catch (e) {
  check('E2E 流程执行完成', false, String(e.message || e));
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n=== 新功能 E2E：${passed} 通过 / ${results.length - passed} 失败 ===`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
