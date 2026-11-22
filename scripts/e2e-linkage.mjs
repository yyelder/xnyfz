/**
 * 联动专项端到端验证（名称即联动）
 * ------------------------------------------------------------------
 * 1. 工业骨架 KM1 主触点/辅助触点/线圈编号同为 KM1（按名称联动）
 * 2. 从元件库放置 KM 线圈、KM 常开触点 → 自动起不重复编号 KM2（同类递增）
 * 3. 改编号 KM1→KM2 → 编号更新，且不写 group
 * 4. 属性面板不再显示「联动组」
 * 5. 运行态自锁：构造自锁电路 → 按启动 → 线圈得电 + 自锁触点闭合 → 松开保持
 */
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:5176';
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon|404 \(Not Found\)/i.test(m.text())) pageErrors.push(m.text());
});

const editorState = () =>
  page.evaluate(() => {
    const s = document.querySelector('.editor-shell')?.__vueParentComponent?.setupState;
    if (!s) return null;
    const d = s.draft;
    return {
      devices: (d?.devices || []).map((x) => ({ id: x.id, type: x.type, label: x.label, group: x.props?.group || '' })),
      nets: (d?.nets || []).map((n) => ({ id: n.id, phase: n.phase || '', pins: (n.pins || []).map((p) => p.join(':')) })),
      running: s.running,
      snapshot: s.sim?.snapshot?.value,
    };
  });

async function closeTutorial() {
  const card = page.locator('.tutorial-card');
  if (await card.isVisible().catch(() => false)) {
    await page.click('.tutorial-card .btn.primary');
    await card.waitFor({ state: 'hidden' });
  }
}

/** 通过组件 setupState 直接改 draft 结构并重建引擎（精确构造电路，避免脆弱的鼠标走线） */
async function applyCircuit(circuitPatch) {
  await page.evaluate((patch) => {
    const s = document.querySelector('.editor-shell')?.__vueParentComponent?.setupState;
    const d = s.draft;
    // 清空现有元件/网络，写入测试电路
    d.devices.splice(0, d.devices.length, ...patch.devices);
    d.nets.splice(0, d.nets.length, ...patch.nets);
    s.sim.rebuild();
  }, circuitPatch);
  await page.waitForTimeout(150);
}

