/**
 * 仿真引擎验收脚本
 * 1) 校验资源包结构与引脚引用
 * 2) 对 8 个课程逐条跑关键操作序列，断言电气状态
 * 3) 导出每个电路的 SVG 预览图（用于视觉检查/打印）
 *
 * 运行：node scripts/test-engine.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimulationEngine } from '../shared/engine/index.js';
import { renderCircuit } from '../shared/render/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PACK_DIR = path.join(ROOT, 'resources', 'packs');
const PREVIEW_DIR = path.join(ROOT, 'preview');

const devicePack = JSON.parse(fs.readFileSync(path.join(PACK_DIR, 'device-types.json'), 'utf8'));
const deviceTypes = devicePack.types;
const typeMap = new Map(deviceTypes.map((t) => [t.id, t]));

const circuitFiles = fs
  .readdirSync(path.join(PACK_DIR, 'circuits'))
  .filter((f) => f.endsWith('.json'))
  .sort();
const circuits = circuitFiles.map((f) => JSON.parse(fs.readFileSync(path.join(PACK_DIR, 'circuits', f), 'utf8')));

let pass = 0;
let fail = 0;
const failures = [];

function check(label, cond, extra = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    failures.push(`${label}${extra ? ` — ${extra}` : ''}`);
    console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
  }
}

/* ------------------------------------------------------------ 结构校验 */
console.log('\n=== 资源包结构校验 ===');
for (const c of circuits) {
  const ids = new Set();
  let ok = true;
  for (const d of c.devices) {
    if (ids.has(d.id)) {
      ok = false;
      console.log(`  ! ${c.id}: 设备 id 重复 ${d.id}`);
    }
    ids.add(d.id);
    const t = typeMap.get(d.type);
    if (!t) {
      ok = false;
      console.log(`  ! ${c.id}: 未知元件类型 ${d.type}`);
      continue;
    }
    // 所有引脚必须被网络引用（否则为悬空脚）
    for (const pin of t.pins) {
      const used = c.nets.some((net) => net.pins.some(([dd, pp]) => dd === d.id && pp === pin.id));
      if (!used) console.log(`  ! ${c.id}: ${d.id}.${pin.id} 未接线`);
    }
  }
  for (const net of c.nets) {
    for (const [dd, pp] of net.pins) {
      const dev = c.devices.find((x) => x.id === dd);
      if (!dev) {
        ok = false;
        console.log(`  ! ${c.id}: 网络 ${net.id} 引用了不存在的设备 ${dd}`);
        continue;
      }
      const t = typeMap.get(dev.type);
      if (!t.pins.some((p) => p.id === pp)) {
        ok = false;
        console.log(`  ! ${c.id}: 网络 ${net.id} 引用了不存在的引脚 ${dd}.${pp}`);
      }
    }
  }
  check(`${c.title}（${c.devices.length} 元件 / ${c.nets.length} 网络）结构完整`, ok);
}

/* ------------------------------------------------------------ 仿真场景 */
const now = 1_700_000_000_000;
const byId = Object.fromEntries(circuits.map((c) => [c.id, c]));

function engineOf(id) {
  const circuit = byId[id];
  if (!circuit) throw new Error(`找不到电路 ${id}`);
  return new SimulationEngine({ circuit, deviceTypes });
}

const dev = (snap, id) => snap.devices[id] || {};
const motorOf = (snap) => snap.motor || {};

console.log('\n=== 课程 1：单控照明 ===');
{
  const e = engineOf('lighting-single-switch');
  let s = e.compute(now);
  check('初始状态：灯不亮', !dev(s, 'EL1').lit && !dev(s, 'EL2').lit);
  check('初始状态：开关下端无电位', s.nets['n-qf'].live === false);

  e.setState('QF1', 'closed');
  s = e.compute(now);
  check('合上 QF1 后 L 母线带电', s.nets.L.live === true);
  check('合上 QF1 后灯仍灭', !dev(s, 'EL1').lit);

  e.setState('SA1', 'closed');
  s = e.compute(now);
  check('合上 SA1 → EL1 点亮', dev(s, 'EL1').lit === true);
  check('SA2 未合 → EL2 不亮', dev(s, 'EL2').lit === false);

  e.setState('SA2', 'closed');
  s = e.compute(now);
  check('两路同时点亮', dev(s, 'EL1').lit && dev(s, 'EL2').lit);

  e.setState('QF1', 'open');
  s = e.compute(now);
  check('断开 QF1 → 全回路失电', !dev(s, 'EL1').lit && !dev(s, 'EL2').lit);
}

