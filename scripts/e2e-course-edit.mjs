/**
 * 课程仿真 › 我的电路：原理图直接编辑 —— 端到端验证
 * ------------------------------------------------------------------
 * 1. 「我的电路」显示「✏️ 编辑原理图」（不再有编辑副本）；「课程电路」保留「编辑副本」
 * 2. 进入完整编辑器（课程模式）：段级删线 / 说明文本 / 走线 / 撤销重做等能力齐全
 * 3. 说明文本：工具栏「💬 说明」→ 画布落点 → 输入文字即时渲染
 * 4. 线段删除：点中某条走线段按 Delete，只删该段、网络与其它段保留
 * 5. 「✓ 完成编辑」写回同一门课程（id / kind / 标题不变），课程目录不产生任何副本
 * 6. 返回课程仿真后画布立即同步；刷新后改动仍在（localStorage 持久化）
 * 7. 「课程电路」（内置 + 已加入课程列表的用户课程）仍可「编辑副本」到「我的电路」
 */
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:5176';
const USER_KEY = 'scj.user-circuits.v1';
const CATALOG_KEY = 'scj.course-catalog.v1';
const COURSE_ID = 'u-edit-direct';

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
};

const courseDoc = {
  id: COURSE_ID,
  kind: 'course',
  builtin: false,
  title: '课程直接编辑测试电路',
  summary: '用于验证我的电路原理图可直接编辑',
  category: 'drive',
  order: 90,
  difficulty: 2,
  duration: 15,
  updatedAt: Date.now(),
  canvas: { width: 2400, height: 1500 },
  supply: { system: '3ph', voltage: 380 },
  devices: [],
  nets: [
    { id: 'L1', phase: 'L1', bus: true, geometry: [[[120, 100], [1200, 100]]], pins: [], label: { text: 'L1', x: 120, y: 90 } },
    { id: 'w1', geometry: [[[300, 260], [600, 260]], [[800, 360], [1100, 360]]], pins: [] },
  ],
  notes: [],
  theory: ['测试原理'], steps: [], checkpoints: [],
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 980 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon|404 \(Not Found\)/i.test(m.text())) pageErrors.push(m.text());
});
// 旧搭建模式保存时会弹原生 alert，自动接受以免阻塞
page.on('dialog', (d) => d.accept().catch(() => {}));

/** 编辑器内部 draft / 选中态（Vue setupState，稳定读取结构而非猜 DOM） */
const editorState = () =>
  page.evaluate(() => {
    const shell = document.querySelector('.editor-shell');
    const s = shell?.__vueParentComponent?.setupState;
    if (!s) return null;
    const d = s.draft;
    return {
      selectedNote: s.selectedNote,
      selectedNet: s.selectedNet,
      selectedSeg: s.selectedSeg,
      notes: (d?.notes || []).map((n) => ({ id: n.id, text: n.text })),
      nets: (d?.nets || []).map((n) => ({ id: n.id, geomLen: (n.geometry || []).length })),
      title: d?.title || '',
      kind: d?.kind || '',
    };
  });

/** localStorage 里的用户课程（保存后的真实落盘数据） */
const storedUsers = () =>
  page.evaluate((key) => {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
  }, USER_KEY);

const storedCourse = async () => (await storedUsers()).find((c) => c.id === COURSE_ID) || null;

async function closeTutorial() {
  const card = page.locator('.tutorial-card');
  if (await card.isVisible().catch(() => false)) {
    await page.click('.tutorial-card .btn.primary');
    await card.waitFor({ state: 'hidden' });
  }
}

/** 取某条走线段命中线的屏幕坐标（取 1/3 处，避开端点与接点） */
async function segScreenPoint(netId, segIndex) {
  return page.evaluate(([nid, si]) => {
    const ln = document.querySelector(`.svg-host line[data-net="${nid}"][data-seg="${si}"]`);
    if (!ln) return null;
    const ctm = ln.getScreenCTM();
    if (!ctm) return null;
    const svg = ln.ownerSVGElement;
    const x1 = +ln.getAttribute('x1'), y1 = +ln.getAttribute('y1');
    const x2 = +ln.getAttribute('x2'), y2 = +ln.getAttribute('y2');
    const p = svg.createSVGPoint();
    p.x = x1 + (x2 - x1) / 3; p.y = y1 + (y2 - y1) / 3;
    const sp = p.matrixTransform(ctm);
    return { x: sp.x, y: sp.y };
  }, [netId, segIndex]);
}

