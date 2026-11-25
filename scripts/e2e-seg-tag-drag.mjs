/**
 * 导线随元件一起框选拖动 + 线号可拖动 —— 端到端验证
 * ------------------------------------------------------------------
 * 1. 线号渲染为独立可拖拽组（data-tag-drag），紫色、17 号加粗
 * 2. 拖动线号 → 写入独立字段 net.wireTagPos（网格吸附），不污染网络标号 flagPos
 * 3. 框选同时命中元件与导线 → selectedIds + selectedSegs 双选
 * 4. 拖动任一选中对象（这里点导线）→ 元件与导线整体平移，相对位置不变
 * 5. Ctrl+Z 一次撤销 → 元件与导线同时恢复（同一历史节点）
 */
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:5176';
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 980 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon|404 \(Not Found\)/i.test(m.text())) pageErrors.push(m.text());
});

/** 读取 setupState：选择状态 + 电路数据 */
const STATE = () =>
  page.evaluate(() => {
    const s = document.querySelector('.editor-shell')?.__vueParentComponent?.setupState;
    if (!s) return null;
    return {
      selected: s.selected,
      selectedIds: [...(s.selectedIds || [])],
      selectedSegs: (s.selectedSegs || []).map((x) => ({ ...x })),
      selectedNet: s.selectedNet,
      devices: (s.draft?.devices || []).map((d) => ({ id: d.id, x: d.x, y: d.y })),
      nets: (s.draft?.nets || []).map((n) => ({
        id: n.id,
        tag: n.tag || '',
        geometry: JSON.parse(JSON.stringify(n.geometry || [])),
        wireTagPos: n.wireTagPos ? { ...n.wireTagPos } : null,
        flagPos: n.flagPos ? { ...n.flagPos } : null,
      })),
    };
  });

/** 图纸坐标 → 屏幕坐标 */
const toScreen = (pt) =>
  page.evaluate((p) => {
    const svg = document.querySelector('.svg-host svg');
    const ctm = svg.getScreenCTM();
    const m = new DOMPoint(p.x, p.y).matrixTransform(ctm);
    return { x: m.x, y: m.y };
  }, pt);

async function closeTutorialIfAny() {
  const card = page.locator('.tutorial-card');
  if (await card.isVisible().catch(() => false)) {
    await page.click('.tutorial-card .btn.primary');
    await card.waitFor({ state: 'hidden' });
  }
}

/** 注入最小测试电路：两元件 + 一段带线号的水平走线 */
async function injectCircuit() {
  await page.evaluate(() => {
    const s = document.querySelector('.editor-shell')?.__vueParentComponent?.setupState;
    s.draft.devices = [
      { id: 'COIL', type: 'km_coil', label: 'KM1', labelPos: 'right', x: 300, y: 300, rot: 0, props: {} },
      { id: 'NO', type: 'km_no', label: 'KM1', labelPos: 'right', x: 640, y: 300, rot: 0, props: {} },
    ];
    s.draft.nets = [
      // 线号 5 自动定位在水平导线中点上方（370, 291）
      { id: 'w1', pins: [], tag: '5', geometry: [[[200, 300], [540, 300]]] },
    ];
    s.selected = null;
    s.selectedIds = [];
    s.selectedSegs = [];
    s.selectedNet = null;
    s.sim.rebuild();
  });
  await page.waitForTimeout(250);
}

