/**
 * 插入的三相线 / 单相线（电源母线 net.bus）整条可移动 —— 专项验证
 * ------------------------------------------------------------------
 * 1. translateBusNet：主干、相线文字、线号、网络标号整体平移
 * 2. 从母线接到元件引脚的支线：母线侧端点跟随、引脚侧端点保持不动（不会脱线）
 * 3. 往返平移可精确复原；零位移 / 未知网络 / 非法参数不改变数据
 * 4. 渲染层：g.wire 带 data-bus 与 move 光标，相线文字带 data-net 可随拖动预览
 * 5. 母线接线点位（tap）由 geometry 实时生成，平移后自动跟随
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { translateBusNet } from '../shared/render/layout.js';
import { renderCircuit } from '../shared/render/index.js';

const pack = JSON.parse(fs.readFileSync(new URL('../resources/packs/device-types.json', import.meta.url), 'utf8'));
const deviceTypes = pack.types;

let pass = 0;
let fail = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`✓ ${name}`);
    pass += 1;
  } catch (e) {
    console.log(`✗ ${name} — ${e.message}`);
    fail += 1;
  }
};

/** 最小电路：一条水平母线 + 一个元件，母线经一条支线接到元件引脚 */
function makeCircuit() {
  return {
    canvas: { width: 2000, height: 1000 },
    devices: [{ id: 'D1', type: 'mock_dev', x: 400, y: 300, rot: 0, label: 'D1', props: {} }],
    nets: [
      {
        id: 'L',
        phase: 'L',
        bus: true,
        geometry: [
          [[80, 80], [1480, 80]],       // 主干
          [[400, 80], [400, 272]],      // 支线：起点在母线上，终点 = D1 的 A1 引脚
        ],
        label: { text: 'L 220V', x: 80, y: 70 },
        tag: '101',
        wireTagPos: { x: 700, y: 60, anchor: 'middle' },
        tagPos: { x: 690, y: 58 },
        flagPos: { x: 200, y: 60 },
        pins: [['D1', 'A1']],
      },
    ],
  };
}
const mockTypes = [{ id: 'mock_dev', pins: [{ id: 'A1', x: 0, y: -28, dir: 'up' }] }];

console.log('\n[1] translateBusNet：整条母线平移');
{
  const c = makeCircuit();
  check('有效平移返回 true', () => assert.equal(translateBusNet(c, mockTypes, 'L', 100, 50), true));
  check('主干两端各平移 (100,50)', () =>
    assert.deepEqual(c.nets[0].geometry[0], [[180, 130], [1580, 130]]));
  check('相线文字同步平移', () => {
    assert.equal(c.nets[0].label.x, 180);
    assert.equal(c.nets[0].label.y, 120);
  });
  check('线号 wireTagPos / tagPos 同步平移', () => {
    assert.deepEqual(c.nets[0].wireTagPos, { x: 800, y: 110, anchor: 'middle' });
    assert.deepEqual(c.nets[0].tagPos, { x: 790, y: 108 });
  });
  check('网络标号 flagPos 同步平移', () => assert.deepEqual(c.nets[0].flagPos, { x: 300, y: 110 }));
}

console.log('\n[2] 支线端点保持（不脱线）');
{
  const c = makeCircuit();
  translateBusNet(c, mockTypes, 'L', 100, 50);
  check('支线母线侧端点跟随平移', () => assert.deepEqual(c.nets[0].geometry[1][0], [500, 130]));
  check('支线元件引脚侧端点保持 (400,272)', () =>
    assert.deepEqual(c.nets[0].geometry[1][1], [400, 272]));
  check('支线仍与主干起点 x 对齐（正交走线不歪）', () =>
    assert.equal(c.nets[0].geometry[1][0][0], 500));
}

console.log('\n[3] 往返平移与边界');
{
  const c = makeCircuit();
  const before = JSON.stringify(c.nets[0]);
  translateBusNet(c, mockTypes, 'L', 130, -70);
  translateBusNet(c, mockTypes, 'L', -130, 70);
  check('往返平移后数据完全复原', () => assert.equal(JSON.stringify(c.nets[0]), before));

  const c2 = makeCircuit();
  const snap = JSON.stringify(c2);
  check('dx=dy=0 返回 false 且不改数据', () => {
    assert.equal(translateBusNet(c2, mockTypes, 'L', 0, 0), false);
    assert.equal(JSON.stringify(c2), snap);
  });
  check('未知网络返回 false 且不改数据', () => {
    assert.equal(translateBusNet(c2, mockTypes, 'NOPE', 10, 10), false);
    assert.equal(JSON.stringify(c2), snap);
  });
  check('非法位移返回 false 且不改数据', () => {
    assert.equal(translateBusNet(c2, mockTypes, 'L', NaN, 10), false);
    assert.equal(JSON.stringify(c2), snap);
  });
  check('非 bus 网络也能整体平移（供框选复用）', () => {
    c2.nets[0].bus = false;
    assert.equal(translateBusNet(c2, mockTypes, 'L', 10, 10), true);
    assert.deepEqual(c2.nets[0].geometry[0], [[90, 90], [1490, 90]]);
  });
}

console.log('\n[4] 渲染层标识与接线点位');
{
  // 用真实元件库，避免 mock 类型没有符号实现
  const realType = deviceTypes.find((t) => t.id === 'qf_1p') || deviceTypes[0];
  const c = {
    canvas: { width: 2000, height: 1000 },
    devices: [{ id: 'QF1', type: realType.id, x: 400, y: 300, rot: 0, label: 'QF1', props: {} }],
    nets: [
      {
        id: 'L', phase: 'L', bus: true,
        geometry: [[[80, 80], [1480, 80]]],
        label: { text: 'L 220V', x: 80, y: 70 },
        pins: [],
      },
      { id: 'w1', geometry: [[[80, 300], [400, 300]]], pins: [] },
    ],
  };
  const opts = { interactive: true, showPins: true };
  const svg = renderCircuit({ circuit: c, deviceTypes, snapshot: null, options: opts });
  check('母线渲染为 g.wire[data-bus="1"]', () => assert.match(svg, /<g class="wire" data-net="L" data-bus="1"/));
  check('普通导线渲染为 data-bus="0"', () => assert.match(svg, /<g class="wire" data-net="w1" data-bus="0"/));
  check('母线光标为 move（提示可拖动）', () => assert.match(svg, /data-bus="1" style="cursor:move"/));
  check('相线文字带 data-net，可随拖动预览', () => assert.match(svg, /data-bus-label="L"/));
  check('母线接线点位按 geometry 实时生成', () => assert.match(svg, /data-tap="80,80"/));

  translateBusNet(c, deviceTypes, 'L', 100, 50);
  const moved = renderCircuit({ circuit: c, deviceTypes, snapshot: null, options: opts });
  check('平移后接线点位自动跟随到 (180,130)', () => assert.match(moved, /data-tap="180,130"/));
  check('平移后相线文字坐标同步更新', () => assert.match(moved, /x="180" y="120"[^>]*>L 220V/));
  check('平移后旧接线点位不再存在', () => assert.doesNotMatch(moved, /data-tap="80,80"/));
}

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
if (fail) process.exit(1);
