/**
 * 元件库完整性专项单测
 * ------------------------------------------------------------------
 * 1. 用户清单 14 类在本库中均有元件覆盖
 * 2. 每个元件的 symbol 都能绘制（不出现「?」占位），引脚坐标合法且 id 唯一
 * 3. poles / polesNO / polesNC 引用的引脚都存在
 * 4. 复合按钮（sb_comp）：按下 → 常开闭合、常闭断开
 * 5. 复合行程开关（sq_comp）：未压下 → 常闭通；压下 → 常开通
 * 6. 全部元件逐个参与引擎求解不抛异常
 */
import fs from 'node:fs';
import { drawSymbol } from '../shared/render/symbols.js';
import { SimulationEngine } from '../shared/engine/index.js';

const pack = JSON.parse(fs.readFileSync(new URL('../resources/packs/device-types.json', import.meta.url), 'utf8'));
const types = pack.types;

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (ok) pass += 1;
  else fail += 1;
};

const OK_GROUPS = new Set([
  'switch', 'limit', 'button', 'contactor', 'thermal', 'timer', 'relay',
  'fuse', 'motor', 'transformer', 'signal', 'lighting', 'socket', 'terminal', 'other',
]);
const OK_ROLES = new Set(['contact', 'button', 'switch', 'breaker', 'fuse', 'thermal', 'passive', 'load', 'motor', 'decor', 'terminal']);

/* ---------------------------------------------------------- 1. 14 类覆盖 */
console.log('\n[1] 用户清单 14 类覆盖');
const REQUIRED = [
  ['switch', '常用开关'],
  ['limit', '行程开关'],
  ['button', '按钮'],
  ['contactor', '接触器'],
  ['thermal', '热继电器'],
  ['timer', '时间继电器'],
  ['relay', '中间继电器'],
  ['fuse', '熔断器'],
  ['motor', '常用电动机'],
  ['transformer', '变压器'],
  ['signal', '信号灯'],
  ['lighting', '照明灯'],
  ['socket', '插头和插座'],
  ['terminal', '接线端子'],
];
for (const [g, name] of REQUIRED) {
  const list = types.filter((t) => t.group === g);
  check(`${name}（${g}）`, list.length > 0, `${list.length} 个：${list.map((t) => t.short).join('/')}`);
}

/* ---------------------------------------------------------- 2. 符号 / 引脚 */
console.log('\n[2] 符号可绘制与引脚合法性');
const badSymbol = [];
const badPin = [];
for (const t of types) {
  const svg = drawSymbol(t, { closed: true, energized: true, lit: true, running: true, pressed: true, state: 'closed' });
  if (!svg || svg.includes('stroke-dasharray="3 3"') || svg.length < 40) badSymbol.push(`${t.id}:${t.symbol}`);
  const pins = t.pins || [];
  if (!pins.length) badPin.push(`${t.id}:无引脚`);
  const ids = new Set();
  for (const p of pins) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) badPin.push(`${t.id}.${p.id}:坐标非法`);
    if (!p.dir) badPin.push(`${t.id}.${p.id}:缺 dir`);
    if (ids.has(p.id)) badPin.push(`${t.id}.${p.id}:引脚 id 重复`);
    ids.add(p.id);
  }
}
check('全部 symbol 均可绘制（无缺符号占位）', badSymbol.length === 0, badSymbol.join(', '));
check('全部元件引脚坐标合法且 id 唯一', badPin.length === 0, badPin.join(', '));

/* ---------------------------------------------------------- 3. 分组 / 角色 / 极对引用 */
console.log('\n[3] 分组、角色与极对引用');
const badGroup = types.filter((t) => !OK_GROUPS.has(t.group)).map((t) => t.id);
const badRole = types.filter((t) => !OK_ROLES.has(t.role)).map((t) => `${t.id}:${t.role}`);
check('全部元件 group 属于 15 个合法分组', badGroup.length === 0, badGroup.join(', '));
check('全部元件 role 合法', badRole.length === 0, badRole.join(', '));

