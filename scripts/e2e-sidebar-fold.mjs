/**
 * 侧栏两大分类可折叠 + 各自的「我的电路」 + 按类型归类发布 + 删除 —— 端到端验证
 * ------------------------------------------------------------------
 * 1. 课程目录只有「常用照明电路 / 电力拖动控制」两大类，每类下有各自「我的电路」子分组
 * 2. 一级分类、二级「我的电路」均可点击折叠/展开
 * 3. 内置课程分属两个大类（照明 5 / 拖动 5），初始「我的电路」为空
 * 4. 工作台发布工业电路 → 只进入「电力拖动控制 › 我的电路」，且自动展开该分组
 * 5. 工作台发布家庭电路 → 只进入「常用照明电路 › 我的电路」
 * 6. 「我的电路」内容可删除（二次确认），删除后从侧栏与资源库移除，内置课程与其它分组不受影响
 * 7. 折叠状态在「课程仿真 ⇄ 仿真工作台」切换后仍保留
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
page.on('dialog', (d) => d.accept());

async function closeTutorialIfAny() {
  const card = page.locator('.tutorial-card');
  if (await card.isVisible().catch(() => false)) {
    await page.click('.tutorial-card .btn.primary');
    await card.waitFor({ state: 'hidden' });
  }
}

/** 读取侧栏 DOM 结构（可见性用 offsetParent 判断，v-show 会置 display:none） */
const sidebarState = () =>
  page.evaluate(() => {
    const q = (s, root = document) => root.querySelector(s);
    const qa = (s, root = document) => [...root.querySelectorAll(s)];
    const visible = (el) => !!el && el.offsetParent !== null;
    const group = (key) => {
      const body = q(`.cat-body[data-cat-body="${key}"]`);
      const mineBody = q(`.mine-body[data-mine-body="${key}"]`);
      return {
        key,
        headCollapsed: q(`.cat-head[data-cat="${key}"]`)?.classList.contains('collapsed'),
        bodyVisible: visible(body),
        mineCollapsed: q(`.mine-head[data-mine="${key}"]`)?.classList.contains('collapsed'),
        mineVisible: visible(mineBody),
        builtinTitles: body ? qa(':scope > .course-item .name', body).map((e) => e.textContent.trim()) : [],
        mineTitles: mineBody ? qa('.course-item.user .name', mineBody).map((e) => e.textContent.trim()) : [],
        mineIds: mineBody ? qa('.course-item.user', mineBody).map((e) => e.getAttribute('data-course-id')) : [],
      };
    };
    return {
      catHeads: qa('.cat-head').length,
      mineHeads: qa('.mine-head').length,
      topCats: qa('.sidebar .cat').map((e) => e.textContent.trim()),
      lighting: group('lighting'),
      drive: group('drive'),
      delBtns: qa('.mine-body .del-btn').length,
    };
  });

/** 工作台：新建指定类型的作品，填演示摘要，加入课程仿真 */
async function publishWork(entryText, summary) {
  await page.click(`.view-tab:has-text("仿真工作台")`);
  await page.waitForSelector('.wb-entry');
  await page.click(`.wb-entry:has-text("${entryText}")`);
  await page.waitForSelector('.editor-toolbar');
  await closeTutorialIfAny();
  await page.fill('.course-editor input', summary);
  await page.locator('.course-editor input').blur();
  await page.click('.editor-toolbar button:has-text("加入课程仿真")');
  await page.waitForSelector('.sidebar .cat-head', { timeout: 8000 });
  await page.waitForTimeout(350);
}

