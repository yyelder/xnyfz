/**
 * 课程目录管理 —— 端到端验证（页面上端操作版）
 * ------------------------------------------------------------------
 * 1. 上移 / 下移 / 删除统一放在「打开页面上端」的目录操作条，作用于当前打开课程
 * 2. 目录改动后按新顺序重新连续标号（1..N），侧栏与顶部「第 N 节」一致
 * 3. 目录层次：一级大类 → 二级小节（课程电路 / 我的电路）→ 三级课程项
 * 4. 顺序 / 删除写入本地覆盖表并跨刷新保留，内置课程只隐藏不改动资源包
 */
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:5176';
const CATALOG_KEY = 'scj.course-catalog.v1';
const USER_KEY = 'scj.user-circuits.v1';

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

/** 读取某个大类下课程列表 / 我的电路的标题、id 与显示序号 */
const readGroup = (key) =>
  page.evaluate((k) => {
    const body = document.querySelector(`.cat-body[data-cat-body="${k}"]`);
    const mine = document.querySelector(`.mine-body[data-mine-body="${k}"]`);
    const pick = (root, sel) =>
      root
        ? [...root.querySelectorAll(sel)].map((el) => ({
            id: el.getAttribute('data-course-id'),
            name: el.querySelector('.name')?.textContent.trim() || '',
            no: el.querySelector('.no')?.textContent.trim() || '',
          }))
        : [];
    return {
      courses: pick(body, ':scope > .course-item'),
      mine: pick(mine, '.course-item.user'),
      sectionLabels: body ? body.querySelectorAll('.section-label').length : 0,
      hasMineHead: !!(body && body.querySelector('.mine-head')),
    };
  }, key);

/** 页面上端目录操作条的状态 */
const topState = () =>
  page.evaluate(() => {
    const bar = document.querySelector('[data-catalog-bar]');
    if (!bar) return null;
    const ops = {};
    for (const b of bar.querySelectorAll('[data-op]')) {
      ops[b.getAttribute('data-op')] = { disabled: !!b.disabled, text: b.textContent.trim() };
    }
    return {
      crumb: bar.querySelector('.catalog-crumb')?.textContent.trim() || '',
      index: bar.querySelector('.catalog-index')?.textContent.replace(/\s+/g, ' ').trim() || '',
      total: bar.querySelector('.catalog-total')?.textContent.trim() || '',
      ops,
    };
  });

const catalogState = () =>
  page.evaluate((key) => {
    try {
      return JSON.parse(localStorage.getItem(key) || '{}');
    } catch {
      return {};
    }
  }, CATALOG_KEY);

const userCount = () =>
  page.evaluate((key) => {
    try {
      return JSON.parse(localStorage.getItem(key) || '[]').length;
    } catch {
      return 0;
    }
  }, USER_KEY);

async function closeTutorialIfAny() {
  const card = page.locator('.tutorial-card');
  if (await card.isVisible().catch(() => false)) {
    await page.click('.tutorial-card .btn.primary');
    await card.waitFor({ state: 'hidden' });
  }
}

/** 打开指定课程（点击侧栏课程项），让顶部操作条作用于它 */
async function openById(id) {
  await page.locator(`.course-item[data-course-id="${id}"]`).first().click();
  await page.waitForTimeout(200);
}

const consecutive = (g) => g.courses.length > 0 && g.courses.every((c, i) => c.no === String(i + 1));

