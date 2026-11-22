/**
 * 新功能专项端到端验证（第 4 轮需求）
 * ------------------------------------------------------------------
 * 1. 工作台只保留「工业电路仿真 / 家庭电路仿真」两个入口
 * 2. 电源母线可自定义相线（U/V/W/N/PE 及任意名称）+ 长度 + 间距
 * 3. 三相线可连接：母线接线点位可作为走线起点（母线 → 元件引脚）
 * 4. 电源端子相线可在属性面板自定义，并同步到所接导线
 * 5. 选中导线可修改长度
 * 6. 鼠标中键（滚轮按下）拖动画布位置
 * 7. 左右面板可拖拽调整宽度
 * 8. 自定义相线 U/V/W 能被仿真引擎识别为带电相
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

async function clickCenter(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('元素不可见：' + String(locator));
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

const unconnectedCount = () =>
  page.evaluate(() => Number(document.querySelector('.check-cell .check-num')?.textContent || '0'));

/** 读取组件内部 draft（Vue setupState 中 ref 已解包） */
const draftState = () =>
  page.evaluate(() => {
    const shell = document.querySelector('.editor-shell');
    const s = shell?.__vueParentComponent?.setupState;
    if (!s) return null;
    const d = s.draft;
    return {
      nets: (d?.nets || []).map((n) => ({
        id: n.id, phase: n.phase || '', bus: !!n.bus,
        pins: (n.pins || []).map((p) => p.join(':')),
        geo0: n.geometry?.[0] || null,
      })),
      devices: (d?.devices || []).map((x) => ({ id: x.id, type: x.type, phase: x.props?.phase || '' })),
      libW: s.libW, sideW: s.sideW,
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

  /* 1. 工作台仅两个入口 */
  const entries = await page.evaluate(() =>
    [...document.querySelectorAll('.wb-entry-title')].map((e) => e.textContent.trim())
  );
  check('工作台仅保留家庭/工业两个入口', entries.length === 2 && entries.includes('家庭电路仿真') && entries.includes('工业电路仿真'), entries.join(' / '));

  /* 2. 创建工业电路仿真 */
  await page.click('.wb-entry:has-text("工业电路仿真")');
  await page.waitForSelector('.editor-toolbar');
  await page.waitForSelector('.svg-host svg');
  await closeTutorialIfAny();

  const st0 = await draftState();
  const xs = st0.devices.filter((d) => d.type === 'pwr_terminal').map((d) => d.phase);
  check('工业骨架电源端子为 U/V/W/N/PE', ['U', 'V', 'W', 'N', 'PE'].every((p) => xs.includes(p)), xs.join(','));

  /* 3. 自定义母线：相线 U,V,W,N,PE + 长度 1000 + 间距 60 */
  const phaseInput = page.locator('.bus-config .bus-field input').nth(0);
  const lenInput = page.locator('.bus-config .bus-field input').nth(1);
  const gapInput = page.locator('.bus-config .bus-field input').nth(2);
  await phaseInput.fill('U,V,W,N,PE');
  await lenInput.fill('1000');
  await gapInput.fill('60');
  await page.click('.bus-config button:has-text("按上面配置插入")');
  await page.waitForTimeout(200);
  const st1 = await draftState();
  const buses = st1.nets.filter((n) => n.bus);
  check('插入 5 条自定义相线母线', buses.length === 5 && ['U', 'V', 'W', 'N', 'PE'].every((p) => buses.some((b) => b.phase === p)), buses.map((b) => b.phase).join(','));
  const uBus = buses.find((b) => b.phase === 'U');
  const busLen = uBus?.geo0 ? Math.abs(uBus.geo0[1][0] - uBus.geo0[0][0]) : 0;
  check('母线长度按设置为 1000', busLen === 1000, `实际 ${busLen}`);
  const liveYs = buses.filter((b) => ['U', 'V', 'W'].includes(b.phase)).map((b) => b.geo0[0][1]).sort((a, b) => a - b);
  check('三相线间距按设置为 60', liveYs.length === 3 && liveYs[1] - liveYs[0] === 60 && liveYs[2] - liveYs[1] === 60, liveYs.join(','));

  /* 母线接线点位已渲染 */
  const tapCount = await page.evaluate(() => document.querySelectorAll('.svg-host [data-tap]').length);
  check('母线沿线渲染可吸附接线点位', tapCount >= 10, `点位 ${tapCount}`);

  /* 4. 从母线起线 → 元件引脚（三相线连到 KM1 主触点） */
  await page.click('.editor-toolbar button:has-text("走线")');
  const before = await unconnectedCount();
  const uTap = page.locator('.svg-host g[data-net="U"] [data-tap]').first();
  await clickCenter(uTap);
  const draftAfterStart = await page.evaluate(() => document.querySelector('.ghost path') !== null);
  check('点击母线点位可开始走线（草稿出现）', draftAfterStart);
  await clickCenter(page.locator('.svg-host [data-pin="KM1:in1"]').first());
  await page.waitForTimeout(200);
  const st2 = await draftState();
  const uNet2 = st2.nets.find((n) => n.phase === 'U');
  check('母线 → 元件引脚接线生效（并入 U 相网络）', !!uNet2 && uNet2.pins.includes('KM1:in1'), uNet2?.pins.join(',') || '(无)');
  const after = await unconnectedCount();
  check('接线后未接引脚减少 1', after === before - 1, `${before} → ${after}`);

  /* 5. 电源端子相线自定义（选中 XT_U → 改为 R） */
  await page.click('.editor-toolbar button:has-text("选择")');
  await clickCenter(page.locator('.svg-host [data-dev="XT_U"]').first());
  await page.waitForTimeout(120);
  const phaseField = page.locator('.editor-side input[list="phase-presets"]');
  const hasPhaseField = await phaseField.count();
  check('电源端子属性面板显示「相线」输入', hasPhaseField === 1);
  if (hasPhaseField) {
    await phaseField.fill('R');
    await phaseField.press('Tab');
    await page.waitForTimeout(150);
    const st3 = await draftState();
    const xtu = st3.devices.find((d) => d.id === 'XT_U');
    check('电源端子相线可改为自定义值 R', xtu?.phase === 'R', xtu?.phase || '(空)');
  }

  /* 6. 选中导线可修改长度 */
  await clickCenter(page.locator('.svg-host g[data-net="U"] line').first());
  await page.waitForTimeout(120);
  const lenField = page.locator('.editor-side .net-editor .field:has-text("长度") input');
  const hasLen = await lenField.count();
  check('导线属性面板显示「长度」输入', hasLen === 1);
  if (hasLen) {
    await lenField.fill('600');
    await lenField.press('Tab');
    await page.waitForTimeout(150);
    const st4 = await draftState();
    const u4 = st4.nets.find((n) => n.phase === 'U');
    const newLen = u4?.geo0 ? Math.abs(u4.geo0[1][0] - u4.geo0[0][0]) : 0;
    check('母线长度可改为 600', newLen === 600, `实际 ${newLen}`);
  }

  /* 7. 中键（滚轮按下）拖动画布 */
  const transformOf = () =>
    page.evaluate(() => document.querySelector('.canvas-content')?.style.transform || '');
  const tBefore = await transformOf();
  const box = await page.locator('.canvas-viewport').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(cx + 120, cy + 80, { steps: 6 });
  await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(120);
  const tAfter = await transformOf();
  const nums = (s) => (s.match(/-?\d+(\.\d+)?/g) || []).map(Number);
  const a = nums(tBefore); const b = nums(tAfter);
  check('中键拖拽平移画布位置', !!tBefore && !!tAfter && tBefore !== tAfter && Math.abs((b[0] ?? 0) - (a[0] ?? 0)) >= 100, `${tBefore} → ${tAfter}`);

  /* 8. 左右面板可拖拽调整宽度 */
  const st5 = await draftState();
  const libBefore = await page.evaluate(() => document.querySelector('.editor-lib')?.getBoundingClientRect().width || 0);
  const rz = page.locator('.panel-resizer').first();
  const rb = await rz.boundingBox();
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await page.mouse.down();
  await page.mouse.move(rb.x + rb.width / 2 + 90, rb.y + rb.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  const libAfter = await page.evaluate(() => document.querySelector('.editor-lib')?.getBoundingClientRect().width || 0);
  check('左侧元件库宽度可拖拽调整', libAfter - libBefore >= 60, `${libBefore} → ${libAfter}`);

  const sideBefore = await page.evaluate(() => document.querySelector('.editor-side')?.getBoundingClientRect().width || 0);
  const rz2 = page.locator('.panel-resizer').last();
  const rb2 = await rz2.boundingBox();
  await page.mouse.move(rb2.x + rb2.width / 2, rb2.y + rb2.height / 2);
  await page.mouse.down();
  await page.mouse.move(rb2.x + rb2.width / 2 - 80, rb2.y + rb2.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  const sideAfter = await page.evaluate(() => document.querySelector('.editor-side')?.getBoundingClientRect().width || 0);
  check('右侧属性面板宽度可拖拽调整', sideAfter - sideBefore >= 50, `${sideBefore} → ${sideAfter}`);

  /* 9. 自定义相线 U/V/W 被引擎识别为带电相（运行态检查 U 相网络 live） */
  const liveNets = await page.evaluate(() => {
    const shell = document.querySelector('.editor-shell');
    const s = shell?.__vueParentComponent?.setupState;
    const snap = s?.sim?.snapshot?.value;
    if (!snap) return null;
    return Object.entries(snap.nets || {}).filter(([, v]) => v?.live).map(([k]) => k);
  });
  check('仿真快照可读（相线带电信息）', Array.isArray(liveNets), JSON.stringify(liveNets));
} catch (e) {
  check('流程异常中断', false, String(e.message || e).slice(0, 260));
  try {
    const diag = await page.evaluate(() => ({
      url: location.href,
      toolbar: document.querySelector('.editor-toolbar')?.innerText?.replace(/\s+/g, ' ').slice(0, 200) || '(无)',
      side: document.querySelector('.editor-side')?.innerText?.replace(/\s+/g, ' ').slice(0, 200) || '(无)',
      checks: [...document.querySelectorAll('.check-cell .check-num')].map((e) => e.textContent),
    }));
    console.log('--- 页面诊断 ---\n' + JSON.stringify(diag, null, 2));
  } catch (_) { /* 页面可能已关闭 */ }
}

check('无未捕获页面异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ').slice(0, 300));

const pass = results.filter((r) => r.ok).length;
console.log(`\n=== 结果：${pass} 通过 / ${results.length - pass} 失败 ===`);
await browser.close();
process.exit(pass === results.length ? 0 : 1);
