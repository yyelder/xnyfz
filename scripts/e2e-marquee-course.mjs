/**
 * 框选多选 + 整体移动 + 加入课程仿真 —— 端到端验证
 * ------------------------------------------------------------------
 * 1. 新建工业电路：骨架元件靠画布左侧（x < 900），画布 2400×1500
 * 2. 空白处按住拖动 → 框选多个元件（selectedIds 多个、全部虚线高亮）
 * 3. 拖动被框选元件 → 整体移动（一次提交，坐标同步、相对间距不变）
 * 4. Delete → 删除全部被框选元件；Ctrl+Z 撤销可整体恢复
 * 5. 课程演示信息编辑（摘要/原理/步骤/要点，每行一条）
 * 6. 「加入课程仿真」→ 跳转课程视图，侧栏出现该课程，三要素可编辑并保存
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

const editorState = () =>
  page.evaluate(() => {
    const s = document.querySelector('.editor-shell')?.__vueParentComponent?.setupState;
    if (!s) return null;
    return {
      selectedIds: s.selectedIds,
      selected: s.selected,
      devices: (s.draft?.devices || []).map((d) => ({ id: d.id, x: d.x, y: d.y, label: d.label })),
      canvas: s.draft?.canvas,
      theory: s.draft?.theory || [],
      steps: s.draft?.steps || [],
      checkpoints: s.draft?.checkpoints || [],
      summary: s.draft?.summary || '',
    };
  });

/** 图纸坐标 → 屏幕坐标（svg-host 的 CTM） */
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

