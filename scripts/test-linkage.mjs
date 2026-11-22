/** 诊断：全类型联动验证（线圈↔触点、复合按钮、热继电器），对比有/无显式 group + label 兜底 */
import fs from 'node:fs';
import { SimulationEngine } from '../shared/engine/index.js';
const deviceTypes = JSON.parse(fs.readFileSync(new URL('../resources/packs/device-types.json', import.meta.url), 'utf8')).types;

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  ok ? pass++ : fail++;
};

/* ---- 1. KM 自锁：线圈 ↔ 辅助常开，无显式 group（靠 label=KM1 兜底） ---- */
{
  const e = new SimulationEngine({
    deviceTypes,
    circuit: {
      supply: { system: '1ph', voltage: 220 },
      devices: [
        { id: 'SB2', type: 'sb_no', label: 'SB2', props: {} },
        { id: 'aux', type: 'km_no', label: 'KM1', props: {} },
        { id: 'coil', type: 'km_coil', label: 'KM1', props: {} },
      ],
      nets: [
        { id: 'L', phase: 'L', pins: [['SB2', '1'], ['aux', '1']] },
        { id: 'nB', pins: [['SB2', '2'], ['aux', '2'], ['coil', 'A1']] },
        { id: 'N', phase: 'N', pins: [['coil', 'A2']] },
      ],
    },
  });
  e.press('SB2', true);
  let s = e.compute(Date.now());
  check('KM 按住启动：线圈得电且常开触点闭合', s.loads.coil?.energized && s.devices.aux?.closed);
  e.press('SB2', false);
  s = e.compute(Date.now());
  check('KM 松开启动：自锁保持（线圈+触点仍通）', s.loads.coil?.energized && s.devices.aux?.closed);
}

/* ---- 2. KM 常闭触点：得电后应断开（互锁） ---- */
{
  const e = new SimulationEngine({
    deviceTypes,
    circuit: {
      supply: { system: '1ph', voltage: 220 },
      devices: [
        { id: 'SB2', type: 'sb_no', label: 'SB2', props: {} },
        { id: 'coil', type: 'km_coil', label: 'KM1', props: {} },
        { id: 'nc', type: 'km_nc', label: 'KM1', props: {} },
      ],
      nets: [
        { id: 'L', phase: 'L', pins: [['SB2', '1']] },
        { id: 'nB', pins: [['SB2', '2'], ['coil', 'A1']] },
        { id: 'N', phase: 'N', pins: [['coil', 'A2']] },
        { id: 'ncA', phase: 'L', pins: [['nc', '1']] },
        { id: 'ncB', phase: 'N', pins: [['nc', '2']] },
      ],
    },
  });
  let s = e.compute(Date.now());
  check('KM 未得电：常闭触点导通', !!s.devices.nc?.closed);
  e.press('SB2', true);
  s = e.compute(Date.now());
  check('KM 得电：常闭触点断开', s.loads.coil?.energized && !s.devices.nc?.closed);
}

/* ---- 3. KM 主触点（三极）：得电后闭合 ---- */
{
  const e = new SimulationEngine({
    deviceTypes,
    circuit: {
      supply: { system: '3ph', voltage: 380 },
      devices: [
        { id: 'SB2', type: 'sb_no', label: 'SB2', props: {} },
        { id: 'coil', type: 'km_coil', label: 'KM1', props: {} },
        { id: 'main', type: 'km_no_3p', label: 'KM1', props: {} },
      ],
      nets: [
        { id: 'L', phase: 'L1', pins: [['SB2', '1']] },
        { id: 'nB', pins: [['SB2', '2'], ['coil', 'A1']] },
        { id: 'N', phase: 'N', pins: [['coil', 'A2']] },
      ],
    },
  });
  let s = e.compute(Date.now());
  check('KM 未得电：主触点断开', !s.devices.main?.closed);
  e.press('SB2', true);
  s = e.compute(Date.now());
  check('KM 得电：三极主触点闭合', s.loads.coil?.energized && s.devices.main?.closed);
}

/* ---- 4. KT 延时继电器：线圈得电 → 延时后延时常开闭合 ---- */
{
  const e = new SimulationEngine({
    deviceTypes,
    circuit: {
      supply: { system: '1ph', voltage: 220 },
      devices: [
        { id: 'SB2', type: 'sb_no', label: 'SB2', props: {} },
        { id: 'coil', type: 'kt_coil', label: 'KT1', props: { delay: 0.5 } },
        { id: 'no', type: 'kt_no', label: 'KT1', props: {} },
      ],
      nets: [
        { id: 'L', phase: 'L', pins: [['SB2', '1']] },
        { id: 'nB', pins: [['SB2', '2'], ['coil', 'A1']] },
        { id: 'N', phase: 'N', pins: [['coil', 'A2']] },
      ],
    },
  });
  const now = Date.now();
  e.press('SB2', true);
  let s = e.compute(now);
  check('KT 得电瞬间：延时触点未动作', s.loads.coil?.energized && !s.devices.no?.closed);
  s = e.compute(now + 700);
  check('KT 到达整定时间：延时常开闭合', s.devices.no?.closed, `done=${s.devices.no?.done}`);
}

/* ---- 5. 复合按钮：同编号常开+常闭按下时反向动作 ---- */
{
  const e = new SimulationEngine({
    deviceTypes,
    circuit: {
      supply: { system: '1ph', voltage: 220 },
      devices: [
        { id: 'no', type: 'sb_no', label: 'SB3', props: {} },
        { id: 'nc', type: 'sb_nc', label: 'SB3', props: {} },
      ],
      nets: [],
    },
  });
  let s = e.compute(Date.now());
  check('复合按钮未按：常开断/常闭通', !s.devices.no?.closed && !!s.devices.nc?.closed);
  e.press('no', true); // 按下常开元件，group=SB3 应带动同组常闭
  s = e.compute(Date.now());
  check('复合按钮按下：常开闭合/常闭断开（同组联动）', !!s.devices.no?.closed && !s.devices.nc?.closed);
}

console.log(`\n=== 联动诊断：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