try {
  await page.goto(`${BASE}/?view=workbench`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.wb-entry');

  /* 1. 工业骨架：KM1 元件编号同为 KM1（不依赖 group，按名称联动） */
  await page.click('.wb-entry:has-text("工业电路仿真")');
  await page.waitForSelector('.editor-toolbar');
  await page.waitForSelector('.svg-host svg');
  await closeTutorial();
  const st0 = await editorState();
  const km = st0.devices.filter((d) => /^KM1$/i.test(d.label)).map((d) => d.id);
  check('工业骨架 KM1 元件编号同 name', ['KM1', 'KM1NO', 'KM1C'].every((id) => km.includes(id)), km.join(','));
  check('工业骨架不再写显式 group', st0.devices.every((d) => !d.group));

  /* 2. 放置元件自动起不重复编号 */
  await page.fill('.devlib-search input', '接触器线圈');
  await page.click('.devlib-item:has-text("接触器线圈")');
  await page.click('.canvas-viewport', { position: { x: 500, y: 400 } });
  await page.waitForTimeout(100);
  const st1 = await editorState();
  const coil = st1.devices.filter((d) => d.type === 'km_coil');
  // 骨架已占用 KM1，新放置的线圈应递增到 KM2
  check('放置接触器线圈自动起编号 KM2（同类递增）', coil.length === 2 && coil.some((c) => c.label === 'KM2'), coil.map((c) => c.label).join(','));

  /* 3. 改编号即更新（不写 group） */
  const coilId = coil[0]?.id;
  if (coilId) {
    await page.click('.editor-toolbar button:has-text("选择")');
    await page.locator(`.svg-host [data-dev="${coilId}"] rect`).first().click({ force: true });
    await page.waitForTimeout(100);
    const labelInput = page.locator('.editor-side .net-editor .field:has-text("编号") input');
    if (await labelInput.count()) {
      await labelInput.fill('KM5');
      await labelInput.press('Tab');
      await page.waitForTimeout(120);
      const st2 = await editorState();
      const c2 = st2.devices.find((d) => d.id === coilId);
      check('改编号可更新（KM5）且不写 group', c2?.label === 'KM5' && !c2?.group, `${c2?.label}/${c2?.group || '空'}`);
    } else {
      check('改编号可更新（KM5）且不写 group', false, '编号输入框未找到');
    }
  }

  /* 4. 属性面板不再显示联动组字段 */
  const groupField = page.locator('.editor-side .net-editor .field:has-text("联动组") input');
  check('属性面板已移除「联动组」字段', (await groupField.count()) === 0);

  /* 5. 编辑态改编号 KM1→KM2 → 运行态与 KM2 线圈联动（本轮核心需求端到端） */
  await applyCircuit({
    devices: [
      { id: 'SB2', type: 'sb_no', label: 'SB2', x: 480, y: 300, rot: 0, props: {} },
      { id: 'aux', type: 'km_no', label: 'KM1', x: 700, y: 300, rot: 0, props: {} },
      { id: 'coilKM2', type: 'km_coil', label: 'KM2', x: 700, y: 520, rot: 0, props: {} },
    ],
    nets: [
      { id: 'L', phase: 'L', pins: [['SB2', '1'], ['aux', '1']] },
      { id: 'nB', pins: [['SB2', '2'], ['aux', '2'], ['coilKM2', 'A1']] },
      { id: 'N', phase: 'N', pins: [['coilKM2', 'A2']] },
    ],
  });
  // 初始：aux=KM1，KM2 线圈得电时 aux 不应联动闭合
  await page.click('.editor-toolbar button:has-text("运行仿真")');
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    const s = document.querySelector('.editor-shell')?.__vueParentComponent?.setupState;
    s.sim.press('SB2', true);
  });
  await page.waitForTimeout(220);
  let snapX = (await editorState()).snapshot;
  check('改名前沿用 KM1：KM2 线圈得电但触点不联动', !!snapX?.loads?.coilKM2?.energized && !snapX?.devices?.aux?.closed);
  // 返回编辑态，把 aux 编号改成 KM2
  await page.click('.editor-toolbar button:has-text("返回编辑")');
  await page.waitForTimeout(120);
  await page.locator('.svg-host [data-dev="aux"] rect').first().click({ force: true });
  await page.waitForTimeout(100);
  const auxLabel = page.locator('.editor-side .net-editor .field:has-text("编号") input').first();
  await auxLabel.fill('KM2');
  await auxLabel.press('Tab');
  await page.waitForTimeout(120);
  const stRename = await editorState();
  check('编辑态把 aux 编号从 KM1 改为 KM2 成功', stRename.devices.find((d) => d.id === 'aux')?.label === 'KM2');
  // 再运行：KM2 线圈得电时触点应闭合
  await page.click('.editor-toolbar button:has-text("运行仿真")');
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    const s = document.querySelector('.editor-shell')?.__vueParentComponent?.setupState;
    s.sim.press('SB2', true);
  });
  await page.waitForTimeout(220);
  snapX = (await editorState()).snapshot;
  check('改名后 KM2 线圈得电 & 该常开触点闭合（名称联动闭环）', !!snapX?.loads?.coilKM2?.energized && !!snapX?.devices?.aux?.closed);
  await page.click('.editor-toolbar button:has-text("返回编辑")');
  await page.waitForTimeout(100);

  /* 6. 运行态自锁（编号同为 KM1 → 按名称联动） */
  await applyCircuit({
    devices: [
      { id: 'SB2', type: 'sb_no', label: 'SB2', x: 500, y: 300, rot: 0, props: {} },
      { id: 'aux', type: 'km_no', label: 'KM1', x: 700, y: 300, rot: 0, props: {} },
      { id: 'coil', type: 'km_coil', label: 'KM1', x: 700, y: 520, rot: 0, props: {} },
    ],
    nets: [
      { id: 'L', phase: 'L', pins: [['SB2', '1'], ['aux', '1']] },
      { id: 'nB', pins: [['SB2', '2'], ['aux', '2'], ['coil', 'A1']] },
      { id: 'N', phase: 'N', pins: [['coil', 'A2']] },
    ],
  });
  await page.click('.editor-toolbar button:has-text("运行仿真")');
  await page.waitForTimeout(150);
  // 通过引擎 press 触发启动按钮（模拟点击）
  await page.evaluate(() => {
    const s = document.querySelector('.editor-shell')?.__vueParentComponent?.setupState;
    s.sim.press('SB2', true);
  });
  await page.waitForTimeout(250);
  let snap = (await editorState()).snapshot;
  check('运行态按住启动：线圈得电 + 自锁触点闭合', !!snap?.loads?.coil?.energized && !!snap?.devices?.aux?.closed);
  await page.evaluate(() => {
    const s = document.querySelector('.editor-shell')?.__vueParentComponent?.setupState;
    s.sim.press('SB2', false);
  });
  await page.waitForTimeout(250);
  snap = (await editorState()).snapshot;
  check('运行态松开启动：自锁保持', !!snap?.loads?.coil?.energized && !!snap?.devices?.aux?.closed);

  check('无未捕获页面异常', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ').slice(0, 200));
} catch (e) {
  check('流程异常中断', false, String(e.message || e).slice(0, 240));
} finally {
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n=== 结果：${pass} 通过 / ${results.length - pass} 失败 ===`);
  await browser.close();
  process.exit(pass === results.length ? 0 : 1);
}
