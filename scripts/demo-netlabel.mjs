/**
 * 网络标号演示：渲染一张用同名标号跨接的电路，验证标签画法与等电位效果。
 * 运行：node scripts/demo-netlabel.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimulationEngine } from '../shared/engine/index.js';
import { renderCircuit } from '../shared/render/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const types = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources/packs/device-types.json'), 'utf8')).types;

const circuit = {
  id: 'netlabel-demo',
  title: '网络标号演示',
  canvas: { width: 900, height: 520 },
  supply: { system: '1ph', voltage: 220 },
  devices: [
    { id: 'QF1', type: 'qf_1p', x: 200, y: 180 },
    { id: 'SA1', type: 'sa_1p', x: 200, y: 330 },
    { id: 'EL1', type: 'el_lamp', x: 620, y: 330 },
  ],
  nets: [
    { id: 'L', phase: 'L', bus: true, geometry: [[[120, 80], [220, 80]]], label: { text: 'L 220V', x: 120, y: 68 }, pins: [['QF1', '1']] },
    { id: 'n-1', name: '101', pins: [['QF1', '2'], ['SA1', '1']], geometry: [[[200, 210], [200, 300]]] },
    { id: 'n-2', name: '101', tagPos: { x: 620, y: 300 }, pins: [['EL1', '1']], geometry: [[[620, 300], [620, 294]]] },
    { id: 'n-3', pins: [['SA1', '2'], ['EL1', '2']], geometry: [[[200, 360], [200, 430], [620, 430], [620, 366]]] },
    { id: 'N', phase: 'N', bus: true, geometry: [[[120, 470], [760, 470]]], label: { text: 'N', x: 120, y: 492 }, pins: [['EL1', '2']] },
  ],
  annotations: [
    { text: '两段导线标号同为 101 → 电气上同一点（省去长距离连线）', x: 340, y: 120, size: 12, color: '#1a5fb4' },
  ],
};

const e = new SimulationEngine({ circuit, deviceTypes: types });
e.setState('QF1', 'closed');
e.setState('SA1', 'closed');
const s = e.compute(Date.now());
console.log('EL1 lit:', s.devices.EL1.lit);

const out = path.join(ROOT, 'preview', 'netlabel-demo.svg');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, renderCircuit({ circuit, deviceTypes: types, snapshot: s }));
console.log('rendered → preview/netlabel-demo.svg');
