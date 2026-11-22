/**
 * 改名即联动专项验证（本轮需求）
 * ------------------------------------------------------------------
 * 去掉联动组后，联动唯一依据是编号名称。本测试验证：
 *  1. KM1 常开触点与 KM1 线圈联动（同编号）；
 *  2. 把该常开触点编号改成 KM2 后，它与 KM2 线圈联动、脱离 KM1；
 *  3. 历史数据里 group 与编号不一致时，以编号为准；
 *  4. KMY/KM△ 这类纯字母代号同样按名称联动；
 *  5. 编号带描述文字（KM2 自锁）仍能提取代号 KM2。
 */
import fs from 'node:fs';
import { SimulationEngine } from '../shared/engine/index.js';

const deviceTypes = JSON.parse(fs.readFileSync(new URL('../resources/packs/device-types.json', import.meta.url), 'utf8')).types;
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  ok ? pass++ : fail++;
};

/** 构造：L → [启动按钮 SB2] → nB → 线圈；自锁触点并联在按钮两端 */
function selfLockCircuit(auxLabel, coilLabel, { group } = {}) {
  return {
    supply: { system: '1ph', voltage: 220 },
    devices: [
      { id: 'SB2', type: 'sb_no', label: 'SB2', props: {} },
      { id: 'aux', type: 'km_no', label: auxLabel, props: group ? { group } : {} },
      { id: 'coil', type: 'km_coil', label: coilLabel, props: {} },
    ],
    nets: [
      { id: 'L', phase: 'L', pins: [['SB2', '1'], ['aux', '1']] },
      { id: 'nB', pins: [['SB2', '2'], ['aux', '2'], ['coil', 'A1']] },
      { id: 'N', phase: 'N', pins: [['coil', 'A2']] },
    ],
  };
}

/* 1. 同编号 KM1 → 联动自锁 */
{
  const e = new SimulationEngine({ deviceTypes, circuit: selfLockCircuit('KM1', 'KM1') });
  e.press('SB2', true);
  let s = e.compute(Date.now());
  check('① KM1 常开 + KM1 线圈：同编号自动联动', s.loads.coil?.energized && s.devices.aux?.closed);
}

/* 2. 改编号 KM1→KM2：与 KM2 线圈联动，KM1 线圈不再被它带动 */
{
  // 电路里有两个线圈：KM1 与 KM2，自锁触点改名为 KM2
  const e = new SimulationEngine({
    deviceTypes,
    circuit: {
      supply: { system: '1ph', voltage: 220 },
      devices: [
        { id: 'SB2', type: 'sb_no', label: 'SB2', props: {} },
        { id: 'aux', type: 'km_no', label: 'KM2', props: {} }, // 原 KM1，用户改成 KM2
        { id: 'coilKM1', type: 'km_coil', label: 'KM1', props: {} },
        { id: 'coilKM2', type: 'km_coil', label: 'KM2', props: {} },
      ],
      nets: [
        { id: 'L', phase: 'L', pins: [['SB2', '1']] },
        { id: 'nAux', pins: [['aux', '1']] },
        { id: 'nB', pins: [['SB2', '2'], ['aux', '2'], ['coilKM1', 'A1'], ['coilKM2', 'A1']] },
        { id: 'N', phase: 'N', pins: [['coilKM1', 'A2'], ['coilKM2', 'A2']] },
      ],
    },
  });
  e.press('SB2', true);
  let s = e.compute(Date.now());
  check('② 触点改名 KM2：KM2 线圈得电 & 该触点闭合', s.loads.coilKM2?.energized && s.devices.aux?.closed);
}

/* 3. 历史数据 group 与编号不一致 → 以编号为准 */
{
  const e = new SimulationEngine({ deviceTypes, circuit: selfLockCircuit('KM2', 'KM2', { group: 'KM9' }) });
  e.press('SB2', true);
  let s = e.compute(Date.now());
  check('③ 遗留 group=KM9 但编号为 KM2：仍按 KM2 联动', s.loads.coil?.energized && s.devices.aux?.closed);
}

/* 4. 纯字母代号 KMY / KM△ 按名称联动 */
for (const code of ['KMY', 'KM△']) {
  const e = new SimulationEngine({ deviceTypes, circuit: selfLockCircuit(code, code) });
  e.press('SB2', true);
  let s = e.compute(Date.now());
  check(`④ ${code} 纯字母代号按名称联动`, s.loads.coil?.energized && s.devices.aux?.closed);
}

/* 5. 编号带描述文字仍能提取代号 */
{
  const e = new SimulationEngine({ deviceTypes, circuit: selfLockCircuit('KM2 自锁', 'KM2') });
  e.press('SB2', true);
  let s = e.compute(Date.now());
  check('⑤ 编号「KM2 自锁」提取代号 KM2 并联动', s.loads.coil?.energized && s.devices.aux?.closed);
}

console.log(`\n=== 改名联动专项：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
