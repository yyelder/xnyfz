/**
 * 线号 / 说明文本（含配图）/ 默认标号位置 —— 端到端验证
 * ------------------------------------------------------------------
 * 1. 工业骨架里默认存在的元件（KM1/SB1/SB2/M1/线圈）标号都在左侧
 * 2. 双击导线 → 自动添加线号并聚焦输入框；键盘输入即时生效（此前"线号无法设置"）
 * 3. 工具栏「💬 说明」→ 画布落点生成说明卡片，输入文字即时渲染
 * 4. 给说明卡片上传图片 → 渲染 <image>；切换图片位置生效
 * 5. 选中说明卡片按 Delete 删除
 */
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:5176';
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
};

// 1×1 透明 PNG，用于测试图片上传链路
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon|404 \(Not Found\)/i.test(m.text())) pageErrors.push(m.text());
});

const state = () =>
  page.evaluate(() => {
    const s = document.querySelector('.editor-shell')?.__vueParentComponent?.setupState;
    if (!s) return null;
    const d = s.draft;
    return {
      devices: (d?.devices || []).map((x) => ({ id: x.id, label: x.label, labelPos: x.labelPos })),
      nets: (d?.nets || []).map((n) => ({ id: n.id, tag: n.tag || '', name: n.name || '' })),
      notes: (d?.notes || []).map((n) => ({
        id: n.id, text: n.text, x: n.x, y: n.y, w: n.w,
        image: n.image ? n.image.slice(0, 24) : '', imagePos: n.imagePos || '',
      })),
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

  await page.click('.wb-entry:has-text("工业电路仿真")');
  await page.waitForSelector('.editor-toolbar');
  await page.waitForSelector('.svg-host svg');
  await closeTutorial();

  /* 1. 骨架默认元件标号在左侧 */
  let st = await state();
  const ids = ['KM1', 'SB1', 'SB2', 'KM1NO', 'M1', 'KM1C'];
  const bad = ids.filter((id) => st.devices.find((d) => d.id === id)?.labelPos !== 'left');
  check('骨架默认元件标号全部在左侧', bad.length === 0, bad.length ? `未生效：${bad.join(',')}` : '');

  /* 造一段导线用于测线号（净空区域，避免压到骨架元件） */
  await page.evaluate(() => {
    const s = document.querySelector('.editor-shell').__vueParentComponent.setupState;
    s.draft.nets.push({ id: 'TAGNET', phase: 'U', geometry: [[[220, 980], [820, 980]]], pins: [] });
  });
  await page.waitForTimeout(200);

  const wirePt = await page.evaluate(() => {
    // 命中线是 line[data-net]（<g class="wire"> 也带 data-net，但没有 x1/y1，必须筛 line）
    const ln = document.querySelector('.svg-host line[data-net="TAGNET"]');
    if (!ln) return null;
    const svg = ln.ownerSVGElement;
    const ctm = ln.getScreenCTM();
    const p = svg.createSVGPoint();
    const x1 = +(ln.getAttribute('x1') || 0);
    const y1 = +(ln.getAttribute('y1') || 0);
    const x2 = +(ln.getAttribute('x2') || 0);
    const y2 = +(ln.getAttribute('y2') || 0);
    p.x = (x1 + x2) / 2;
    p.y = (y1 + y2) / 2;
    const sp = p.matrixTransform(ctm);
    return { x: sp.x, y: sp.y };
  });
  check('测试导线已渲染并可定位', !!wirePt, JSON.stringify(wirePt));

  /* 2. 双击导线 → 自动加线号并聚焦输入框 */
  await page.mouse.dblclick(wirePt.x, wirePt.y);
  await page.waitForTimeout(200);
  const focusedTag = await page.evaluate(() => {
    const a = document.activeElement;
    return { tag: a?.tagName, ph: a?.getAttribute?.('placeholder') || '' };
  });
  check('双击导线后焦点落在「线号」输入框', focusedTag.tag === 'INPUT' && focusedTag.ph.includes('显示在导线旁'), focusedTag.ph);
  st = await state();
  check('双击自动生成默认线号（非空）', !!st.nets.find((n) => n.id === 'TAGNET')?.tag, st.nets.find((n) => n.id === 'TAGNET')?.tag);

  // 键盘输入（全选替换）→ 即时生效
  await page.keyboard.press('Control+a');
  await page.keyboard.type('201');
  await page.waitForTimeout(150);
  st = await state();
  check('键盘输入线号即时写入 draft', st.nets.find((n) => n.id === 'TAGNET')?.tag === '201', st.nets.find((n) => n.id === 'TAGNET')?.tag);
  let svg = await page.locator('.svg-host').innerHTML();
  check('线号已渲染在画布上', svg.includes('>201</text>'));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);

  /* 3. 说明文本 */
  await page.click('.editor-toolbar button:has-text("说明")');
  // 落点必须落在画布内容区（.canvas-content 经缩放平移后有留白，点留白不会放置）
  await page.click('.canvas-viewport', { position: { x: 520, y: 600 } });
  await page.waitForTimeout(250);
  st = await state();
  check('画布落点生成说明卡片', st.notes.length === 1, `notes=${st.notes.length}`);
  const noteId = st.notes[0]?.id;

  await page.keyboard.type('按下 SB2，KM1 线圈得电并自锁');
  await page.waitForTimeout(200);
  st = await state();
  check('说明文字键盘输入即时生效', (st.notes[0]?.text || '').includes('KM1 线圈得电'), st.notes[0]?.text);
  svg = await page.locator('.svg-host').innerHTML();
  check('说明文字已渲染到画布', svg.includes('按下 SB2，KM1 线圈得电并自锁') || svg.includes('并自锁'));

  /* 4. 配图上传 */
  await page.setInputFiles('.note-file input[type="file"]', { name: 'dot.png', mimeType: 'image/png', buffer: PNG });
  await page.waitForTimeout(400);
  st = await state();
  check('图片上传后写入说明卡片', (st.notes[0]?.image || '').startsWith('data:image'), st.notes[0]?.image);
  svg = await page.locator('.svg-host').innerHTML();
  check('画布渲染 <image> 配图', svg.includes('<image'));

  // 切换图片位置为左侧 → 图片 x 应回到内边距
  await page.selectOption('.note-editor .field:has-text("图片位置") select', 'left');
  await page.waitForTimeout(250);
  st = await state();
  check('图片位置可切换为左侧', st.notes[0]?.imagePos === 'left', st.notes[0]?.imagePos);
  const imgX = await page.evaluate(() => {
    const im = document.querySelector('.svg-host .note image');
    return im ? Number(im.getAttribute('x')) : null;
  });
  check('左侧图片贴近卡片内边距', imgX === 12, String(imgX));

  // 拖动说明卡片
  const before = (await state()).notes[0];
  const box = await page.locator('.svg-host .note').first().boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after = (await state()).notes[0];
  check('说明卡片可拖动位置', after.x !== before.x || after.y !== before.y, `${before.x},${before.y} → ${after.x},${after.y}`);

  /* 5. Delete 删除说明卡片 */
  await page.locator('.svg-host .note').first().click({ force: true });
  await page.waitForTimeout(150);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(250);
  st = await state();
  check('选中说明卡片按 Delete 可删除', st.notes.length === 0, `notes=${st.notes.length}（id=${noteId}）`);

  check('运行期无 JS 报错', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} catch (err) {
  check('E2E 执行未抛异常', false, String(err?.message || err));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n结果：${results.length - failed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
