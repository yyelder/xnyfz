/**
 * 插入的三相线 / 单相线可移动 —— 端到端验证
 * ------------------------------------------------------------------
 * 1. 工作台新建工业电路 → 插入三相 U/V/W/N/PE → 生成 5 条 bus 母线
 * 2. 选择工具下按住 U 相线拖动：整条线（几何 + 相线文字）平移，其它相线不动
 * 3. Ctrl+Z 一次撤销整次移动
 * 4. 插入单相 L/N/PE → 同样可单独拖动
 * 5. 框选命中多条母线后拖动其中一条 → 整组一起平移（相对间距不变）
 * 6. 走线工具下点击母线只起线、不移动，母线几何保持不变
 * 7. 拖动过程中无未捕获异常；页面刷新后（保存前）不报渲染错误
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
page.on('dialog', (d) => d.accept().catch(() => {}));

/** 读取编辑器内部状态（Vue setupState，避免靠猜 DOM） */
const state = () =>
  page.evaluate(() => {
    const s = document.querySelector('.editor-shell')?.__vueParentComponent?.setupState;
    if (!s) return null;
    const d = s.draft;
    return {
      tool: s.tool,
      selectedNet: s.selectedNet,
      selectedSegs: (s.selectedSegs || []).map((x) => ({ ...x })),
      nets: (d?.nets || []).map((n) => ({
        id: n.id,
        bus: !!n.bus,
        phase: n.phase || '',
        geometry: JSON.parse(JSON.stringify(n.geometry || [])),
        label: n.label ? { ...n.label } : null,
      })),
    };
  });

/** 图纸坐标 → 屏幕坐标，并返回当前缩放系数 */
const toScreen = (pt) =>
  page.evaluate((p) => {
    const svg = document.querySelector('.svg-host svg');
    const ctm = svg.getScreenCTM();
    const m = new DOMPoint(p.x, p.y).matrixTransform(ctm);
    return { x: m.x, y: m.y, k: ctm.a };
  }, pt);

/** 在图纸坐标 pt 处按下，按图纸增量 (dx,dy) 拖动后松开 */
async function dragAt(pt, dx, dy) {
  const a = await toScreen(pt);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + (dx * a.k) / 2, a.y + (dy * a.k) / 2, { steps: 8 });
  await page.mouse.move(a.x + dx * a.k, a.y + dy * a.k, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(180);
}