/** 按住拖动（带中间插值，适配指针事件阈值） */
async function dragBy(from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

try {
  await page.goto(`${BASE}/?view=workbench`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.wb-entry');
  await page.click('.wb-entry:has-text("工业电路仿真")');
  await page.waitForSelector('.svg-host svg');
  await closeTutorialIfAny();
  await injectCircuit();

  /* ---------------------------------------------------------- 1. 线号渲染 */
  const tagHtml = await page.evaluate(() => document.querySelector('.svg-host .wire-tag')?.outerHTML || '');
  check('线号渲染为独立可拖拽组 .wire-tag', tagHtml.includes('data-tag-drag="w1"'));
  check('线号紫色 #7b2fbf', tagHtml.includes('#7b2fbf'));
  check('线号 17 号加粗', tagHtml.includes('font-size="17"') && tagHtml.includes('font-weight="800"'));

  /* ---------------------------------------------------------- 2. 拖动线号 */
  const tagBox = await page.evaluate(() => {
    const t = document.querySelector('.svg-host .wire-tag text');
    const r = t.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  const tagTo = await toScreen({ x: 440, y: 240 });
  await dragBy(tagBox, tagTo);

  let st = await STATE();
  let w1 = st.nets.find((n) => n.id === 'w1');
  check('拖动线号后写入独立字段 wireTagPos', !!w1?.wireTagPos, JSON.stringify(w1?.wireTagPos));
  check(
    '线号位置吸附到 (440,240)',
    !!w1?.wireTagPos && Math.abs(w1.wireTagPos.x - 440) <= 11 && Math.abs(w1.wireTagPos.y - 240) <= 11,
    JSON.stringify(w1?.wireTagPos)
  );
  check('网络标号小旗 flagPos 未被污染', !w1?.flagPos);
  check('拖动线号只改位置、不改线号内容', w1?.tag === '5', w1?.tag);

  /* ---------------------------------------------------------- 3. 框选元件 + 导线 */
  const a = await toScreen({ x: 150, y: 220 });
  const b = await toScreen({ x: 700, y: 380 });
  await dragBy(a, b);

  st = await STATE();
  check('框选命中两个元件', (st.selectedIds || []).length === 2, JSON.stringify(st.selectedIds));
  check(
    '框选同时命中导线（selectedSegs）',
    (st.selectedSegs || []).length === 1 && st.selectedSegs[0].netId === 'w1' && st.selectedSegs[0].segIndex === 0,
    JSON.stringify(st.selectedSegs)
  );
  const purpleCount = await page.evaluate(() => {
    const svg = document.querySelector('.svg-host svg')?.innerHTML || '';
    return (svg.match(/#7b2fbf/g) || []).length;
  });
  check('被选中导线渲染紫色高亮底线', purpleCount >= 2, `紫色出现 ${purpleCount} 次`);

  /* ---------------------------------------------------------- 4. 点导线拖动 → 整组平移 */
  const before = {
    coil: { ...st.devices.find((d) => d.id === 'COIL') },
    no: { ...st.devices.find((d) => d.id === 'NO') },
    geo: JSON.parse(JSON.stringify(w1.geometry)),
  };
  // 取导线左段 (250,300)：避开元件符号与 KM1 标号文字（标号命中优先于导线）
  const from = await toScreen({ x: 250, y: 300 });
  const to = await toScreen({ x: 450, y: 340 });
  await dragBy(from, to);

  st = await STATE();
  const afterCoil = st.devices.find((d) => d.id === 'COIL');
  const afterNo = st.devices.find((d) => d.id === 'NO');
  const afterW1 = st.nets.find((n) => n.id === 'w1');
  check(
    '拖动被选中导线：元件同步平移 (+200,+40)',
    afterCoil?.x === before.coil.x + 200 &&
      afterCoil?.y === before.coil.y + 40 &&
      afterNo?.x === before.no.x + 200 &&
      afterNo?.y === before.no.y + 40,
    `${JSON.stringify(afterCoil)} ${JSON.stringify(afterNo)}`
  );
  const geoMoved =
    afterW1?.geometry?.[0]?.[0]?.[0] === before.geo[0][0][0] + 200 &&
    afterW1?.geometry?.[0]?.[0]?.[1] === before.geo[0][0][1] + 40 &&
    afterW1?.geometry?.[0]?.[1]?.[0] === before.geo[0][1][0] + 200 &&
    afterW1?.geometry?.[0]?.[1]?.[1] === before.geo[0][1][1] + 40;
  check('导线几何同步平移，长度与方向不变', geoMoved, JSON.stringify(afterW1?.geometry));

  /* ---------------------------------------------------------- 5. Ctrl+Z 一次撤销 */
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  st = await STATE();
  const undoCoil = st.devices.find((d) => d.id === 'COIL');
  const undoW1 = st.nets.find((n) => n.id === 'w1');
  check(
    'Ctrl+Z 一次撤销：元件与导线同时恢复',
    undoCoil?.x === before.coil.x &&
      undoCoil?.y === before.coil.y &&
      undoW1?.geometry?.[0]?.[0]?.[0] === before.geo[0][0][0] &&
      undoW1?.geometry?.[0]?.[1]?.[0] === before.geo[0][1][0],
    `dev=${JSON.stringify(undoCoil)} geo=${JSON.stringify(undoW1?.geometry?.[0])}`
  );

  check('运行期无未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} catch (e) {
  check('流程未异常中断', false, String(e.message || e));
} finally {
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n=== 结果：${ok} 通过 / ${results.length - ok} 失败 ===`);
  await browser.close();
  if (ok !== results.length) process.exitCode = 1;
}