console.log('\n=== 课程 2：双控照明 ===');
{
  const e = engineOf('lighting-two-way');
  e.setState('QF1', 'closed');
  let s = e.compute(now);
  check('两开关同位 → 灯亮', dev(s, 'EL1').lit === true);

  e.toggle('SA1');
  s = e.compute(now);
  check('SA1 动作 → 灯灭', dev(s, 'EL1').lit === false);

  e.toggle('SA2');
  s = e.compute(now);
  check('SA2 动作 → 灯又亮', dev(s, 'EL1').lit === true);

  e.toggle('SA1');
  s = e.compute(now);
  check('再次 SA1 动作 → 灯灭', dev(s, 'EL1').lit === false);
}

console.log('\n=== 课程 3：荧光灯 ===');
{
  const e = engineOf('lighting-fluorescent');
  e.setState('QF1', 'closed');
  e.setState('SA1', 'closed');
  const s = e.compute(now);
  check('合闸后灯管点亮', dev(s, 'EL1').lit === true);
  check('镇流器与灯管形成串联回路，无短路告警', s.shorts.length === 0);
}

console.log('\n=== 课程 4：照明配电箱 ===');
{
  const e = engineOf('lighting-distribution-box');
  e.setState('QF0', 'closed');
  e.setState('QF1', 'closed');
  let s = e.compute(now);
  check('总开关+漏保合闸后，支路无电（支路断路器未合）', !dev(s, 'EL1').lit);

  e.setState('QF2', 'closed');
  s = e.compute(now);
  check('QF2 合闸 → EL1 点亮', dev(s, 'EL1').lit === true);
  check('XS1 支路未合 → 插座不带电', dev(s, 'XS1').energized === false);

  e.injectFault({ id: 'short-el1', type: 'short', between: ['n-bus-L', 'N'] });
  s = e.compute(now);
  check('注入 L-N 短路 → 检出短路', s.shorts.length > 0);
  check('保护动作：断路器脱扣', s.protection.tripped.length > 0);
  s = e.compute(now);
  check('脱扣后短路消失（故障被切除）', s.shorts.length === 0);
  check('脱扣后灯熄灭', dev(s, 'EL1').lit === false);
}

console.log('\n=== 课程 5：点动控制 ===');
{
  const e = engineOf('motor-jog');
  e.setState('QF1', 'closed');
  e.setState('QF2', 'closed');
  let s = e.compute(now);
  check('合闸后电机不转', motorOf(s).running === false);

  e.press('SB2', true);
  s = e.compute(now);
  check('按住 SB2 → KM1 线圈得电', dev(s, 'KM1coil').energized === true);
  check('主触点闭合', dev(s, 'KM1').closed === true);
  check('电动机运转（正转）', motorOf(s).running === true && motorOf(s).direction === 'forward');
  check('三相齐全，无缺相', motorOf(s).phaseLoss === false);

  e.press('SB2', false);
  s = e.compute(now);
  check('松开 SB2 → 线圈失电', dev(s, 'KM1coil').energized === false);
  check('电动机停转', motorOf(s).running === false);
}

console.log('\n=== 课程 6：自锁（起保停） ===');
{
  const e = engineOf('motor-self-lock');
  e.setState('QF1', 'closed');
  e.setState('QF2', 'closed');
  e.press('SB2', true);
  let s = e.compute(now);
  check('按下启动按钮 → 线圈得电', dev(s, 'KM1coil').energized === true);
  check('自锁触点闭合', dev(s, 'KM1aux').closed === true);

  e.press('SB2', false);
  s = e.compute(now);
  check('松开按钮后自锁保持 → 仍运行', dev(s, 'KM1coil').energized === true && motorOf(s).running === true);

  e.press('SB1', true);
  s = e.compute(now);
  check('按下停止按钮 → 线圈失电', dev(s, 'KM1coil').energized === false);
  check('电动机停转', motorOf(s).running === false);

  e.press('SB1', false);
  s = e.compute(now);
  check('松开停止按钮后不得电（无自保持）', dev(s, 'KM1coil').energized === false);

  // 过载保护
  e.press('SB2', true);
  e.compute(now);
  e.press('SB2', false);
  e.setTripped('FR1c', true);
  s = e.compute(now);
  check('热继电器过载脱扣 → 控制电路断开', dev(s, 'KM1coil').energized === false && motorOf(s).running === false);
}

