/**
 * 本轮三项新功能专项单测：
 *  1. 中间继电器 KA（线圈/常开/常闭）定义存在且联动规则正确
 *  2. 画布默认尺寸放大（渲染层 fallback）
 *  3. 元件标号 labelOffset 偏移渲染（标号可移动的数据基础）
 */
import fs from 'node:fs';
import { renderCircuit } from '../shared/render/index.js';
import { SimulationEngine } from '../shared/engine/index.js';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  ok ? pass++ : fail++;
};
const pack = JSON.parse(fs.readFileSync(new URL('../resources/packs/device-types.json', import.meta.url), 'utf8'));
const deviceTypes = pack.types;
const byId = (id) => deviceTypes.find((t) => t.id === id);

/* ---------- 1. 中间继电器 ---------- */
check('元件库版本已升级（≥1.4.0，含中间继电器与左侧标号）', parseFloat(pack.version) >= 1.4, pack.version);
check('存在 ka_coil 中间继电器线圈', !!byId('ka_coil') && byId('ka_coil').role === 'load');
check('存在 ka_no 常开触点', !!byId('ka_no') && byId('ka_no').role === 'contact' && !byId('ka_no').nc);
check('存在 ka_nc 常闭触点', !!byId('ka_nc') && byId('ka_nc').role === 'contact' && byId('ka_nc').nc === true);
check('KA 元件默认标号在左侧', ['ka_coil', 'ka_no', 'ka_nc'].every((id) => byId(id).labelPos === 'left'));

/* KA 线圈得电 → 同名触点联动（常开闭合、常闭断开） */
{
  const e = new SimulationEngine({
    deviceTypes,
    circuit: {
      supply: { system: '1ph', voltage: 220 },
      devices: [
        { id: 'SB2', type: 'sb_no', label: 'SB2', props: {} },
        { id: 'coil', type: 'ka_coil', label: 'KA1', props: {} },
        { id: 'auxNO', type: 'ka_no', label: 'KA1', props: {} },
        { id: 'auxNC', type: 'ka_nc', label: 'KA1', props: {} },
      ],
      nets: [
        { id: 'L', phase: 'L', pins: [['SB2', '1']] },
        { id: 'nB', pins: [['SB2', '2'], ['coil', 'A1']] },
        { id: 'N', phase: 'N', pins: [['coil', 'A2']] },
        // 触点接悬空网络：不参与主回路（避免常闭跨接 L-N 造成短路），但按 label=KA1 归组反映状态
        { id: 'noA', pins: [['auxNO', '1']] },
        { id: 'noB', pins: [['auxNO', '2']] },
        { id: 'ncA', pins: [['auxNC', '1']] },
        { id: 'ncB', pins: [['auxNC', '2']] },
      ],
    },
  });
  let s = e.compute(Date.now());
  check('KA 未得电：常开断开、常闭导通', s.devices.auxNO?.closed === false && s.devices.auxNC?.closed === true,
    `no=${s.devices.auxNO?.closed}/nc=${s.devices.auxNC?.closed}`);
  e.press('SB2', true);
  s = e.compute(Date.now());
  check('KA 得电：线圈吸合', !!s.loads.coil?.energized, `energized=${s.loads.coil?.energized}`);
  check('KA 得电：常开闭合、常闭断开', s.devices.auxNO?.closed === true && s.devices.auxNC?.closed === false,
    `no=${s.devices.auxNO?.closed}/nc=${s.devices.auxNC?.closed}`);
}

/* ---------- 2. 画布默认尺寸放大 ---------- */
{
  const svg = renderCircuit({ circuit: { devices: [], nets: [] }, deviceTypes, snapshot: null, options: {} });
  check('渲染默认 viewBox 放大到 2000x1300', svg.includes('viewBox="0 0 2000 1300"'), (svg.match(/viewBox="[^"]*"/) || [])[0]);
}

/* ---------- 3. 标号 labelOffset 偏移渲染 ---------- */
{
  const circuit = {
    canvas: { width: 800, height: 600 },
    devices: [
      { id: 'D1', type: 'km_no', label: 'KM1', labelPos: 'left', x: 200, y: 100, labelOffset: { x: -40, y: -30 }, props: {} },
    ],
    nets: [],
  };
  const svg = renderCircuit({ circuit, deviceTypes, snapshot: null, options: { interactive: true } });
  // labelPos=left, gap=26 → lx = minX(-0) - 26 = -26, 加偏移 -40 → -66；ly = 4 + (-30) = -26
  const m = svg.match(/data-dev-label="D1"[^>]*x="([^"]+)"[^>]*y="([^"]+)"/);
  const textTag = (svg.match(/<text[^>]*data-dev-label="D1"[^>]*>/) || [])[0] || '';
  const xm = textTag.match(/x="([^"]+)"/);
  const ym = textTag.match(/y="([^"]+)"/);
  const lx = xm ? Number(xm[1]) : NaN;
  const ly = ym ? Number(ym[1]) : NaN;
  check('标号应用 labelOffset 偏移（x 左移 40）', Math.abs(lx - (200 - 66)) < 1, `labelX=${lx}`);
  check('标号应用 labelOffset 偏移（y 上移 30）', Math.abs(ly - (100 - 26)) < 1, `labelY=${ly}`);
  check('标号带 data-label-drag 命中标识', svg.includes('data-label-drag="D1"'));
}

console.log(`\n=== 新功能专项：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
