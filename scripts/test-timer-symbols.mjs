/**
 * 时间继电器专项验证
 * ------------------------------------------------------------------
 * 1. 国标符号：四类延时触点伞弧凸向矩阵（延时闭合/断开 × 动合/动断）、
 *    动断横杠、瞬动触点无弧、通电延时线圈「矩形+×」与断电延时线圈「矩形+黑块」
 * 2. 仿真时序：通电延时（缓吸）/ 断电延时（缓放）/ 瞬动 三类行为
 * 3. 元件库分组：时间继电器按 subgroup 分为线圈/延时闭合/延时断开/瞬动
 * 4. 内置星三角课程仍使用通电延时型 KT（回归保护）
 */
import fs from 'node:fs';
import { drawSymbol } from '../shared/render/symbols.js';
import { SimulationEngine } from '../shared/engine/index.js';

const pack = JSON.parse(fs.readFileSync(new URL('../resources/packs/device-types.json', import.meta.url), 'utf8'));
const deviceTypes = pack.types;
const T = (id) => deviceTypes.find((t) => t.id === id) || { id, symbol: id, pins: [] };

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (ok) pass += 1;
  else fail += 1;
};

/* ------------------------------------------------------------ 1. 国标符号 */
console.log('\n[1] 国标符号结构（延时闭合 / 延时断开 × 动合 / 动断）');
// 国标：伞弧凸向「被延时的动作方向」。动合闭合向左、动断闭合向右。
//   延时闭合 → 凸向闭合方向；延时断开 → 凸向断开方向。
const MATRIX = [
  ['kt_no', 'close', 'left', 0, '延时闭合动合'],
  ['kt_nc', 'open', 'left', 1, '延时断开动断'],
  ['kt_off_no', 'open', 'right', 0, '延时断开动合'],
  ['kt_off_nc', 'close', 'right', 1, '延时闭合动断'],
];
for (const [id, delay, bulge, nc, label] of MATRIX) {
  const open = drawSymbol(T(id), { closed: false });
  const closed = drawSymbol(T(id), { closed: true });
  check(`${label}（${id}）：标注 data-delay=${delay}`, open.includes(`data-delay="${delay}"`));
  check(`${label}（${id}）：伞弧凸${bulge === 'left' ? '左' : '右'}`, open.includes(`data-delay-bulge="${bulge}"`));
  check(`${label}（${id}）：${nc ? '带' : '不带'}动断横杠`, open.includes(`data-nc="${nc}"`));
  check(`${label}（${id}）：有延时伞弧`, open.includes('class="timer-delay"'));
  const rot = Number((open.match(/rotate\((-?[\d.]+) 0 11\)/) || [])[1]);
  check(`${label}（${id}）：断开时动触点朝伞弧一侧倾倒（${bulge === 'left' ? '左' : '右'}）`,
    rot === (bulge === 'left' ? -18 : 18), `${rot}°`);
  check(`${label}（${id}）：闭合时动触点回正`, closed.includes('rotate(0 0 11)'));
}

console.log('\n[2] 伞弧与元件本体的间隙（不贴本体）');
for (const [id, bulge] of [['kt_no', 'left'], ['kt_nc', 'left'], ['kt_off_no', 'right'], ['kt_off_nc', 'right']]) {
  const svg = drawSymbol(T(id), { closed: false });
  const gap = Number((svg.match(/data-arc-gap="([\d.]+)"/) || [])[1]);
  const m = svg.match(/d="M (-?[\d.]+) (-?[\d.]+) A [\d.]+ [\d.]+ 0 0 \d (-?[\d.]+) (-?[\d.]+)"/) || [];
  const chordX = Number(m[1]);
  const yTop = Number(m[2]);
  const yBot = Number(m[4]);
  const cy = (yTop + yBot) / 2;
  const dir = bulge === 'left' ? -1 : 1;
  check(`${id}：伞弧弦与竖线间隙 ≥ 5px`, gap >= 5, `${gap}px`);
  check(`${id}：弦向${bulge === 'left' ? '左' : '右'}偏移，不落在动触点竖线上`, chordX * dir > 0 && Math.abs(chordX) >= 5, `弦 x=${chordX}`);
  const lines = [...svg.matchAll(/x1="(-?[\d.]+)" y1="(-?[\d.]+)" x2="(-?[\d.]+)" y2="(-?[\d.]+)"/g)]
    .map(([, x1, y1, x2, y2]) => [Number(x1), Number(y1), Number(x2), Number(y2)]);
  const stem = lines.find(([x1, y1, , y2]) => x1 === chordX && y1 === cy && y2 === cy);
  check(`${id}：伞柄从弦跨过间隙接到动触点（不越过触点本体）`,
    !!stem && stem[0] === chordX && Math.abs(stem[2]) < Math.abs(chordX), stem ? `${stem[0]} → ${stem[2]}` : '缺失');
  const top = lines.find(([, y1, x2, y2]) => y1 === yTop && x2 !== chordX);
  const bot = lines.find(([, y1, x2, y2]) => y1 === yBot && x2 !== chordX);
  check(`${id}：上端斜划朝弧外侧上撇（不碰本体）`,
    !!top && Math.abs(top[2]) > Math.abs(chordX) && top[3] < yTop, top ? `→(${top[2]}, ${top[3]})` : '缺失');
  check(`${id}：下端斜划朝弧外侧下撇（不碰本体）`,
    !!bot && Math.abs(bot[2]) > Math.abs(chordX) && bot[3] > yBot, bot ? `→(${bot[2]}, ${bot[3]})` : '缺失');
  check(`${id}：伞弧线宽与本体同级（≥2）`, /class="timer-delay"[\s\S]*stroke-width="2"/.test(svg));
  check(`${id}：弧的纵向范围不越过动触点根部`, yBot <= 9 && yTop >= -9, `${yTop}…${yBot}`);
}