console.log('\n=== 课程 7：正反转（联锁） ===');
{
  const e = engineOf('motor-forward-reverse');
  e.setState('QF1', 'closed');
  e.setState('QF2', 'closed');

  e.press('SB2', true);
  let s = e.compute(now);
  check('按下正转按钮 → KM1 吸合', dev(s, 'KM1coil').energized === true);
  check('电动机正转', motorOf(s).running === true && motorOf(s).direction === 'forward');
  e.press('SB2', false);
  s = e.compute(now);
  check('正转自锁保持', motorOf(s).running === true && motorOf(s).direction === 'forward');

  // 联锁：正转运行时按反转按钮，KM2 不应吸合
  e.press('SB3', true);
  s = e.compute(now);
  check('联锁生效：KM2 不能吸合（防相间短路）', dev(s, 'KM2coil').energized === false);
  check('联锁期间无短路', s.shorts.length === 0);
  e.press('SB3', false);

  // 停止后反转
  e.press('SB1', true);
  s = e.compute(now);
  check('停止后电动机停转', motorOf(s).running === false);
  e.press('SB1', false);

  e.press('SB3', true);
  s = e.compute(now);
  check('反转启动 → KM2 吸合', dev(s, 'KM2coil').energized === true);
  e.press('SB3', false);
  s = e.compute(now);
  check('电动机反转（相序改变）', motorOf(s).running === true && motorOf(s).direction === 'reverse');
}

console.log('\n=== 课程 8：星—三角降压启动 ===');
{
  const e = engineOf('motor-star-delta');
  e.setState('QF1', 'closed');
  e.setState('QF2', 'closed');
  const t0 = now;
  e.press('SB1', true);
  let s = e.compute(t0);
  check('启动：KM1 吸合', dev(s, 'KM1coil').energized === true);
  check('启动：KM2（星形）吸合', dev(s, 'KM2coil').energized === true);
  check('启动：KM3（三角）未吸合', dev(s, 'KM3coil').energized === false);
  check('启动：电动机按星形运行', motorOf(s).running === true && motorOf(s).mode === 'Y');
  check('星形时绕组电压约 220V', Math.abs(motorOf(s).windingVoltage - 220) <= 2, `实际 ${motorOf(s).windingVoltage}V`);

  e.press('SB1', false);
  s = e.compute(t0 + 1000);
  check('计时中：仍为星形（1s）', motorOf(s).mode === 'Y' && dev(s, 'KM2coil').energized === true);
  check('时间继电器倒计时中', dev(s, 'KTcoil').timerLeft > 0);

  s = e.compute(t0 + 3500);
  check('延时到（3.5s）：KM2 释放', dev(s, 'KM2coil').energized === false);
  check('延时到：KM3 吸合', dev(s, 'KM3coil').energized === true);
  check('延时到：切换为三角形运行', motorOf(s).mode === 'Δ');
  check('三角形时绕组电压 380V', motorOf(s).windingVoltage === 380);
  check('切换过程无短路', s.shorts.length === 0);

  e.press('SB3', true);
  s = e.compute(t0 + 4000);
  check('停止：全部接触器释放', !dev(s, 'KM1coil').energized && !dev(s, 'KM3coil').energized && !dev(s, 'KM2coil').energized);
  check('停止：电动机停转', motorOf(s).running === false);
  check('停止：KT 复位', dev(s, 'KTcoil').timerLeft == null);
}

console.log('\n=== 课程 9：一灯一控一插座 ===');
{
  const e = engineOf('lighting-lamp-socket');
  e.setState('QF1', 'closed');
  e.setState('QF2', 'closed');
  e.setState('QF3', 'closed');
  let s = e.compute(now);
  check('合闸后灯仍灭（开关未合）', !dev(s, 'EL1').lit);
  check('插座支路 L 端带电', s.nets['n-socket-L'].live === true);
  check('插座 N 端为零线电位', s.nets['n-N-bus'].neutral === true);

  e.setState('SA1', 'closed');
  s = e.compute(now);
  check('合上 SA1 → 灯点亮', dev(s, 'EL1').lit === true);

  e.injectFault({ id: 'f-xs', type: 'short', between: ['n-socket-L', 'n-N-bus'] });
  s = e.compute(now);
  check('插座短路：检出短路', s.shorts.length > 0);
  check('插座短路：QF2 漏保脱扣', dev(s, 'QF2').tripped === true);
  check('插座短路：QF1 总开关脱扣', dev(s, 'QF1').tripped === true);
  check('插座短路：灯随之失电', dev(s, 'EL1').lit === false);
}

