/**
 * 生成「时间继电器国标符号对照」离线查看页（纯渲染，不依赖 dev server）。
 * 用法：node scripts/gen-kt-preview.mjs [输出路径]
 * 默认输出到工作区根目录 kt-symbols-preview.html，符号直接取自 shared/render/symbols.js，
 * 因此改动符号后可一键重生成，页面与画布渲染结果始终一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import { drawSymbol } from '../shared/render/symbols.js';

const pack = JSON.parse(fs.readFileSync(new URL('../resources/packs/device-types.json', import.meta.url), 'utf8'));
const T = (id) => pack.types.find((t) => t.id === id);

const out = process.argv[2] || path.resolve('../kt-symbols-preview.html');

const cell = (id, name, note, { closed = false, zoom = 1 } = {}) => {
  const t = T(id);
  const svg = drawSymbol(t, { closed });
  return `<td><div class="nm">${name}</div><div class="nt">${note}</div>
  <svg viewBox="-42 -40 84 80" style="width:${132 * zoom}px;height:${126 * zoom}px" xmlns="http://www.w3.org/2000/svg">${svg}</svg>
  <div class="id">${t.symbol} · ${closed ? '闭合' : '断开'}</div></td>`;
};

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>时间继电器国标符号对照</title>
<style>
body{font-family:'Microsoft YaHei','Segoe UI',sans-serif;background:#f7f9fc;color:#1f2937;padding:20px 26px;margin:0}
h1{font-size:20px;margin:0 0 6px} h2{font-size:14px;margin:22px 0 8px;color:#1f2937}
p{font-size:13px;color:#4b5563;margin:0 0 12px}
table{border-collapse:collapse;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.08)}
td{border:1px solid #dce4ee;width:190px;padding:10px 8px 8px;text-align:center;vertical-align:top}
.nm{font-size:14px;font-weight:700} .nt{font-size:11.5px;color:#7b2fbf;margin:2px 0 4px}
.id{font-size:11px;color:#8b95a5;font-family:monospace}
svg{width:150px;height:150px;display:block;margin:0 auto}
.rule{margin-top:16px;font-size:12.5px;color:#374151;background:#eef4ff;border-left:4px solid #2563eb;padding:9px 12px;border-radius:0 6px 6px 0}
.big td{width:300px} .big svg{width:300px;height:300px}
.grid{position:relative}
</style></head><body>
<h1>时间继电器符号（GB/T 4728）— 延时闭合 / 延时断开 对照</h1>
<p>伞形半圆弧凸向「被延时的动作方向」：动合闭合向左、动断闭合向右；延时闭合凸向闭合方向，延时断开凸向断开方向。<br>
伞弧与本体的间隙：弧弦距动触点竖线 <b>9px</b>（半径 5.5px、线宽 2px），只留一条水平伞柄跨过间隙接到动触点；弧的两端短划朝弧外侧撇，弧身和两端都不与元件本体相交。</p>

<h2>① 线圈与瞬动触点</h2>
<table><tr>
${cell('kt_coil', '通电延时线圈', '矩形下半部 ×')}
${cell('kt_coil_off', '断电延时线圈', '矩形下半部黑块')}
${cell('kt_inst_no', '瞬动动合', '无伞弧')}
${cell('kt_inst_nc', '瞬动动断', '顶端横杠，无伞弧')}
</tr></table>

<h2>② 延时触点（断开状态 / 闭合状态）</h2>
<table>
<tr>${cell('kt_no', '延时闭合动合', '伞弧凸左', { closed: false })}${cell('kt_nc', '延时断开动断', '伞弧凸左 + 横杠', { closed: false })}${cell('kt_off_no', '延时断开动合', '伞弧凸右', { closed: false })}${cell('kt_off_nc', '延时闭合动断', '伞弧凸右 + 横杠', { closed: false })}</tr>
<tr>${cell('kt_no', '延时闭合动合', '动作后闭合', { closed: true })}${cell('kt_nc', '延时断开动断', '动作后断开', { closed: true })}${cell('kt_off_no', '延时断开动合', '动作后闭合', { closed: true })}${cell('kt_off_nc', '延时闭合动断', '动作后断开', { closed: true })}</tr>
</table>

<h2>③ 放大检查（3×，看伞弧间隙是否清楚）</h2>
<table class="big"><tr>
${cell('kt_no', '延时闭合动合', '伞弧与本体分离，伞柄相连', { zoom: 2.6 })}
${cell('kt_off_no', '延时断开动合', '伞弧在右侧，同样留间隙', { zoom: 2.6 })}
</tr></table>

<h2>④ 教学画布实际尺寸（1:1 与 1.6×，像素级对照）</h2>
<table><tr>
${['kt_no', 'kt_nc', 'kt_off_no', 'kt_off_nc'].map((id) => `<td style="width:auto">
  <svg viewBox="-30 -30 60 60" style="width:60px;height:60px" xmlns="http://www.w3.org/2000/svg">${drawSymbol(T(id), { closed: false })}</svg>
  <svg viewBox="-30 -30 60 60" style="width:96px;height:96px" xmlns="http://www.w3.org/2000/svg">${drawSymbol(T(id), { closed: false })}</svg>
  <div class="id">${id}</div></td>`).join('')}
</tr></table>

<div class="rule"><b>矩阵：</b>延时闭合·动合 → 凸左　|　延时闭合·动断 → 凸右　|　延时断开·动合 → 凸右　|　延时断开·动断 → 凸左。瞬动触点不带伞弧，动断触点顶端多一条横杠。</div>
</body></html>`;

fs.writeFileSync(out, html);
console.log(`已生成 ${out}`);