console.log('\n[3] 瞬动触点与两种线圈');
for (const [id, nc] of [['kt_inst_no', 0], ['kt_inst_nc', 1]]) {
  const svg = drawSymbol(T(id), { closed: false });
  check(`${id}：瞬动触点不带延时伞弧`, !svg.includes('timer-delay') && !svg.includes('data-delay='));
  check(`${id}：动断标记 data-nc=${nc}`, svg.includes(`data-nc="${nc}"`));
}
const coilOn = drawSymbol(T('kt_coil'), { energized: false });
const coilOff = drawSymbol(T('kt_coil_off'), { energized: false });
check('通电延时线圈：竖直矩形被横线分成上下两半', coilOn.includes('x1="-16" y1="0" x2="16" y2="0"'));
check('通电延时线圈：下半部画 ×', coilOn.includes('data-timer-coil="on"') && coilOn.includes('x1="-14" y1="2"') && coilOn.includes('x1="-14" y1="20"'));
check('断电延时线圈：下半部实心黑块', coilOff.includes('data-timer-coil="off"') && coilOff.includes('x="-15" y="1" width="30" height="20"'));
check('两种线圈图形可明确区分', coilOn !== coilOff && !coilOff.includes('data-timer-coil="on"') && !coilOn.includes('data-timer-coil="off"'));

/* ------------------------------------------------------------ 2. 元件库分组 */
console.log('\n[3] 元件库分组与 timerMode');
const timerTypes = deviceTypes.filter((t) => t.group === 'timer');
check('时间继电器共 8 个元件（2 线圈 + 4 延时 + 2 瞬动）', timerTypes.length === 8, `${timerTypes.length} 个`);
for (const s of ['coil', 'delay-close', 'delay-open', 'instant']) {
  check(`subgroup=${s} 有元件`, timerTypes.filter((t) => t.subgroup === s).length >= 2,
    timerTypes.filter((t) => t.subgroup === s).map((t) => t.id).join('/'));
}
const MODE = {
  kt_coil: 'on', kt_coil_off: 'off',
  kt_no: 'on', kt_nc: 'on', kt_off_no: 'off', kt_off_nc: 'off',
  kt_inst_no: 'instant', kt_inst_nc: 'instant',
};
for (const [id, mode] of Object.entries(MODE)) {
  check(`${id}：timerMode=${mode}`, T(id).timerMode === mode, T(id).timerMode);
}
check('延时闭合/断开 subgroup 与命名一致',
  T('kt_no').subgroup === 'delay-close' && T('kt_off_nc').subgroup === 'delay-close' &&
  T('kt_nc').subgroup === 'delay-open' && T('kt_off_no').subgroup === 'delay-open');

/* ------------------------------------------------------------ 3. 时序 */
const T0 = 1_700_000_000_000;
function makeEngine(coilType, contactType, delay = 0.5) {
  return new SimulationEngine({
    deviceTypes,
    circuit: {
      supply: { system: '1ph', voltage: 220 },
      devices: [
        { id: 'SB', type: 'sb_no', label: 'SB', props: {} },
        { id: 'coil', type: coilType, label: 'KT1', props: { delay } },
        { id: 'ct', type: contactType, label: 'KT1', props: {} },
      ],
      nets: [
        { id: 'L', phase: 'L', pins: [['SB', '1']] },
        { id: 'nB', pins: [['SB', '2'], ['coil', 'A1']] },
        { id: 'N', phase: 'N', pins: [['coil', 'A2']] },
      ],
    },
  });
}