console.log('\n=== 课程 10：电动机两地控制 ===');
{
  const e = engineOf('motor-two-place');
  e.setState('QF1', 'closed');
  e.setState('QF2', 'closed');
  let s = e.compute(now);
  check('未操作：电动机停转', motorOf(s).running === false);

  e.press('SB2', true);
  s = e.compute(now);
  check('甲地启动（SB2）→ KM1 吸合', dev(s, 'KM1coil').energized === true);
  e.press('SB2', false);
  s = e.compute(now);
  check('松开甲地启动 → 自锁保持运行', dev(s, 'KM1coil').energized === true && motorOf(s).running === true);

  e.press('SB1', true);
  s = e.compute(now);
  check('甲地停止（SB1）→ 停机', motorOf(s).running === false);
  e.press('SB1', false);

  e.press('SB4', true);
  s = e.compute(now);
  check('乙地启动（SB4）→ 电动机运行', motorOf(s).running === true);
  e.press('SB4', false);

  e.press('SB3', true);
  s = e.compute(now);
  check('乙地停止（SB3）→ 停机', motorOf(s).running === false);
  e.press('SB3', false);

  check('两地控制全程无短路', s.shorts.length === 0);
}

console.log('\n=== 网络标号：同名网络等电位 ===');
{
  const circuit = {
    id: 'netlabel-test',
    title: '网络标号测试',
    canvas: { width: 800, height: 600 },
    supply: { system: '1ph', voltage: 220 },
    devices: [
      { id: 'QF1', type: 'qf_1p', x: 100, y: 200 },
      { id: 'EL1', type: 'el_lamp', x: 400, y: 400 },
    ],
    nets: [
      { id: 'L', phase: 'L', bus: true, pins: [['QF1', '1']] },
      { id: 'n-a', name: 'A1', pins: [['QF1', '2']] },
      { id: 'n-b', name: 'A1', pins: [['EL1', '1']] },
      { id: 'N', phase: 'N', bus: true, pins: [['EL1', '2']] },
    ],
  };
  const e = new SimulationEngine({ circuit, deviceTypes });
  let s = e.compute(now);
  check('未合闸：灯灭', !dev(s, 'EL1').lit);

  e.setState('QF1', 'closed');
  s = e.compute(now);
  check('同标号 A1 的两段导线归入同一节点', s.nets['n-a'].component === s.nets['n-b'].component);
  check('经网络标号跨接 → 灯点亮', dev(s, 'EL1').lit === true);

  // 改标号 → 关联断开
  circuit.nets[2].name = 'A2';
  const e2 = new SimulationEngine({ circuit, deviceTypes });
  e2.setState('QF1', 'closed');
  const s2 = e2.compute(now);
  check('标号改成 A2 后不再等电位', s2.nets['n-a'].component !== s2.nets['n-b'].component);
  check('标号不同 → 灯不亮', dev(s2, 'EL1').lit === false);
}

/* ------------------------------------------------------------ SVG 预览 */
console.log('\n=== 导出 SVG 预览 ===');
fs.mkdirSync(PREVIEW_DIR, { recursive: true });
for (const c of circuits) {
  const e = new SimulationEngine({ circuit: c, deviceTypes });
  // 用一个「合闸运行」状态出图，便于检查高亮效果
  const snap = e.compute(now);
  const svg = renderCircuit({ circuit: c, deviceTypes, snapshot: snap, options: { showGrid: true } });
  fs.writeFileSync(path.join(PREVIEW_DIR, `${c.id}.svg`), svg, 'utf8');
  console.log(`  · preview/${c.id}.svg`);
}

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
if (fail > 0) {
  console.log('\n失败项：');
  for (const f of failures) console.log(` - ${f}`);
  process.exitCode = 1;
}