try {
  await page.goto(`${BASE}/?view=workbench`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.wb-entry');
  await page.click('.wb-entry:has-text("工业电路仿真")');
  await page.waitForSelector('.editor-toolbar');
  await page.waitForSelector('.svg-host svg');
  await closeTutorialIfAny();

  /* 1. 骨架靠左 + 画布尺寸 */
  let st = await editorState();
  const maxX = Math.max(...st.devices.map((d) => d.x));
  check('骨架元件默认靠画布左侧', maxX < 900, `最右元件 x=${maxX}`);
  check('画布已扩大到 2400×1500', st.canvas?.width === 2400 && st.canvas?.height === 1500, JSON.stringify(st.canvas));

  /* 2. 空白处按住左键拖动框选：圈住 KM1(220,470) 与 SB2(670,470) 一带 */
  const a = await toScreen({ x: 150, y: 300 });
  const b = await toScreen({ x: 720, y: 520 });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 });
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  st = await editorState();
  check('框选提交：selectedIds 命中多个元件', (st.selectedIds || []).length >= 2, JSON.stringify(st.selectedIds));
  const highlighted = await page.evaluate(() => {
    // 选中元件渲染虚线选中框
    const svg = document.querySelector('.svg-host svg')?.innerHTML || '';
    return (svg.match(/stroke-dasharray="5 4"/g) || []).length;
  });
  check('被框选元件全部显示虚线选中框', highlighted >= (st.selectedIds || []).length, `虚线框 ${highlighted} 个`);

  const panelText = await page.locator('.editor-side').innerText();
  check('右侧出现「多选」面板与元件编号清单', /多选（\d+ 个元件）/.test(panelText) && panelText.includes('KM1'));

  /* 3. 拖动其中一个被框选元件 → 整体移动 */
  const before = st.devices.filter((d) => st.selectedIds.includes(d.id));
  const anchor = before[0]; // 拖动第一个选中元件
  const p0 = await toScreen({ x: anchor.x, y: anchor.y });
  const target = { x: anchor.x + 200, y: anchor.y + 40 };
  const p1 = await toScreen(target);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  await page.mouse.move((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, { steps: 8 });
  await page.mouse.move(p1.x, p1.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);

  st = await editorState();
  const after = st.devices.filter((d) => st.selectedIds.includes(d.id));
  const keptSpacing = after.every((d, i) => Math.abs(d.x - before[i].x - 200) <= 1 && Math.abs(d.y - before[i].y - 40) <= 1);
  check('整体移动：所有被框选元件同步平移 (+200,+40)', keptSpacing, JSON.stringify(after.map((d) => [d.x, d.y])));

  /* 4. Delete → 全部删除；Ctrl+Z → 一次性整体恢复 */
  const totalBefore = st.devices.length;
  const selCount = (st.selectedIds || []).length;
  await page.keyboard.press('Delete');
  await page.waitForTimeout(200);
  st = await editorState();
  check('Delete 删除全部被框选元件', st.devices.length === totalBefore - selCount, `剩余 ${st.devices.length}`);
  check('删除后选择已清空', (st.selectedIds || []).length === 0, JSON.stringify(st.selectedIds));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  st = await editorState();
  check('Ctrl+Z 一次撤销即整体恢复', st.devices.length === totalBefore, `恢复到 ${st.devices.length}`);

  /* 5. 课程演示信息编辑 */
  await page.fill('.course-editor input', '接触器自锁正转控制线路');
  await page.fill('.course-editor textarea >> nth=0', '按下 SB2，KM1 线圈得电\n松开 SB2 后 KM1 自锁保持吸合');
  await page.fill('.course-editor textarea >> nth=1', '1. 合上电源\n2. 按下 SB2');
  await page.fill('.course-editor textarea >> nth=2', '能说明自锁原理');
  await page.locator('.course-editor textarea >> nth=2').blur();
  await page.waitForTimeout(150);
  st = await editorState();
  check('演示摘要写入 draft', st.summary === '接触器自锁正转控制线路', st.summary);
  check('原理说明按行拆分（2 段）', st.theory.length === 2 && st.theory[0].includes('SB2'), JSON.stringify(st.theory));
  check('操作步骤按行拆分（2 步）', st.steps.length === 2, JSON.stringify(st.steps));
  check('考核要点按行拆分（1 条）', st.checkpoints.length === 1, JSON.stringify(st.checkpoints));

  /* 6. 加入课程仿真 → 跳转课程视图并可编辑三要素 */
  await page.click('.editor-toolbar button:has-text("加入课程仿真")');
  await page.waitForSelector('.panel-tabs', { timeout: 8000 });
  await page.waitForTimeout(400);
  const onCourses = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.view-tab')].find((t) => t.textContent.includes('课程仿真'));
    const app = document.querySelector('.app-shell')?.__vueParentComponent?.setupState;
    return {
      tabActive: !!tabs?.className.includes('active'),
      title: document.querySelector('.course-title')?.textContent || '',
      userCourses: (app?.bundle?.circuits || []).filter((c) => c.kind !== 'work' && c.sourceWorkId).length,
    };
  });
  check('发布后自动跳到课程仿真视图', onCourses.tabActive && onCourses.title.includes('接触器自锁'), onCourses.title);
  check('课程库中出现发布的新课程', onCourses.userCourses >= 1, `自建课程 ${onCourses.userCourses} 门`);

  const sidebarText = await page.locator('.sidebar').innerText();
  check('课程目录（我的电路）列出该课程', sidebarText.includes('接触器自锁'), '');

  const theoryText = await page.locator('.panel-body .theory').innerText();
  check('原理说明在演示页正确显示', theoryText.includes('KM1 线圈得电'), '');

  // 课程端编辑：改原理说明并保存
  const editBtn = page.locator('button:has-text("编辑演示信息")');
  check('演示页显示「编辑演示信息」按钮（用户课程可编辑）', await editBtn.isVisible());
  await editBtn.click();
  const ta = page.locator('.course-editor textarea >> nth=0');
  await ta.fill('按下 SB2，KM1 线圈得电\n自锁触点闭合保持\n补充：FR 过载保护动作时切断控制回路');
  await page.locator('.course-edit-bar button:has-text("保存")').click();
  await page.waitForTimeout(300);
  const saved = await page.evaluate(() => {
    const app = document.querySelector('.app-shell')?.__vueParentComponent?.setupState;
    const c = (app?.bundle?.circuits || []).find((x) => x.kind !== 'work' && x.sourceWorkId);
    return { theory: c?.theory || [], persisted: JSON.parse(localStorage.getItem('scj.user-circuits.v1') || '[]').length };
  });
  check('课程端编辑原理说明并保存成功', saved.theory.length === 3 && saved.theory[2].includes('FR'), JSON.stringify(saved.theory));
  check('已持久化到本地资源库', saved.persisted >= 2, `本地存储电路 ${saved.persisted} 条`);

  check('运行期无 JS 报错', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (err) {
  check('脚本执行', false, String(err.message || err));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n=== 结果：${results.length - failed.length} 通过 / ${failed.length} 失败 ===`);
process.exit(failed.length ? 1 : 0);
