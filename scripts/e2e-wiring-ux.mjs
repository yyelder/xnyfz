/**
 * 本轮交互修复端到端验证
 * ------------------------------------------------------------------
 * 1. 放置接触器常闭触点 → 默认编号跟随线圈（KM1），与线圈联动
 * 2. 选中导线 → Backspace 聚焦「网络标号」输入框（不删元件）
 * 3. 在输入框内按 Backspace/Delete 属于文字编辑，不误删元件/导线
 * 4. 选中导线段 → Delete 只删选中段（段级删除），不影响其他段/接点
 * 5. 两根导线相接处渲染实心节点 .junction
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

/** 读取 setupState（含 draft / selected / selectedNet / selectedSeg） */
const state = () =>
  page.evaluate(() => {
    const shell = document.querySelector('.editor-shell');
    const s = shell?.__vueParentComponent?.setupState;
    if (!s) return null;
    const d = s.draft;
    return {
      selected: s.selected,
      selectedNet: s.selectedNet,
      selectedSeg: s.selectedSeg,
      deviceCount: (d?.devices || []).length,
      netCount: (d?.nets || []).length,
      devices: (d?.devices || []).map((x) => ({ id: x.id, type: x.type, label: x.label })),
      nets: (d?.nets || []).map((n) => ({ id: n.id, phase: n.phase || '', geomLen: (n.geometry || []).length })),
    };
  });

async function closeTutorial() {
  const card = page.locator('.tutorial-card');
  if (await card.isVisible().catch(() => false)) {
    await page.click('.tutorial-card .btn.primary');
    await card.waitFor({ state: 'hidden' });
  }
}

/** 通过 setupState 注入一段测试电路（两段相接走线 + 实心节点场景），再触发 rebuild */
async function injectTestCircuit() {
  await page.evaluate(() => {
    const s = document.querySelector('.editor-shell')?.__vueParentComponent?.setupState;
    const types = s.deviceTypes || [];
    s.draft.devices = [
      { id: 'COIL', type: 'km_coil', label: 'KM1', labelPos: 'right', x: 300, y: 300, rot: 0, props: {} },
      { id: 'NO', type: 'km_no', label: 'KM1', labelPos: 'right', x: 500, y: 300, rot: 0, props: {} },
      { id: 'NC', type: 'km_nc', label: 'KM1', labelPos: 'right', x: 700, y: 300, rot: 0, props: {} },
    ];
    s.draft.nets = [
      // 两条相接的走线：段0 水平主干，段1 从主干中段竖下 → T 接实心节点 (400,300)
      { id: 'w1', pins: [], geometry: [[[200, 300], [600, 300]], [[400, 300], [400, 460]]] },
    ];
    s.sim.rebuild();
  });
  await page.waitForTimeout(200);
}

