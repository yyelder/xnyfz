/** 离线渲染课程 SVG 预览：node scripts/render-preview.mjs [courseId ...] */
import fs from 'node:fs';
import path from 'node:path';
import { SimulationEngine } from '../shared/engine/index.js';
import { renderCircuit } from '../shared/render/index.js';

const dir = path.resolve('resources/packs/circuits');
const types = JSON.parse(fs.readFileSync('resources/packs/device-types.json', 'utf8')).types;
const args = process.argv.slice(2);

const all = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const files = args.length
  ? args.map((id) => all.find((f) => f === `${id}.json` || f.endsWith(`-${id}.json`))).filter(Boolean)
  : all;

for (const f of files) {
  const c = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const e = new SimulationEngine({ circuit: c, deviceTypes: types });
  // 演示状态：合闸全部断路器/开关
  for (const d of c.devices) {
    const t = types.find((x) => x.id === d.type);
    if (t && (t.role === 'breaker' || t.role === 'switch')) e.setState(d.id, 'closed');
  }
  const startBtn = c.devices.find((d) => {
    const t = types.find((x) => x.id === d.type);
    return t && t.role === 'button' && !t.nc;
  });
  if (startBtn) e.press(startBtn.id, true);
  const snap = e.compute(1700000000000);
  const out = `preview/${path.basename(f, '.json')}.svg`;
  fs.writeFileSync(out, renderCircuit({ circuit: c, deviceTypes: types, snapshot: snap }));
  console.log(`${c.id} -> ${out}`);
}