console.log('\n[4] 通电延时（缓吸）时序');
{
  const e = makeEngine('kt_coil', 'kt_no');
  e.press('SB', true);
  let s = e.compute(T0);
  check('延时闭合动合：得电瞬间未动作', !!s.loads.coil?.energized && !s.devices.ct?.closed);
  s = e.compute(T0 + 200);
  check('延时闭合动合：整定时间内仍未动作', !s.devices.ct?.closed);
  s = e.compute(T0 + 600);
  check('延时闭合动合：到达整定时间闭合', !!s.devices.ct?.closed);
  e.press('SB', false);
  s = e.compute(T0 + 650);
  check('延时闭合动合：失电立即复位（无延时）', !s.devices.ct?.closed);
}
{
  const e = makeEngine('kt_coil', 'kt_nc');
  let s = e.compute(T0);
  check('延时断开动断：初始导通', !!s.devices.ct?.closed);
  e.press('SB', true);
  s = e.compute(T0 + 100);
  check('延时断开动断：得电瞬间仍导通', !!s.devices.ct?.closed);
  s = e.compute(T0 + 600);
  check('延时断开动断：到达整定时间断开', !s.devices.ct?.closed);
  e.press('SB', false);
  s = e.compute(T0 + 650);
  check('延时断开动断：失电立即复位导通', !!s.devices.ct?.closed);
}

console.log('\n[5] 断电延时（缓放）时序');
{
  const e = makeEngine('kt_coil_off', 'kt_off_no');
  let s = e.compute(T0);
  check('延时断开动合：初始断开', !s.devices.ct?.closed);
  e.press('SB', true);
  s = e.compute(T0 + 50);
  check('延时断开动合：得电立即闭合（不延时）', !!s.devices.ct?.closed);
  e.press('SB', false);
  s = e.compute(T0 + 100);
  check('延时断开动合：失电瞬间仍保持闭合', !!s.devices.ct?.closed);
  s = e.compute(T0 + 300);
  check('延时断开动合：失电延时中仍闭合', !!s.devices.ct?.closed);
  s = e.compute(T0 + 700);
  check('延时断开动合：整定时间到才断开', !s.devices.ct?.closed);
}
{
  const e = makeEngine('kt_coil_off', 'kt_off_nc');
  let s = e.compute(T0);
  check('延时闭合动断：初始导通', !!s.devices.ct?.closed);
  e.press('SB', true);
  s = e.compute(T0 + 50);
  check('延时闭合动断：得电立即断开（不延时）', !s.devices.ct?.closed);
  e.press('SB', false);
  s = e.compute(T0 + 100);
  check('延时闭合动断：失电瞬间仍断开', !s.devices.ct?.closed);
  s = e.compute(T0 + 300);
  check('延时闭合动断：失电延时中仍断开', !s.devices.ct?.closed);
  s = e.compute(T0 + 700);
  check('延时闭合动断：整定时间到才闭合', !!s.devices.ct?.closed);
}

console.log('\n[6] 瞬动触点与断电延时状态字段');
{
  const e = makeEngine('kt_coil', 'kt_inst_no');
  e.press('SB', true);
  let s = e.compute(T0);
  check('瞬动动合：线圈得电立即闭合（不等延时）', !!s.devices.ct?.closed);
  e.press('SB', false);
  s = e.compute(T0 + 50);
  check('瞬动动合：线圈失电立即断开', !s.devices.ct?.closed);
}
{
  const e = makeEngine('kt_coil', 'kt_inst_nc');
  let s = e.compute(T0);
  check('瞬动动断：初始导通', !!s.devices.ct?.closed);
  e.press('SB', true);
  s = e.compute(T0);
  check('瞬动动断：得电立即断开', !s.devices.ct?.closed);
}
{
  const e = makeEngine('kt_coil_off', 'kt_off_no');
  e.press('SB', true);
  let s = e.compute(T0);
  check('断电延时线圈：得电时 done=true', s.devices.coil?.done === true);
  e.press('SB', false);
  s = e.compute(T0 + 100);
  check('断电延时线圈：失电延时中 timerLeft>0', s.devices.coil?.timerLeft > 0, `${s.devices.coil?.timerLeft}`);
  s = e.compute(T0 + 700);
  check('断电延时线圈：复位后 done=false 且 timerLeft=null',
    s.devices.coil?.done === false && s.devices.coil?.timerLeft == null);
}

/* ------------------------------------------------------------ 4. 内置课程回归 */
console.log('\n[7] 内置星三角课程回归');
{
  const star = JSON.parse(fs.readFileSync(new URL('../resources/packs/circuits/08-motor-star-delta.json', import.meta.url), 'utf8'));
  const kt = star.devices.filter((d) => String(d.type).startsWith('kt_'));
  check('星三角课程仍使用 KT 线圈 + 延时闭合/断开触点', kt.length >= 3, kt.map((d) => d.type).join('/'));
  check('KT 线圈为通电延时型（旧行为不变）', T('kt_coil').timerMode === 'on' && T('kt_coil').timer === true);
  check('kt_no 为通电延时闭合（旧行为不变）', T('kt_no').timerMode === 'on' && T('kt_no').delayAction === 'close');
  check('kt_nc 为通电延时断开（旧行为不变）', T('kt_nc').timerMode === 'on' && T('kt_nc').delayAction === 'open');
}

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
if (fail > 0) process.exit(1);
