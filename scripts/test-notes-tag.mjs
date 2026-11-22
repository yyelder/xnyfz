/**
 * 线号 / 说明文本（含配图）/ 标号默认位置 专项单测
 * ------------------------------------------------------------------
 * 1. 线号 net.tag 必须渲染在导线旁，且颜色/字号可辨（深青、12.5、白色描边）
 * 2. 说明文本：文字按宽度折行、卡片带 data-note（可选中/拖动）、空文本显示占位
 * 3. 说明配图：dataURL 渲染为 <image>，支持 左/右/上 三种位置与自定义宽度
 * 4. 标号默认位置：未显式设置 labelPos 的元件，标号默认在元件左侧（text-anchor=end）
 */
import fs from 'node:fs';
import { renderCircuit } from '../shared/render/index.js';

const deviceTypes = JSON.parse(fs.readFileSync(new URL('../resources/packs/device-types.json', import.meta.url), 'utf8')).types;

let pass = 0;
let fail = 0;
function check(name, ok, extra = '') {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${extra ? ' → ' + extra : ''}`);
  }
}

const base = {
  canvas: { width: 900, height: 600 },
  devices: [
    { id: 'KM1C', type: 'km_coil', label: 'KM1', x: 200, y: 200, rot: 0, props: {} },
    { id: 'SB2', type: 'sb_no', label: 'SB2', x: 400, y: 200, rot: 0, props: {} },
  ],
  nets: [
    {
      id: 'net1',
      phase: 'U',
      tag: '101',
      geometry: [[[200, 120], [500, 120]]],
      pins: [],
    },
  ],
};

console.log('\n[1] 线号渲染');
{
  const svg = renderCircuit({ circuit: base, deviceTypes, snapshot: null, options: { interactive: true } });
  check('线号文字已渲染', svg.includes('>101</text>'));
  check('线号使用深青强调色 #0b6e99', svg.includes('#0b6e99'));
  check('线号字号 12.5（比旧版 11 更易读）', svg.includes('font-size="12.5"'));
  check('线号带白色描边（叠在导线/网格上也清晰）', svg.includes('paint-order="stroke"'));
  check('线号可点击选中网络（带 data-net）', /data-net="net1"/.test(svg));
}

console.log('\n[2] 说明文本卡片');
{
  const circuit = {
    ...base,
    notes: [
      { id: 'N1', text: '按下 SB2，KM1 线圈得电\n并通过辅助常开触点自锁', x: 60, y: 380, w: 220 },
    ],
  };
  const svg = renderCircuit({ circuit, deviceTypes, snapshot: null, options: { interactive: true } });
  check('说明卡片已渲染（data-note）', svg.includes('data-note="N1"'));
  check('卡片有底板矩形（note-box）', svg.includes('class="note-box"'));
  check('换行被拆成两行文字', (svg.match(/按下 SB2/g) || []).length === 1 && svg.includes('并通过辅助常开触点自锁'));
  check('卡片带透明命中区（可拖动/选中）', svg.includes('class="note-hit"'));
  check('非选中时无选中虚线', !svg.includes('data-note="N1"') || !svg.includes('stroke-dasharray="6 4"'));
}
{
  // 长文本折行：宽度受限时必须产生多行
  const circuit = {
    ...base,
    notes: [{ id: 'N2', text: '这是一段很长的说明文字'.repeat(6), x: 10, y: 10, w: 120 }],
  };
  const svg = renderCircuit({ circuit, deviceTypes, snapshot: null, options: { interactive: true } });
  const lineCount = (svg.match(/<text x="12"/g) || []).length;
  check('长文本按宽度自动折行', lineCount >= 3, `行数=${lineCount}`);
}
{
  const circuit = { ...base, notes: [{ id: 'N3', text: '   ', x: 10, y: 10, w: 200 }] };
  const svg = renderCircuit({ circuit, deviceTypes, snapshot: null, options: { interactive: true } });
  check('空文本在编辑态显示占位提示', svg.includes('双击输入说明文字'));
  const svgRun = renderCircuit({ circuit, deviceTypes, snapshot: null, options: { interactive: false } });
  check('运行时空文本不显示占位提示', !svgRun.includes('双击输入说明文字'));
}

console.log('\n[3] 说明配图');
{
  const img = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const mk = (pos) => ({
    ...base,
    notes: [{ id: 'N4', text: '图 1 自锁电路', x: 100, y: 100, w: 200, image: img, imageAspect: 1.5, imageWidth: 160, imagePos: pos }],
  });
  const svgR = renderCircuit({ circuit: mk('right'), deviceTypes, snapshot: null, options: {} });
  check('图片渲染为 <image> 且带 dataURL', svgR.includes('<image') && svgR.includes('data:image/png;base64'));
  check('图片按比例设置宽高（无变形）', /width="160" height="106\.6/.test(svgR));

  const pick = (svg) => {
    const m = /<image x="([\d.]+)" y="([\d.]+)"/.exec(svg);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  };
  const r = pick(svgR);
  const l = pick(renderCircuit({ circuit: mk('left'), deviceTypes, snapshot: null, options: {} }));
  const t = pick(renderCircuit({ circuit: mk('top'), deviceTypes, snapshot: null, options: {} }));
  check('图片可放在文字右侧', !!r && r.x >= 200, JSON.stringify(r));
  check('图片可放在文字左侧', !!l && l.x === 12, JSON.stringify(l));
  check('图片可放在文字上方', !!t && t.x >= 12, JSON.stringify(t));
}

console.log('\n[4] 标号默认位置（左侧）');
{
  const svg = renderCircuit({ circuit: base, deviceTypes, snapshot: null, options: {} });
  // 线圈类型未显式指定 labelPos 时应取元件库默认（左侧 → text-anchor="end"）
  const m = /data-dev-label="KM1C"[^>]*/.exec(svg);
  const kmLine = svg.split('\n').find((l) => l.includes('data-dev-label="KM1C"')) || '';
  check('KM1 标号默认在左侧（text-anchor=end）', kmLine.includes('text-anchor="end"'), kmLine.slice(0, 160));
  const sbLine = svg.split('\n').find((l) => l.includes('data-dev-label="SB2"')) || '';
  check('SB2 标号默认在左侧', sbLine.includes('text-anchor="end"'), sbLine.slice(0, 160));
  check('元件库默认 labelPos 已统一为 left', deviceTypes.filter((t) => t.id !== 'pwr_terminal' && t.labelPos === 'right').length === 0);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