const badPole = [];
for (const t of types) {
  const ids = new Set((t.pins || []).map((p) => p.id));
  const all = [...(t.poles || []), ...(t.polesNO || []), ...(t.polesNC || []), ...(t.polesA || []), ...(t.polesB || [])];
  for (const pair of all) {
    for (const pid of pair) if (!ids.has(pid)) badPole.push(`${t.id}:${pid}`);
  }
}
check('poles / polesNO / polesNC 引用的引脚均存在', badPole.length === 0, badPole.join(', '));

/* ---------------------------------------------------------- 4. 复合按钮 */
console.log('\n[4] 复合按钮（sb_comp）仿真');
{
  const dev = { id: 'SBX', type: 'sb_comp', label: 'SB9', props: {} };
  const engine = new SimulationEngine({ deviceTypes: types, circuit: { supply: { system: '1ph', voltage: 220 }, devices: [dev], nets: [] } });
  const type = types.find((t) => t.id === 'sb_comp');
  const has = (pairs, pair) => pairs.some((p) => p[0] === pair[0] && p[1] === pair[1]);

  let pairs = engine.conductionPairs(dev, type, engine.groups, engine.timerDone || {});
  check('未按下：常闭 11-12 导通', has(pairs, ['11', '12']), JSON.stringify(pairs));
  check('未按下：常开 23-24 断开', !has(pairs, ['23', '24']), JSON.stringify(pairs));

  engine.press('SBX', true);
  pairs = engine.conductionPairs(dev, type, engine.groups, engine.timerDone || {});
  check('按下：常闭 11-12 先断开', !has(pairs, ['11', '12']), JSON.stringify(pairs));
  check('按下：常开 23-24 闭合', has(pairs, ['23', '24']), JSON.stringify(pairs));
}

/* ---------------------------------------------------------- 5. 复合行程开关 */
console.log('\n[5] 复合行程开关（sq_comp）仿真');
{
  const dev = { id: 'SQX', type: 'sq_comp', label: 'SQ9', props: {} };
  const engine = new SimulationEngine({ deviceTypes: types, circuit: { supply: { system: '1ph', voltage: 220 }, devices: [dev], nets: [] } });
  const type = types.find((t) => t.id === 'sq_comp');
  const has = (pairs, pair) => pairs.some((p) => p[0] === pair[0] && p[1] === pair[1]);

  let pairs = engine.conductionPairs(dev, type, engine.groups, engine.timerDone || {});
  check('未压下：常闭 11-12 导通', has(pairs, ['11', '12']), JSON.stringify(pairs));
  check('未压下：常开 23-24 断开', !has(pairs, ['23', '24']), JSON.stringify(pairs));

  engine.setState('SQX', 'closed');
  pairs = engine.conductionPairs(dev, type, engine.groups, engine.timerDone || {});
  check('压下：常开 23-24 闭合', has(pairs, ['23', '24']), JSON.stringify(pairs));
  check('压下：常闭 11-12 断开', !has(pairs, ['11', '12']), JSON.stringify(pairs));
}

/* ---------------------------------------------------------- 6. 全量求解 */
console.log('\n[6] 全部元件参与引擎求解');
{
  const devices = types.map((t) => ({ id: `D_${t.id}`, type: t.id, label: (t.short || 'X') + '1', props: {} }));
  const nets = types.flatMap((t) =>
    (t.pins || []).map((p, i) => ({ id: `n_${t.id}_${p.id}`, phase: i === 0 ? 'L' : undefined, pins: [[`D_${t.id}`, p.id]] }))
  );
  let err = '';
  try {
    const engine = new SimulationEngine({ deviceTypes: types, circuit: { supply: { system: '3ph', voltage: 380 }, devices, nets } });
    engine.compute(Date.now());
  } catch (e) {
    err = String(e.message || e);
  }
  check(`${types.length} 个元件 + ${nets.length} 个网络求解不抛异常`, err === '', err);
}

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
if (fail) process.exitCode = 1;