/** 取某条母线的主干首点，便于比较平移量 */
const head = (st, id) => st.nets.find((n) => n.id === id)?.geometry?.[0]?.[0] || null;

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
  await page.click('.wb-entry:has-text("工业电路仿真")');
  await page.waitForSelector('.editor-toolbar');
  await page.waitForSelector('.svg-host svg');
  await closeTutorial();
  await page.waitForTimeout(150);

  /* ---------------------------------------------------------- 1. 插入三相母线 */
  await page.click('button:has-text("插入三相 U/V/W/N/PE")');
  await page.waitForTimeout(200);
  let st = await state();
  const bus = st.nets.filter((n) => n.bus);
  check('插入三相生成 5 条电源母线', bus.length === 5, `count=${bus.length}`);
  check('三相母线相别为 U/V/W/N/PE',
    ['U', 'V', 'W', 'N', 'PE'].every((p) => bus.some((b) => b.phase === p)),
    bus.map((b) => b.phase).join(','));
  check('母线渲染为可拖动组 data-bus="1"',
    (await page.locator('.svg-host g.wire[data-bus="1"]').count()) === 5,
    `n=${await page.locator('.svg-host g.wire[data-bus="1"]').count()}`);
  check('母线光标为 move', (await page.locator('.svg-host g.wire[data-bus="1"]').first().getAttribute('style'))?.includes('move') === true);

  /* ---------------------------------------------------------- 2. 单独拖动 U 相线 */
  const u0 = head(st, 'U');
  const v0 = head(st, 'V');
  const uLabel0 = st.nets.find((n) => n.id === 'U')?.label;
  check('U 相线主干起点为 (80,80)', u0 && u0[0] === 80 && u0[1] === 80, JSON.stringify(u0));

  await dragAt({ x: 400, y: 80 }, 100, 50);
  st = await state();
  const u1 = head(st, 'U');
  const v1 = head(st, 'V');
  const uLabel1 = st.nets.find((n) => n.id === 'U')?.label;
  check('拖动后 U 相线主干平移 (100,50)',
    u1 && u1[0] === u0[0] + 100 && u1[1] === u0[1] + 50, JSON.stringify(u1));
  check('拖动后 U 相线文字同步平移',
    uLabel1 && uLabel1.x === uLabel0.x + 100 && uLabel1.y === uLabel0.y + 50,
    JSON.stringify(uLabel1));
  check('单独拖动不影响 V 相线', JSON.stringify(v1) === JSON.stringify(v0), JSON.stringify(v1));
  check('拖动同时选中该母线（右侧可编辑属性）', st.selectedNet === 'U', String(st.selectedNet));

  /* ---------------------------------------------------------- 3. 一次撤销 */
  await page.click('button[title="撤销 (Ctrl+Z)"]');
  await page.waitForTimeout(200);
  st = await state();
  check('Ctrl+Z 一次撤销整次母线移动', JSON.stringify(head(st, 'U')) === JSON.stringify(u0), JSON.stringify(head(st, 'U')));
  const uLabelUndo = st.nets.find((n) => n.id === 'U')?.label;
  check('撤销后相线文字也恢复', uLabelUndo.x === uLabel0.x && uLabelUndo.y === uLabel0.y);

  /* ---------------------------------------------------------- 4. 插入单相母线并拖动 */
  await page.click('button:has-text("插入单相 L/N/PE")');
  await page.waitForTimeout(200);
  st = await state();
  const single = st.nets.filter((n) => n.bus && (n.phase === 'L' || n.id.startsWith('N-') || n.id.startsWith('PE-')));
  check('插入单相新增 3 条母线', st.nets.filter((n) => n.bus).length === 8,
    `count=${st.nets.filter((n) => n.bus).length}`);
  const lNet = st.nets.find((n) => n.bus && n.phase === 'L');
  check('单相 L 母线存在', !!lNet, JSON.stringify(single.map((s) => s.id)));
  if (lNet) {
    const l0 = head(st, lNet.id);
    const [lx, ly] = l0;
    await dragAt({ x: 400, y: ly }, -60, 40);
    st = await state();
    const l1 = head(st, lNet.id);
    check('单相 L 母线也可整条拖动', l1 && l1[0] === lx - 60 && l1[1] === ly + 40, JSON.stringify(l1));
  } else {
    check('单相 L 母线也可整条拖动', false, '未找到 L 母线');
  }

  /* ---------------------------------------------------------- 5. 框选批量拖动多条母线 */
  // 先撤销单相移动，让 U/V/W 回到 80/128/176 便于框选
  await page.click('button[title="撤销 (Ctrl+Z)"]');
  await page.waitForTimeout(150);
  const selFrom = await toScreen({ x: 50, y: 50 });
  const selTo = await toScreen({ x: 700, y: 210 });
  await page.mouse.move(selFrom.x, selFrom.y);
  await page.mouse.down();
  await page.mouse.move(selTo.x, selTo.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(180);
  st = await state();
  const busSegs = st.selectedSegs.filter((s) => s.bus);
  check('框选命中多条母线的全部折线', busSegs.length >= 3, `segs=${busSegs.length}`);
  check('框选段带 bus 标记（供整网平移）', busSegs.every((s) => s.bus === true));

  const beforeGroup = Object.fromEntries(['U', 'V', 'W'].map((id) => [id, head(st, id)]));
  // 用 410 避开母线接线点位（tap 无 data-seg，群组拖动需点在线体上）
  await dragAt({ x: 410, y: 80 }, 0, 60);
  st = await state();
  const movedAll = ['U', 'V', 'W'].every((id) => {
    const b = beforeGroup[id];
    const a = head(st, id);
    return b && a && a[0] === b[0] && a[1] === b[1] + 60;
  });
  check('框选后拖动一条母线 → U/V/W 整组平移', movedAll,
    JSON.stringify(['U', 'V', 'W'].map((id) => [id, head(st, id)])));
  const ys = ['U', 'V', 'W'].map((id) => head(st, id)?.[1]);
  check('整组平移后相线间距保持不变', ys[1] - ys[0] === 48 && ys[2] - ys[1] === 48, JSON.stringify(ys));

  /* ---------------------------------------------------------- 6. 走线工具下不移动母线 */
  await page.click('button:has-text("✏️ 走线")');
  await page.waitForTimeout(120);
  st = await state();
  check('工具已切换到走线', st.tool === 'wire', String(st.tool));
  const beforeWire = JSON.stringify(head(st, 'U'));
  await dragAt({ x: 400, y: ys[0] }, 80, 80);
  st = await state();
  check('走线工具下拖动母线不会平移几何', JSON.stringify(head(st, 'U')) === beforeWire,
    JSON.stringify(head(st, 'U')));
  await page.keyboard.press('Escape');
  await page.click('button:has-text("✏️ 走线")'); // 切回选择工具（toggle）若未切换则无害
  await page.waitForTimeout(100);

  check('运行期无未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} catch (err) {
  check('E2E 执行未抛异常', false, String(err && (err.stack || err.message || err)).slice(0, 400));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n=== 结果：${results.length - failed.length} 通过 / ${failed.length} 失败 ===`);
if (failed.length) process.exit(1);