try {
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.sidebar .cat-head');

  /* 1. 结构：两大类 + 两个「我的电路」子分组，且不再有顶层独立的「我的电路」分类 */
  let s = await sidebarState();
  check('只有「常用照明电路 / 电力拖动控制」两个可折叠大类', s.catHeads === 2, `cat-head=${s.catHeads}`);
  check('每个大类各有一个「我的电路」子分组', s.mineHeads === 2, `mine-head=${s.mineHeads}`);
  check('顶层不再有独立的「我的电路」分类', !s.topCats.some((t) => t.includes('我的电路')), JSON.stringify(s.topCats));
  check('内置课程分属两个大类（照明 5 / 拖动 5）',
    s.lighting.builtinTitles.length === 5 && s.drive.builtinTitles.length === 5,
    `照明 ${s.lighting.builtinTitles.length} / 拖动 ${s.drive.builtinTitles.length}`);
  check('初始两个「我的电路」均为空', s.lighting.mineTitles.length === 0 && s.drive.mineTitles.length === 0, '');

  /* 2. 折叠：一级分类 */
  await page.click('.cat-head[data-cat="lighting"]');
  s = await sidebarState();
  check('点击大类标题可折叠（内容隐藏）', s.lighting.headCollapsed === true && s.lighting.bodyVisible === false,
    `collapsed=${s.lighting.headCollapsed} visible=${s.lighting.bodyVisible}`);
  await page.click('.cat-head[data-cat="lighting"]');
  s = await sidebarState();
  check('再次点击展开大类', s.lighting.headCollapsed === false && s.lighting.bodyVisible === true, '');

  /* 2b. 折叠：二级「我的电路」子分组 */
  await page.click('.mine-head[data-mine="lighting"]');
  s = await sidebarState();
  check('「我的电路」子分组可折叠', s.lighting.mineCollapsed === true && s.lighting.mineVisible === false, '');
  await page.click('.mine-head[data-mine="lighting"]');
  s = await sidebarState();
  check('「我的电路」子分组可展开', s.lighting.mineCollapsed === false && s.lighting.mineVisible === true, '');

  /* 3. 发布工业电路 → 只进电力拖动控制的「我的电路」 */
  await publishWork('工业电路仿真', '接触器自锁正转演示');
  s = await sidebarState();
  check('工业电路进入「电力拖动控制 › 我的电路」', s.drive.mineTitles.includes('接触器自锁正转演示'),
    JSON.stringify(s.drive.mineTitles));
  check('工业电路未混入「常用照明电路 › 我的电路」', !s.lighting.mineTitles.includes('接触器自锁正转演示'),
    JSON.stringify(s.lighting.mineTitles));
  check('发布后自动展开电力拖动控制及其「我的电路」',
    s.drive.headCollapsed === false && s.drive.bodyVisible === true && s.drive.mineCollapsed === false && s.drive.mineVisible === true, '');
  check('发布课程带删除按钮', s.delBtns >= 1, `del-btn=${s.delBtns}`);

  /* 4. 发布家庭电路 → 只进常用照明电路的「我的电路」 */
  await publishWork('家庭电路仿真', '双控照明演示');
  s = await sidebarState();
  check('家庭电路进入「常用照明电路 › 我的电路」', s.lighting.mineTitles.includes('双控照明演示'),
    JSON.stringify(s.lighting.mineTitles));
  check('家庭电路未混入「电力拖动控制 › 我的电路」', !s.drive.mineTitles.includes('双控照明演示'),
    JSON.stringify(s.drive.mineTitles));
  check('发布后自动展开常用照明电路及其「我的电路」',
    s.lighting.headCollapsed === false && s.lighting.mineCollapsed === false, '');
  check('两大类的「我的电路」各 1 门课程', s.lighting.mineTitles.length === 1 && s.drive.mineTitles.length === 1, '');

  /* 5. 删除「我的电路」内容：二次确认 + 取消 + 确认 */
  const driveCard = page.locator('.mine-body[data-mine-body="drive"] .course-item.user:has-text("接触器自锁正转演示")');
  const driveId = await driveCard.getAttribute('data-course-id');
  await driveCard.locator('.del-btn').click();
  check('点击删除后出现二次确认', await driveCard.locator('.del-confirm').isVisible(), '');
  await driveCard.locator('.del-cancel').click();
  check('取消后课程仍在', await driveCard.locator('.del-btn').isVisible(), '');
  await driveCard.locator('.del-btn').click();
  await driveCard.locator('.del-confirm').click();
  await page.waitForTimeout(300);
  s = await sidebarState();
  check('确认后课程从「我的电路」移除', !s.drive.mineTitles.includes('接触器自锁正转演示'),
    JSON.stringify(s.drive.mineTitles));
  check('删除不影响另一分组的「我的电路」', s.lighting.mineTitles.includes('双控照明演示'), '');
  check('删除不影响内置课程', s.lighting.builtinTitles.length === 5 && s.drive.builtinTitles.length === 5, '');

  const persisted = await page.evaluate((id) => {
    const app = document.querySelector('.app-shell')?.__vueParentComponent?.setupState;
    const ls = JSON.parse(localStorage.getItem('scj.user-circuits.v1') || '[]');
    const all = app?.bundle?.circuits || [];
    return {
      stillInBundle: all.some((c) => c.id === id),
      stillInStorage: ls.some((c) => c.id === id),
      workKept: all.some((c) => c.kind === 'work' && c.sourceWorkId === undefined), // 工作台作品仍在
    };
  }, driveId);
  check('课程已从资源库（bundle + localStorage）删除', !persisted.stillInBundle && !persisted.stillInStorage, JSON.stringify(persisted));

  /* 6. 折叠状态跨视图保留 */
  await page.click('.cat-head[data-cat="drive"]'); // 折叠拖动
  let before = await sidebarState();
  await page.click('.view-tab:has-text("仿真工作台")');
  await page.waitForSelector('.wb-entry');
  await page.click('.view-tab:has-text("课程仿真")');
  await page.waitForSelector('.sidebar .cat-head');
  s = await sidebarState();
  check('切换视图后折叠状态仍保留', before.drive.headCollapsed === true && s.drive.headCollapsed === true, '');
  await page.click('.cat-head[data-cat="drive"]'); // 恢复

  check('运行期无 JS 报错', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (err) {
  check('脚本执行', false, String(err.message || err));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n=== 结果：${results.length - failed.length} 通过 / ${failed.length} 失败 ===`);
process.exit(failed.length ? 1 : 0);