try {
  await page.goto(`${BASE}/?view=workbench`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.wb-entry');
  await page.click('.wb-entry:has-text("工业电路仿真")');
  await page.waitForSelector('.svg-host svg');
  await page.waitForTimeout(250);
  await closeTutorial();

  /* 1. 放置接触器辅助常闭触点 → 编号跟随线圈 KM1 */
  await page.fill('.devlib-search input', '接触器辅助常闭');
  await page.click('.devlib-item:has-text("接触器辅助常闭触点")');
  await page.click('.canvas-viewport', { position: { x: 420, y: 560 } });
  await page.waitForTimeout(150);
  let st = await state();
  const newNc = st.devices.find((d) => d.type === 'km_nc');
  check('新放常闭触点默认编号 KM1（跟随线圈，联动生效）', newNc?.label === 'KM1', newNc?.label);

  /* 2~5. 注入测试电路 */
  await injectTestCircuit();
  st = await state();
  check('测试电路注入成功（3 元件 + 1 网络 2 段）', st.deviceCount === 3 && st.nets[0]?.geomLen === 2,
    `${st.deviceCount}/${st.nets[0]?.geomLen}`);

  /* 实心节点渲染 */
  const junctionCount = await page.locator('.svg-host circle.junction').count();
  check('导线 T 接处渲染实心节点 .junction', junctionCount >= 1, `count=${junctionCount}`);

  /* 段级命中带 data-seg */
  const segLines = await page.locator('.svg-host line[data-seg]').count();
  check('走线段命中线带 data-seg', segLines >= 2, `count=${segLines}`);

  /* 3. 选中导线段（第 0 段） */
  const segPt = await page.evaluate(() => {
    const ln = document.querySelector('.svg-host line[data-seg="0"]');
    if (!ln) return null;
    const svg = ln.ownerSVGElement;
    const ctm = ln.getScreenCTM();
    const x1 = +ln.getAttribute('x1'), y1 = +ln.getAttribute('y1');
    const x2 = +ln.getAttribute('x2'), y2 = +ln.getAttribute('y2');
    // 取靠近 1/3 处，避开中点 T 接实心节点
    const p = svg.createSVGPoint(); p.x = x1 + (x2 - x1) / 3; p.y = y1 + (y2 - y1) / 3;
    const sp = p.matrixTransform(ctm);
    return { x: sp.x, y: sp.y };
  });
  check('定位到段0屏幕坐标', !!segPt, JSON.stringify(segPt));
  await page.mouse.click(segPt.x, segPt.y);
  await page.waitForTimeout(120);
  st = await state();
  check('点击导线段选中网络', st.selectedNet === 'w1', `net=${st.selectedNet}`);
  check('记录选中的段索引 seg=0', st.selectedSeg === 0, `seg=${st.selectedSeg}`);

  /* 4. Backspace → 聚焦网络标号输入框，不删元件/导线 */
  const beforeCount = st.deviceCount;
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(120);
  const focused = await page.evaluate(() => document.activeElement?.className || '');
  check('Backspace 聚焦网络标号输入框', /text-input/.test(focused), focused);
  st = await state();
  check('Backspace 未删除元件/导线', st.deviceCount === beforeCount && st.netCount === 1,
    `dev=${st.deviceCount} net=${st.netCount}`);

  /* 5. 输入框内按 Delete 属于文字编辑，不删元件 */
  await page.locator('.editor-side .net-editor .field:has-text("网络标号") input').fill('KM1');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(120);
  st = await state();
  check('输入框内 Delete 不误删元件', st.deviceCount === 3, `dev=${st.deviceCount}`);

  /* 6. Delete（焦点在画布）→ 段级删除，只删段 0 */
  await page.mouse.click(300, 700); // 点画布空白，使焦点离开输入框（同时取消选中）
  await page.waitForTimeout(80);
  // 重新选中段 0
  const segPt2 = await page.evaluate(() => {
    const ln = document.querySelector('.svg-host line[data-seg="0"]');
    if (!ln) return null;
    const svg = ln.ownerSVGElement;
    const ctm = ln.getScreenCTM();
    const x1 = +ln.getAttribute('x1'), y1 = +ln.getAttribute('y1');
    const x2 = +ln.getAttribute('x2'), y2 = +ln.getAttribute('y2');
    const p = svg.createSVGPoint(); p.x = x1 + (x2 - x1) / 3; p.y = y1 + (y2 - y1) / 3;
    const sp = p.matrixTransform(ctm);
    return { x: sp.x, y: sp.y };
  });
  if (segPt2) { await page.mouse.click(segPt2.x, segPt2.y); await page.waitForTimeout(100); }
  await page.keyboard.press('Delete');
  await page.waitForTimeout(150);
  st = await state();
  const w1 = st.nets.find((n) => n.id === 'w1');
  check('Delete 段级删除后网络保留', !!w1, w1 ? `geomLen=${w1.geomLen}` : 'net removed');
  check('只删选中段：剩余 1 段', w1?.geomLen === 1, `geomLen=${w1?.geomLen}`);
  check('段级删除未删除元件', st.deviceCount === 3, `dev=${st.deviceCount}`);

  check('无未捕获页面异常', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} catch (e) {
  check('流程未异常中断', false, String(e.message || e));
} finally {
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n=== 结果：${ok} 通过 / ${results.length - ok} 失败 ===`);
  await browser.close();
  if (ok !== results.length) process.exitCode = 1;
}
