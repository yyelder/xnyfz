/**
 * 本轮交互修复专项单测：
 *  1. 手工走线段的 polylineIndex 标记（Delete 段级删除的数据基础）
 *  2. 两根导线相接（T 接 / 端点相接）生成实心节点 junction
 *  3. 渲染输出中 junction 使用 .junction 实心圆点
 */
import fs from 'node:fs';
import { buildNetGeometry } from '../shared/render/layout.js';
import { renderCircuit } from '../shared/render/index.js';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  ok ? pass++ : fail++;
};
const deviceTypes = JSON.parse(fs.readFileSync(new URL('../resources/packs/device-types.json', import.meta.url), 'utf8')).types;
const ctx = (devices) => ({ devices: new Map(devices.map((d) => [d.id, d])), types: new Map(deviceTypes.map((t) => [t.id, t])) });

/* 1. 多段走线带 polylineIndex */
{
  const net = {
    id: 'n1',
    geometry: [
      [[100, 100], [300, 100]],
      [[300, 100], [300, 260]],
    ],
    pins: [],
  };
  const geo = buildNetGeometry(net, ctx([]));
  const idxs = [...new Set(geo.lines.map((l) => l.polylineIndex))].sort();
  check('多段走线每段带独立 polylineIndex（0,1）', JSON.stringify(idxs) === '[0,1]', `idxs=${idxs}`);
}

/* 2a. T 接：一根导线端点落在另一根中段 → 实心节点 */
{
  const net = {
    id: 'nT',
    geometry: [
      [[100, 100], [400, 100]],          // 水平主干
      [[250, 100], [250, 260]],          // 端点 (250,100) 落在主干中段
    ],
    pins: [],
  };
  const geo = buildNetGeometry(net, ctx([]));
  const hit = geo.junctions.some((j) => Math.abs(j.x - 250) < 1.2 && Math.abs(j.y - 100) < 1.2);
  check('T 接点生成实心节点 (250,100)', hit, JSON.stringify(geo.junctions));
}

/* 2b. 端点对端点相接 → 实心节点 */
{
  const net = {
    id: 'nE',
    geometry: [
      [[100, 100], [250, 100]],
      [[250, 100], [250, 260]],
    ],
    pins: [],
  };
  const geo = buildNetGeometry(net, ctx([]));
  const hit = geo.junctions.some((j) => Math.abs(j.x - 250) < 1.2 && Math.abs(j.y - 100) < 1.2);
  check('端点相接生成实心节点 (250,100)', hit, JSON.stringify(geo.junctions));
}

/* 2c. 单纯拐角（同一段内转折，无第二根导线）不应误生成实心节点 */
{
  const net = { id: 'nL', geometry: [[[100, 100], [250, 100], [250, 260]]], pins: [] };
  const geo = buildNetGeometry(net, ctx([]));
  check('单段拐角不误生成实心节点', geo.junctions.length === 0, JSON.stringify(geo.junctions));
}

/* 3. 渲染输出含 .junction 实心圆点 */
{
  const circuit = {
    canvas: { width: 640, height: 480 },
    devices: [],
    nets: [{ id: 'nT', geometry: [[[100, 100], [400, 100]], [[250, 100], [250, 260]]], pins: [] }],
  };
  const svg = renderCircuit({ circuit, deviceTypes, snapshot: null, options: { interactive: true } });
  check('渲染输出包含实心节点 class=junction', svg.includes('class="junction"'));
  const segHits = (svg.match(/data-seg=/g) || []).length;
  check('交互模式下命中线带 data-seg', segHits > 0, `count=${segHits}`);
}

console.log(`\n=== 走线交互专项：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