try {
  /* ---------------------------------------------------------- 0. 预置一门「我的电路」课程 */
  await page.goto(`${BASE}/?view=courses`);
  await page.evaluate(
    ([userKey, catKey, doc]) => {
      localStorage.clear();
      localStorage.setItem(userKey, JSON.stringify([doc]));
      localStorage.removeItem(catKey);
    },
    [USER_KEY, CATALOG_KEY, courseDoc]
  );
  await page.reload();
  await page.waitForTimeout(400);

  const mineItem = page.locator(`.mine-body[data-mine-body="drive"] .course-item[data-course-id="${COURSE_ID}"]`);
  check('预置课程出现在「电力拖动控制 › 我的电路」', (await mineItem.count()) === 1, `count=${await mineItem.count()}`);
  await mineItem.click();
  await page.waitForTimeout(200);

  /* ---------------------------------------------------------- 1. 编辑入口：无「编辑副本」 */
  const tb = await page.evaluate(() => ({
    title: document.querySelector('.course-title')?.textContent.trim() || '',
    edit: document.querySelector('[data-op="edit-course"]')?.textContent.trim() || '',
    copy: document.querySelector('[data-op="edit-copy"]')?.textContent.trim() || '',
    all: [...document.querySelectorAll('.toolbar button')].map((b) => b.textContent.trim()),
  }));
  check('我的电路显示「编辑原理图」', tb.edit.includes('编辑原理图'), tb.edit);
  check('我的电路不再显示「编辑副本」', !tb.all.some((t) => t.includes('编辑副本')), JSON.stringify(tb.all));
  check('打开的是原课程（标题无副本）', tb.title === courseDoc.title, tb.title);

  /* ---------------------------------------------------------- 2. 进入课程模式完整编辑器 */
  await page.click('[data-op="edit-course"]');
  await page.waitForTimeout(400);
  await closeTutorial();
  const em = await page.evaluate(() => {
    const bar = document.querySelector('.editor-toolbar');
    const txt = bar ? [...bar.querySelectorAll('button')].map((b) => b.textContent.trim()) : [];
    return {
      shell: !!document.querySelector('.editor-shell'),
      badge: document.querySelector('[data-course-mode]')?.textContent.trim() || '',
      back: document.querySelector('[data-op="editor-back"]')?.textContent.trim() || '',
      buttons: txt,
    };
  });
  check('进入完整原理图编辑器', em.shell);
  check('标识「直接编辑原图（无副本）」', em.badge.includes('无副本'), em.badge);
  check('返回按钮指向课程仿真', em.back.includes('返回课程仿真'), em.back);
  check('课程模式隐藏「加入课程仿真」', !em.buttons.some((t) => t.includes('加入课程仿真')), JSON.stringify(em.buttons));
  check('课程模式提供「完成编辑」', em.buttons.some((t) => t.includes('完成编辑')));
  check('完整编辑能力：走线 / 说明 / 撤销 / 删除',
    ['走线', '说明', '撤销', '删除'].every((k) => em.buttons.some((t) => t.includes(k))),
    JSON.stringify(em.buttons));
  const st0 = await editorState();
  check('编辑器装载的是原课程（kind=course、标题不变）', st0?.kind === 'course' && st0?.title === courseDoc.title,
    JSON.stringify({ kind: st0?.kind, title: st0?.title }));

  /* ---------------------------------------------------------- 3. 说明添加 */
  await page.click('.editor-toolbar button:has-text("说明")');
  await page.click('.canvas-viewport', { position: { x: 560, y: 620 } });
  await page.waitForTimeout(250);
  let st = await editorState();
  check('画布落点生成说明文本卡片', st?.notes.length === 1, `notes=${st?.notes.length}`);
  const NOTE_TEXT = '课程内直接添加的说明：KM1 自锁';
  await page.keyboard.type(NOTE_TEXT);
  await page.waitForTimeout(200);
  st = await editorState();
  check('说明文字即时写入课程', (st?.notes[0]?.text || '').includes(NOTE_TEXT), st?.notes[0]?.text);
  check('说明文字渲染到画布',
    (await page.locator('.svg-host').innerHTML()).includes(NOTE_TEXT));

  /* ---------------------------------------------------------- 4. 线段删除（段级） */
  const beforeSegs = await page.locator('.svg-host line[data-net="w1"][data-seg]').count();
  check('课程导线渲染出可点选的段（data-seg）', beforeSegs >= 2, `count=${beforeSegs}`);
  const p0 = await segScreenPoint('w1', 0);
  check('定位到 w1 第 0 段', !!p0, JSON.stringify(p0));
  await page.mouse.click(p0.x, p0.y);
  await page.waitForTimeout(120);
  await page.evaluate(() => document.activeElement?.blur?.());
  st = await editorState();
  check('点中导线段后选中 w1 / seg=0', st?.selectedNet === 'w1' && st?.selectedSeg === 0,
    JSON.stringify({ net: st?.selectedNet, seg: st?.selectedSeg }));
  check('选中导线时说明卡片取消选中（Delete 不会误删说明）', !st?.selectedNote, String(st?.selectedNote));
  await page.keyboard.press('Delete');
  await page.waitForTimeout(200);
  st = await editorState();
  const w1 = st?.nets.find((n) => n.id === 'w1');
  check('段级删除：网络保留且只剩 1 段', !!w1 && w1.geomLen === 1, `geomLen=${w1?.geomLen}`);
  check('段级删除未误删说明文本', st?.notes.length === 1, `notes=${st?.notes.length}`);

  /* ---------------------------------------------------------- 5. 完成编辑：写回原课程、无副本 */
  await page.click('[data-op="editor-save"]');
  await page.waitForTimeout(450);
  const back = await page.evaluate(() => ({
    appBody: !!document.querySelector('.app-body'),
    shell: !!document.querySelector('.editor-shell'),
    title: document.querySelector('.course-title')?.textContent.trim() || '',
    svg: document.querySelector('.svg-host')?.innerHTML || '',
  }));
  check('完成编辑后返回课程仿真', back.appBody && !back.shell, JSON.stringify({ appBody: back.appBody, shell: back.shell }));
  check('课程标题未被改成副本', back.title === courseDoc.title, back.title);
  check('课程画布已显示新说明文本', back.svg.includes(NOTE_TEXT));

  const users = await storedUsers();
  const saved = await storedCourse();
  check('资源库中课程数量不变（没有生成副本）', users.length === 1, `users=${users.length}`);
  check('没有任何「副本」课程', !users.some((c) => String(c.title || '').includes('副本')),
    JSON.stringify(users.map((c) => c.title)));
  check('保存写回同一 id', saved?.id === COURSE_ID, String(saved?.id));
  check('课程身份保持 kind=course（未降级为作品）', saved?.kind === 'course', String(saved?.kind));
  check('课程仍保留 sourceWork 之外的课程字段（category/order）',
    saved?.category === 'drive' && saved?.order === 90, JSON.stringify({ category: saved?.category, order: saved?.order }));
  check('说明文本已落盘', (saved?.notes || []).length === 1 && String(saved.notes[0].text).includes(NOTE_TEXT),
    `notes=${(saved?.notes || []).length}`);
  check('线段删除已落盘（w1 只剩 1 段）',
    (saved?.nets || []).find((n) => n.id === 'w1')?.geometry.length === 1,
    `geomLen=${(saved?.nets || []).find((n) => n.id === 'w1')?.geometry.length}`);

  /* ---------------------------------------------------------- 6. 刷新后仍在 */
  await page.reload();
  await page.waitForTimeout(400);
  const mineItem2 = page.locator(`.mine-body[data-mine-body="drive"] .course-item[data-course-id="${COURSE_ID}"]`);
  check('刷新后课程仍在「我的电路」', (await mineItem2.count()) === 1, `count=${await mineItem2.count()}`);
  await mineItem2.click();
  await page.waitForTimeout(250);
  const persisted = await page.locator('.svg-host').innerHTML();
  check('刷新后说明文本仍渲染', persisted.includes(NOTE_TEXT));
  // 课程演示态没有编辑器专用的 line[data-net] 命中层，改看实际渲染的 wire-seg 图形数量
  const w1Rendered = await page.locator('.svg-host .wire-seg[data-net="w1"]').count();
  check('刷新后只渲染剩余的 1 段（被删段不再出现）', w1Rendered === 1, `wireSeg=${w1Rendered}`);

  /* ------------------------------------------- 7. 「课程电路」仍可编辑副本到「我的电路」 */
  const firstBuiltin = page.locator('.cat-body[data-cat-body="lighting"] > .course-item').first();
  const builtinId = await firstBuiltin.getAttribute('data-course-id');
  await firstBuiltin.click();
  await page.waitForTimeout(200);
  const builtinTb = await page.evaluate(() => ({
    edit: !!document.querySelector('[data-op="edit-course"]'),
    copy: document.querySelector('[data-op="edit-copy"]')?.textContent.trim() || '',
  }));
  check('课程电路不显示「编辑原理图」', !builtinTb.edit);
  check('课程电路仍显示「编辑副本」', builtinTb.copy.includes('编辑副本'), builtinTb.copy);
  await page.click('[data-op="edit-copy"]');
  await page.waitForTimeout(250);
  const copyState = await page.evaluate(() => ({
    title: document.querySelector('.course-title')?.textContent.trim() || '',
    panel: !!document.querySelector('.panel-root'),
  }));
  check('编辑副本进入搭建模式（标题带副本）', copyState.title.includes('副本'), copyState.title);
  check('副本仍可编辑（元件库面板可用）', copyState.panel, String(copyState.panel));

  // 保存副本 → 应作为一门新的用户电路落到「我的电路」
  await page.click('.toolbar button:has-text("保存")');
  await page.waitForTimeout(450);
  const usersAfterCopy = await storedUsers();
  const copyDoc = usersAfterCopy.find((c) => String(c.title || '').includes('副本'));
  check('编辑副本保存后生成一门新的用户电路', usersAfterCopy.length === 2, `users=${usersAfterCopy.length}`);
  check('副本 id 与原课程不同', !!copyDoc && copyDoc.id !== builtinId, `${builtinId} → ${copyDoc?.id}`);
  check('原课程电路未被改写', !usersAfterCopy.some((c) => c.id === builtinId), JSON.stringify(usersAfterCopy.map((c) => c.id)));
  const mineLighting = await page.evaluate(() =>
    [...document.querySelectorAll('.mine-body[data-mine-body="lighting"] .course-item.user .name')].map((e) => e.textContent.trim())
  );
  check('副本出现在「常用照明电路 › 我的电路」', mineLighting.some((t) => t.includes('副本')),
    JSON.stringify(mineLighting));

  /* ------------------------------------------- 8. 已加入「课程电路」的用户课程同样保留编辑副本 */
  await page.evaluate(
    ([userKey, catKey]) => {
      const users = JSON.parse(localStorage.getItem(userKey) || '[]');
      users.push({
        id: 'u-promoted', kind: 'course', builtin: false, title: '已加入课程电路的自制电路',
        category: 'drive', order: 91, difficulty: 2, duration: 15, updatedAt: Date.now(),
        canvas: { width: 2400, height: 1500 }, supply: { system: '3ph', voltage: 380 },
        devices: [], nets: [], notes: [], theory: [], steps: [], checkpoints: [],
      });
      localStorage.setItem(userKey, JSON.stringify(users));
      localStorage.setItem(catKey, JSON.stringify({ hidden: [], order: [], promoted: ['u-promoted'] }));
    },
    [USER_KEY, CATALOG_KEY]
  );
  await page.reload();
  await page.waitForTimeout(400);
  const promotedItem = page.locator('.cat-body[data-cat-body="drive"] > .course-item[data-course-id="u-promoted"]');
  check('已加入的用户课程位于「📚 课程电路」小节', (await promotedItem.count()) === 1, `count=${await promotedItem.count()}`);
  await promotedItem.click();
  await page.waitForTimeout(200);
  const promotedTb = await page.evaluate(() => ({
    edit: !!document.querySelector('[data-op="edit-course"]'),
    copy: document.querySelector('[data-op="edit-copy"]')?.textContent.trim() || '',
  }));
  check('课程电路里的用户课程不显示「编辑原理图」', !promotedTb.edit);
  check('课程电路里的用户课程仍显示「编辑副本」', promotedTb.copy.includes('编辑副本'), promotedTb.copy);
  check('「我的电路」里的原课程策略不受影响', !!(await page.locator(`.mine-body[data-mine-body="drive"] .course-item[data-course-id="${COURSE_ID}"]`).count()));

  check('运行期无未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} catch (e) {
  check('流程未异常中断', false, String(e.message || e));
} finally {
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n=== 结果：${ok} 通过 / ${results.length - ok} 失败 ===`);
  await browser.close();
  if (ok !== results.length) process.exitCode = 1;
}
