/**
 * 生成「触点 / 空气开关 / 插座」国标符号对照页（纯渲染，不依赖 dev server）。
 * 用法：node scripts/gen-symbol-preview.mjs [输出路径]
 * 默认输出到工作区根目录 symbols-preview.html；符号直接取自
 * shared/render/symbols.js，改完符号一键重生成即与画布渲染完全一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import { drawSymbol } from '../shared/render/symbols.js';

const pack = JSON.parse(fs.readFileSync(new URL('../resources/packs/device-types.json', import.meta.url), 'utf8'));
const T = (id) => pack.types.find((t) => t.id === id);
const out = process.argv[2] || path.resolve('../symbols-preview.html');

// act=true 表示「动作后的状态」：常开触点闭合、常闭触点断开（与画布引擎一致）
const cell = (id, name, note, { act = false, tripped = false, vb = '-48 -44 96 88', w = 150 } = {}) => {
  const t = T(id);
  const closed = act ? !t.nc : !!t.nc;
  const [, , vw, vh] = vb.split(' ').map(Number);
  const h = Math.round((w * vh) / vw);
  return `<td><div class="nm">${name}</div><div class="nt">${note}</div>
  <svg viewBox="${vb}" style="width:${w}px;height:${h}px" xmlns="http://www.w3.org/2000/svg">${drawSymbol(t, { closed, pressed: act, tripped, energized: false })}</svg>
  <div class="id">${t.symbol} · ${tripped ? '脱扣' : act ? '动作' : '常态'}</div></td>`;
};

const small = (id, vb, w) => {
  const [, , vw, vh] = vb.split(' ').map(Number);
  const h = Math.round((w * vh) / vw);
  return `<svg viewBox="${vb}" style="width:${w}px;height:${h}px" xmlns="http://www.w3.org/2000/svg">${drawSymbol(T(id), { closed: false })}</svg>`;
};

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>触点 / 空气开关 / 插座 国标符号对照</title>
<style>
body{font-family:'Microsoft YaHei','Segoe UI',sans-serif;background:#f7f9fc;color:#1f2937;padding:20px 26px;margin:0}
h1{font-size:20px;margin:0 0 6px} h2{font-size:14px;margin:22px 0 8px;color:#1f2937}
p{font-size:13px;color:#4b5563;margin:0 0 12px;line-height:1.7}
table{border-collapse:collapse;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.08);margin-bottom:6px}
td{border:1px solid #dce4ee;padding:10px 8px 8px;text-align:center;vertical-align:top}
.nm{font-size:14px;font-weight:700} .nt{font-size:11.5px;color:#7b2fbf;margin:2px 0 4px}
.id{font-size:11px;color:#8b95a5;font-family:monospace}
svg{display:block;margin:0 auto}
.rule{margin-top:16px;font-size:12.5px;color:#374151;background:#eef4ff;border-left:4px solid #2563eb;padding:9px 12px;border-radius:0 6px 6px 0;line-height:1.8}
.wide td{padding:8px 10px}
</style></head><body>
<h1>辅助触点 · 热继电器触点 · 空气开关 · 插座 — 国标符号对照</h1>
<p>本轮按用户提供的图形符号表重画：<b>常闭触点</b>＝静触头末端向右折出「短路片」、斜刀斜穿短路片；
<b>热继电器触点</b>＝常闭斜刀右倾落在短路片内、常开斜刀左倾；右侧标记统一「⊏」开口朝外 + 横穿虚线；<b>空气开关</b>＝静触头端画「×」+ 斜刀 + 极间点线；
<b>插座</b>＝圆内插孔（两眼/三眼）与三相插座的三引线画法。</p>

<h2>① 辅助触点（KM 常开/常闭、KA 常闭、KT 瞬动）</h2>
<table><tr>
${cell('km_no', '接触器辅助常开', '斜刀朝左，断态', { vb: '-46 -40 92 80' })}
${cell('km_no', '接触器辅助常开', '线圈得电：斜刀回正闭合', { act: true, vb: '-46 -40 92 80' })}
${cell('km_nc', '接触器辅助常闭', '斜刀 40° 斜穿短路片', { vb: '-46 -40 92 80' })}
${cell('km_nc', '接触器辅助常闭', '线圈得电：斜刀退回左侧断开', { act: true, vb: '-46 -40 92 80' })}
</tr><tr>
${cell('ka_nc', '中间继电器常闭', '与 KM 常闭同一画法', { vb: '-46 -40 92 80' })}
${cell('kt_inst_nc', 'KT 瞬动动断', '无延时伞弧，随线圈立即动作', { vb: '-46 -40 92 80' })}
${cell('kt_inst_nc', 'KT 瞬动动断', '线圈得电：立即断开', { act: true, vb: '-46 -40 92 80' })}
${cell('kt_inst_no', 'KT 瞬动动合', '无延时伞弧', { vb: '-46 -40 92 80' })}
</tr><tr>
${cell('km_no_3p', '接触器主触头（三极）', '静触头下端带灭弧小方钩', { vb: '-96 -40 192 80', w: 300 })}
${cell('km_no_3p', '接触器主触头（三极）', '闭合：斜刀顶住钩底', { act: true, vb: '-96 -40 192 80', w: 300 })}
</tr></table>

<h2>② 热继电器触点 FR（常开＝报警，常闭＝切断控制回路）</h2>
<table><tr>
${cell('fr_no', '常开触点', '斜刀左倾断开，标记「⊏」开口朝外', { vb: '-46 -40 92 80' })}
${cell('fr_no', '常开触点', '过载脱扣后闭合（报警）', { act: true, tripped: true, vb: '-46 -40 92 80' })}
${cell('fr_nc', '常闭触点', '刀尖落在片内、无断口，标记同为「⊏」', { vb: '-46 -40 92 80' })}
${cell('fr_nc', '常闭触点', '过载脱扣后断开并变红', { act: true, tripped: true, vb: '-46 -40 92 80' })}
</tr></table>

<h2>③ 空气开关 QF（静触头「×」+ 斜刀 + 极间点线）</h2>
<table><tr>
${cell('qf_1p', '单极', '断开：斜刀 30°', { vb: '-42 -40 84 80' })}
${cell('qf_1p', '单极', '合闸', { act: true, vb: '-42 -40 84 80' })}
${cell('qf_2p', '两极', '两极之间点线联动', { vb: '-52 -40 104 80' })}
${cell('qf_2p', '两极', '合闸', { act: true, vb: '-52 -40 104 80' })}
${cell('rcd_2p', '漏电保护器（两极）', '带 RCD 标注', { vb: '-52 -40 104 80' })}
${cell('qf_3p', '三极', '三极点线联动', { vb: '-96 -40 192 80', w: 260 })}
</tr></table>

<h2>④ 插座</h2>
<table><tr>
${cell('socket_1p', '单相两眼插座', '圆内两个插孔', { vb: '-42 -46 84 92' })}
${cell('socket_3w', '单相三眼插座', '上保护极 + 下两工作极', { vb: '-42 -54 84 108' })}
${cell('socket_3ph', '三相插座', '横线 + 两个下插孔 + 三条引线', { vb: '-52 -50 104 60', w: 190 })}
</tr></table>

<h2 id="sb-sq">⑤ 按钮 SB / 行程开关 SQ（下引线补齐，回归对照）</h2>
<table><tr>
${cell('sb_no', '常开按钮', 'E 形推杆 + 斜刀 + 下引线', { vb: '-58 -46 116 92' })}
${cell('sb_nc', '常闭按钮', '按下断开', { vb: '-58 -46 116 92' })}
${cell('sq_no', '行程开关常开', '撞块三角 + 下引线', { vb: '-48 -44 96 88' })}
${cell('sq_nc', '行程开关常闭', '撞块压下断开', { vb: '-48 -44 96 88' })}
</tr></table>

<h2>⑥ 教学画布实际尺寸（1:1 与 1.6×，像素级对照）</h2>
<table><tr>
${['km_no', 'km_nc', 'fr_no', 'fr_nc', 'qf_1p', 'socket_1p'].map((id) => `<td style="width:auto">
  ${small(id, '-44 -40 88 80', 56)}${small(id, '-44 -40 88 80', 90)}
  <div class="id">${id}</div></td>`).join('')}
</tr></table>

<div class="rule">
<b>画法要点：</b>① 常闭触点的短路片是静触头<b>末端向右折出</b>的一小段水平线（12），斜刀向右倾 21° 斜穿片中、刀尖落在片端以内，左侧不留悬空断口；
② 常开、常闭的标记统一画成「⊏」（竖片在左、臂向右、开口朝外），方向一致；虚线自刀身左侧 12 处横穿、止于标记竖片；
③ 空气开关的「×」画在静触头端，极间点线连的是各极斜刀，脱扣时整只变红；
④ 单相三眼插座的上孔为保护极（PE 自上引出），下方两孔为 L/N（自下引出）；
⑤ 按钮 / 行程开关的斜刀铰点向下补一条短竖线（y=11 → y=28），把动触点接到下接线引脚，避免下端悬空。
</div>
</body></html>`;

fs.writeFileSync(out, html);
console.log(`已生成 ${out}`);