try {
  await page.goto(`${BASE}/?view=courses`);
  // 预置三门自制课程（2 门拖动 + 1 门照明），并清空目录覆盖表
  await page.evaluate(
    ([userKey, catKey]) => {
      localStorage.clear();
      const mk = (id, title, category, updatedAt) => ({
        id,
        kind: 'course',
        builtin: false,
        title,
        category,
        order: 90,
        difficulty: 2,
        duration: 15,
        updatedAt,
        devices: [],
        nets: [],
        supply: { system: category === 'drive' ? '3ph' : '1ph' },
      });
      localStorage.setItem(
        userKey,
        JSON.stringify([
          mk('u-drive-1', '自制正反转 A', 'drive', 3),
          mk('u-drive-2', '自制星三角 B', 'drive', 2),
          mk('u-light-1', '自制双控 C', 'lighting', 1),
        ])
      );
      localStorage.removeItem(catKey);
    },
    [USER_KEY, CATALOG_KEY]
  );
  await page.reload();
  await page.waitForSelector('.cat-head[data-cat="drive"]');
  await closeTutorialIfAny();

  /* ---------------------------------------------------------- 1. 初始状态 / 层次 */
  let g = await readGroup('drive');
  const builtinCount = g.courses.length;
  check(
    '拖动大类初始只有内置课程（用户课程都在「我的电路」）',
    builtinCount >= 5 && !g.courses.some((c) => c.id === 'u-drive-1' || c.id === 'u-drive-2') && g.mine.length === 2,
    `courses=${g.courses.length} mine=${g.mine.length}`
  );
  check('「我的电路」按更新时间倒序', g.mine[0]?.name === '自制正反转 A', JSON.stringify(g.mine.map((x) => x.name)));
  check('目录层次：一级大类 2 个', (await page.locator('.cat-head').count()) === 2, '');
  check(
    '目录层次：每个大类都有「课程电路」小节标签与「我的电路」二级分组',
    g.sectionLabels === 1 && g.hasMineHead && (await readGroup('lighting')).sectionLabels === 1,
    `drive.section=${g.sectionLabels} drive.mineHead=${g.hasMineHead}`
  );
  check('目录序号初始即连续 1..N', consecutive(g), JSON.stringify(g.courses.map((c) => c.no)));
  check(
    '侧栏课程列表不再有上移/下移/删除小按钮（已移到页面上端）',
    (await page.locator('.cat-body .course-item .move-btn, .cat-body > .course-item .del-btn').count()) === 0,
    ''
  );

  /* ---------------------------------------------------------- 2. 顶部目录操作条 */
  const firstId = g.courses[0].id;
  await openById(firstId);
  let top = await topState();
  check('打开课程后页面上端出现目录操作条', !!top, '');
  check('顶部显示所属大类', top?.crumb === '电力拖动控制', top?.crumb);
  check('顶部显示「第 1 节」', /第\s*1\s*节/.test(top?.index || ''), top?.index);
  check('顶部提供上移/下移/删除三个操作', !!(top?.ops.up && top?.ops.down && top?.ops.delete), JSON.stringify(Object.keys(top?.ops || {})));
  check('首节「上移」禁用、末位外「下移」可用', top?.ops.up.disabled === true && top?.ops.down.disabled === false,
    JSON.stringify({ up: top?.ops.up.disabled, down: top?.ops.down.disabled }));

  /* 顶部删除：二次确认 + 取消不生效 */
  await page.locator('[data-catalog-bar] [data-op="delete"]').click();
  check('顶部删除出现二次确认', (await page.locator('[data-catalog-bar] [data-op="del-confirm"]').count()) === 1, '');
  await page.locator('[data-catalog-bar] [data-op="del-cancel"]').click();
  g = await readGroup('drive');
  check('取消后课程仍在目录', g.courses.some((c) => c.id === firstId), '');

  /* ---------------------------------------------------------- 3. 加入课程电路 */
  const mineBody = page.locator('.mine-body[data-mine-body="drive"]');
  await mineBody.locator('.course-item.user', { hasText: '自制正反转 A' }).locator('.add-btn').click();
  await page.waitForTimeout(250);

  g = await readGroup('drive');
  check('加入后进入课程列表', g.courses.length === builtinCount + 1, `courses=${g.courses.length}`);
  check('加入的课程排在课程列表末尾', g.courses[g.courses.length - 1]?.name === '自制正反转 A',
    g.courses[g.courses.length - 1]?.name);
  check('加入后从「我的电路」移除', g.mine.length === 1 && !g.mine.some((x) => x.id === 'u-drive-1'),
    JSON.stringify(g.mine.map((x) => x.name)));
  check('加入后序号重新连续标号', consecutive(g), JSON.stringify(g.courses.map((c) => c.no)));

  let cat = await catalogState();
  check('覆盖表记录 promoted', (cat.promoted || []).includes('u-drive-1'), JSON.stringify(cat.promoted));

  /* ---------------------------------------------------------- 4. 顶部上移 */
  await openById('u-drive-1');
  top = await topState();
  check('打开末节时顶部显示「第 N 节」且上移可用、下移禁用',
    new RegExp(`第\\s*${builtinCount + 1}\\s*节`).test(top?.index || '') &&
      top?.ops.up.disabled === false && top?.ops.down.disabled === true,
    `${top?.index} up=${top?.ops.up.disabled} down=${top?.ops.down.disabled}`);

  await page.locator('[data-catalog-bar] [data-op="up"]').click();
  await page.waitForTimeout(220);

  g = await readGroup('drive');
  const pos = g.courses.findIndex((c) => c.id === 'u-drive-1');
  check('顶部上移一位（末尾 → 倒数第二）', pos === g.courses.length - 2, `pos=${pos}/${g.courses.length}`);
  check('上移后序号仍连续 1..N', consecutive(g), JSON.stringify(g.courses.map((c) => c.no)));
  top = await topState();
  check('上移后顶部「第 N 节」同步更新', new RegExp(`第\\s*${pos + 1}\\s*节`).test(top?.index || ''), top?.index);
  cat = await catalogState();
  check('覆盖表 order 已更新', (cat.order || []).indexOf('u-drive-1') === g.courses.length - 2,
    JSON.stringify(cat.order));

  /* ---------------------------------------------------------- 5. 刷新后保持 */
  const orderBeforeReload = g.courses.map((c) => c.id);
  await page.reload();
  await page.waitForSelector('.cat-head[data-cat="drive"]');
  await closeTutorialIfAny();
  g = await readGroup('drive');
  check('刷新后课程顺序保持', JSON.stringify(g.courses.map((c) => c.id)) === JSON.stringify(orderBeforeReload),
    JSON.stringify(g.courses.map((c) => c.id)));
  check('刷新后序号依旧连续（不跳号）', consecutive(g), JSON.stringify(g.courses.map((c) => c.no)));

  /* ---------------------------------------------------------- 6. 顶部删除内置课程 */
  const firstBuiltin = g.courses.find((c) => c.id !== 'u-drive-1');
  const usersBefore = await userCount();
  await openById(firstBuiltin.id);
  await page.locator('[data-catalog-bar] [data-op="delete"]').click();
  await page.locator('[data-catalog-bar] [data-op="del-confirm"]').click();
  await page.waitForTimeout(250);

  g = await readGroup('drive');
  check('内置课程已从目录移除', !g.courses.some((c) => c.id === firstBuiltin.id), `剩余 ${g.courses.length}`);
  check('删除后序号重新连续标号', consecutive(g), JSON.stringify(g.courses.map((c) => c.no)));
  cat = await catalogState();
  check('内置课程记入 hidden（未改只读资源包）', (cat.hidden || []).includes(firstBuiltin.id), JSON.stringify(cat.hidden));
  check('删除内置课程不影响用户课程数据', (await userCount()) === usersBefore, `users=${usersBefore}`);

  /* ---------------------------------------------------------- 7. 顶部删除已加入的用户课程 */
  await openById('u-drive-1');
  await page.locator('[data-catalog-bar] [data-op="delete"]').click();
  await page.locator('[data-catalog-bar] [data-op="del-confirm"]').click();
  await page.waitForTimeout(300);

  g = await readGroup('drive');
  check('用户课程已从课程列表删除', !g.courses.some((c) => c.id === 'u-drive-1'), `courses=${g.courses.length}`);
  check('删除用户课程后序号仍连续', consecutive(g), JSON.stringify(g.courses.map((c) => c.no)));
  check('用户课程已从资源库真删', (await userCount()) === usersBefore - 1, `users=${await userCount()}`);
  cat = await catalogState();
  check('promoted / order 中不再残留该课程',
    !(cat.promoted || []).includes('u-drive-1') && !(cat.order || []).includes('u-drive-1'),
    JSON.stringify({ promoted: cat.promoted, order: cat.order }));

  /* ---------------------------------------------------------- 8. 另一大类不受影响 */
  const lg = await readGroup('lighting');
  check('照明大类的「我的电路」仍在', lg.mine.length === 1 && lg.mine[0].id === 'u-light-1', JSON.stringify(lg.mine));
  check('照明大类序号也连续', consecutive(lg), JSON.stringify(lg.courses.map((c) => c.no)));

  check('运行期无未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} catch (e) {
  check('流程未异常中断', false, String(e.message || e));
} finally {
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n=== 结果：${ok} 通过 / ${results.length - ok} 失败 ===`);
  await browser.close();
  if (ok !== results.length) process.exitCode = 1;
}
