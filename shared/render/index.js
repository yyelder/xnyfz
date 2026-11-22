/**
 * 电路图渲染：把「电路数据 + 运行时快照」渲染为一张 SVG。
 * 纯函数，输出字符串，便于在 Vue 中直接注入，也便于离线导出 PNG/SVG 与做视觉校验。
 */
import { C } from './palette.js';
import { drawSymbol } from './symbols.js';
import { buildNetGeometry, pinWorld, typeBounds } from './layout.js';

const FONT = "'Segoe UI','Microsoft YaHei','Noto Sans SC',sans-serif";
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toTypeMap(deviceTypes) {
  if (Array.isArray(deviceTypes)) {
    const m = new Map();
    for (const t of deviceTypes) m.set(t.id, t);
    return m;
  }
  return new Map(Object.entries(deviceTypes || {}));
}

/** 导线配色：相线带电为红、中性线为蓝、保护线为绿 */
function wireColor(net, snapNet) {
  const up = String(net.phase ?? '').trim().toUpperCase();
  if (up === 'PE') return C.pe;
  if (up === 'N' || up === 'PEN' || up === '0') return C.neutral;
  if (snapNet?.live) return C.wireLive;
  return C.wire;
}

/** 相别 → 国标相色（加深保证浅底可读） */
function phaseLabelColor(phase) {
  const ph = String(phase ?? '').trim().toUpperCase();
  if (ph === 'U' || ph === 'L1' || ph === 'L') return C.phaseU;
  if (ph === 'V' || ph === 'L2') return C.phaseV;
  if (ph === 'W' || ph === 'L3') return C.phaseW;
  if (ph === 'N' || ph === '0' || ph === 'PEN') return C.phaseN;
  if (ph === 'PE') return C.phasePE;
  return null;
}

/**
 * 元件编号标签颜色：
 *  - 电源端子按相别取国标相色（U黄/V绿/W红/N蓝/PE黄绿）
 *  - 其余按元件类别区分（KM 蓝 / KT 紫 / SB 橙 / FR 红 / 电机 绿）
 */
function deviceLabelColor(dev, type) {
  if (dev.type === 'pwr_terminal') {
    return phaseLabelColor(dev.props?.phase ?? dev.label) || C.accent;
  }
  const id = String(dev.type || '');
  if (id.startsWith('km_')) return C.labelKM;
  if (id.startsWith('kt_')) return C.labelKT;
  if (id.startsWith('ka_')) return C.labelKA;
  if (id.startsWith('sb_')) return C.labelSB;
  if (id.startsWith('fr_')) return C.labelFR;
  if (id.startsWith('m_3ph')) return C.labelMotor;
  return C.ink;
}

/**
 * 母线接线点位：沿母线线段等距生成可吸附的连接点。
 * 交互模式下渲染为「小圆点 + 加宽透明命中圈」，让三相线任意位置都能
 * 作为走线起点/终点，不再依赖细线的像素级命中（这是三相线难以接线的主要原因）。
 */
function busTaps(net, segs, color) {
  const out = [];
  const GAP = 64;
  for (const { seg } of segs) {
    const horiz = Math.abs(seg.y1 - seg.y2) < 0.6;
    const vert = Math.abs(seg.x1 - seg.x2) < 0.6;
    if (!horiz && !vert) continue;
    const len = horiz ? Math.abs(seg.x2 - seg.x1) : Math.abs(seg.y2 - seg.y1);
    const steps = Math.max(1, Math.floor(len / GAP));
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const x = Math.round(seg.x1 + (seg.x2 - seg.x1) * t);
      const y = Math.round(seg.y1 + (seg.y2 - seg.y1) * t);
      out.push(
        `<g class="wire-tap" data-net="${net.id}" data-tap="${x},${y}">` +
          `<circle cx="${x}" cy="${y}" r="2.6" fill="${color}" opacity="0.55"/>` +
          `<circle cx="${x}" cy="${y}" r="9" fill="transparent" style="cursor:crosshair"/>` +
          `</g>`
      );
    }
  }
  return out.join('');
}

function statusBadge(x, y, text, color, bg) {
  const w = 12 + text.length * 8;
  return `
    <g>
      <rect x="${x - w / 2}" y="${y - 11}" width="${w}" height="20" rx="10" fill="${bg}" stroke="${color}" stroke-width="1"/>
      <text x="${x}" y="${y + 4}" font-size="11" font-weight="600" fill="${color}" text-anchor="middle" font-family="${FONT}">${esc(text)}</text>
    </g>`;
}

/**
 * 计算交叉跳线（hop）：水平导线跨越不同网络的竖直导线时，画一个小半圆弧，
 * 明确表达「空间跨越、不连接」，这是电气原理图的标准画法。
 */
function computeHops(nets, geometries) {
  const segs = [];
  geometries.forEach((geo, i) => {
    for (const l of geo.lines) segs.push({ net: nets[i].id, ...l });
  });
  const hops = segs.map(() => []);
  const PAD = 7;
  for (let i = 0; i < segs.length; i += 1) {
    const a = segs[i];
    const aHoriz = Math.abs(a.y1 - a.y2) < 0.6;
    const aVert = Math.abs(a.x1 - a.x2) < 0.6;
    if (!aHoriz && !aVert) continue;
    for (let j = 0; j < segs.length; j += 1) {
      if (i === j || segs[j].net === a.net) continue;
      const b = segs[j];
      if (aHoriz && Math.abs(b.x1 - b.x2) < 0.6) {
        const y = a.y1;
        const x = b.x1;
        const xmin = Math.min(a.x1, a.x2) + PAD;
        const xmax = Math.max(a.x1, a.x2) - PAD;
        const ymin = Math.min(b.y1, b.y2) + PAD;
        const ymax = Math.max(b.y1, b.y2) - PAD;
        if (x > xmin && x < xmax && y > ymin && y < ymax) hops[i].push(x);
      }
    }
  }
  return segs.map((s, i) => ({ seg: s, hops: [...new Set(hops[i])].sort((p, q) => (aHorizOf(s) ? p - q : p - q)) }));
}

function aHorizOf(s) {
  return Math.abs(s.y1 - s.y2) < 0.6;
}

/** 把带跳点的线段画成路径（水平线向上跳弧） */
function segToPath(s, hops) {
  const horizontal = aHorizOf(s);
  if (!hops.length) {
    return `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="WIRECOLOR" stroke-width="WIDTH" stroke-linecap="round" opacity="OPACITY"/>`;
  }
  let d;
  if (horizontal) {
    const y = s.y1;
    const x1 = Math.min(s.x1, s.x2);
    const x2 = Math.max(s.x1, s.x2);
    d = `M ${x1} ${y}`;
    let cur = x1;
    for (const hx of hops) {
      d += ` L ${hx - 7} ${y} A 7 7 0 0 1 ${hx + 7} ${y}`;
      cur = hx + 7;
    }
    d += ` L ${x2} ${y}`;
  } else {
    const x = s.x1;
    const y1 = Math.min(s.y1, s.y2);
    const y2 = Math.max(s.y1, s.y2);
    d = `M ${x} ${y1}`;
    for (const hy of hops) {
      d += ` L ${x} ${hy - 7} A 7 7 0 0 1 ${x} ${hy + 7}`;
    }
    d += ` L ${x} ${y2}`;
  }
  return `<path d="${d}" fill="none" stroke="WIRECOLOR" stroke-width="WIDTH" stroke-linecap="round" opacity="OPACITY"/>`;
}

/**
 * 网络标号标签：同名标号的导线在电气上是同一点，标签用小旗形式贴在导线起点。
 */
function netFlag(net, geo, color) {
  const p = net.tagPos || (geo.lines[0] ? { x: geo.lines[0].x1, y: geo.lines[0].y1 } : null);
  if (!p) return '';
  const dir = net.tagSide === 'left' ? -1 : 1;
  const text = String(net.name);
  const w = 14 + text.length * 7.2;
  const x = dir > 0 ? p.x + 5 : p.x - 5 - w;
  const y = p.y - 20;
  return `
    <g class="net-flag" data-net="${net.id}" style="cursor:pointer">
      <line x1="${p.x}" y1="${p.y}" x2="${dir > 0 ? x : x + w}" y2="${p.y}" stroke="${color}" stroke-width="1" opacity="0.85"/>
      <rect x="${x}" y="${y}" width="${w}" height="17" rx="3" fill="#ffffff" stroke="${color}" stroke-width="1.2"/>
      <text x="${x + w / 2}" y="${y + 12.5}" font-size="11" font-weight="700" fill="${color}" text-anchor="middle" font-family="${FONT}">${esc(
        text
      )}</text>
    </g>`;
}

/* ------------------------------------------------------------------ 说明文本 */
const NOTE_PAD = 12;
const NOTE_FONT = 13;

/** 估算文本宽度：中文/全角按 1em，ASCII 按 0.56em（无需真实测量即可稳定排版） */
function charWidth(ch, size) {
  return /[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? size : size * 0.56;
}
function textWidthOf(str, size) {
  let w = 0;
  for (const ch of String(str)) w += charWidth(ch, size);
  return w;
}
/** 按像素宽度折行（保留显式换行） */
function wrapNoteText(text, maxW, size) {
  const out = [];
  for (const raw of String(text ?? '').split('\n')) {
    if (!raw) {
      out.push('');
      continue;
    }
    let line = '';
    let w = 0;
    for (const ch of raw) {
      const cw = charWidth(ch, size);
      if (w + cw > maxW && line) {
        out.push(line);
        line = ch;
        w = cw;
      } else {
        line += ch;
        w += cw;
      }
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

/**
 * 说明文本卡片：文字 + 可选图片（图片可在文字左侧 / 右侧 / 上方）。
 * 数据字段：{ id, text, x, y, w, fontSize, color, image(dataURL), imagePos, imageWidth, imageAspect }
 * 交互：整卡可拖动（data-note），点击可选中改属性。
 */
function renderNote(note, { interactive, selected }) {
  const size = Number(note.fontSize) || NOTE_FONT;
  const lh = Math.round(size * 1.6);
  const textW = Math.max(90, Number(note.w) || 240);
  const lines = wrapNoteText(note.text, textW, size);
  const textH = Math.max(lh, lines.length * lh);
  const hasImg = !!note.image;
  const imgW = hasImg ? Math.max(40, Number(note.imageWidth) || 160) : 0;
  const aspect = hasImg ? Math.max(0.2, Math.min(5, Number(note.imageAspect) || 0.66)) : 0.66;
  const imgH = hasImg ? imgW / aspect : 0;
  const gap = hasImg ? 10 : 0;
  const pos = note.imagePos || 'right';

  let boxW;
  let boxH;
  let textX;
  let textY;
  let imgX = 0;
  let imgY = 0;
  if (!hasImg) {
    boxW = textW + NOTE_PAD * 2;
    boxH = textH + NOTE_PAD * 2;
    textX = NOTE_PAD;
    textY = NOTE_PAD;
  } else if (pos === 'top') {
    boxW = Math.max(textW, imgW) + NOTE_PAD * 2;
    boxH = imgH + gap + textH + NOTE_PAD * 2;
    imgX = NOTE_PAD + (boxW - NOTE_PAD * 2 - imgW) / 2;
    imgY = NOTE_PAD;
    textX = NOTE_PAD;
    textY = NOTE_PAD + imgH + gap;
  } else if (pos === 'left') {
    boxW = imgW + gap + textW + NOTE_PAD * 2;
    boxH = Math.max(imgH, textH) + NOTE_PAD * 2;
    imgX = NOTE_PAD;
    imgY = NOTE_PAD;
    textX = NOTE_PAD + imgW + gap;
    textY = NOTE_PAD;
  } else {
    boxW = textW + gap + imgW + NOTE_PAD * 2;
    boxH = Math.max(imgH, textH) + NOTE_PAD * 2;
    textX = NOTE_PAD;
    textY = NOTE_PAD;
    imgX = NOTE_PAD + textW + gap;
    imgY = NOTE_PAD;
  }

  const showPlaceholder = interactive && !String(note.text || '').trim();
  const lineEls = (showPlaceholder ? ['双击输入说明文字…'] : lines)
    .map(
      (ln, i) =>
        `<text x="${textX}" y="${textY + size + i * lh}" font-size="${size}" font-family="${FONT}" fill="${
          showPlaceholder ? C.muted : note.color || C.noteText
        }" ${showPlaceholder ? 'font-style="italic"' : ''}>${esc(ln)}</text>`
    )
    .join('');

  const imgEl = hasImg
    ? `<image x="${imgX}" y="${imgY}" width="${imgW}" height="${imgH}" href="${esc(
        note.image
      )}" preserveAspectRatio="xMidYMid slice" style="pointer-events:none"/>`
    : '';

  const border = selected ? C.accent : C.noteBorder;
  const borderDash = selected ? 'stroke-dasharray="6 4"' : '';

  return `
    <g class="note" data-note="${note.id}" style="cursor:${interactive ? 'move' : 'default'}">
      <g transform="translate(${Number(note.x) || 0} ${Number(note.y) || 0})">
        <rect class="note-box" x="0" y="0" width="${boxW}" height="${boxH}" rx="8" fill="${
          C.noteBg
        }" fill-opacity="0.94" stroke="${border}" stroke-width="${selected ? 1.8 : 1.2}" ${borderDash}/>
        ${hasImg ? `<rect x="${imgX - 1}" y="${imgY - 1}" width="${imgW + 2}" height="${imgH + 2}" rx="4" fill="none" stroke="${C.noteBorder}" stroke-width="1"/>` : ''}
        ${imgEl}
        ${lineEls}
        ${interactive ? `<rect class="note-hit" x="0" y="0" width="${boxW}" height="${boxH}" fill="transparent"/>` : ''}
        <text x="${boxW - 8}" y="${boxH - 6}" font-size="9" fill="${C.noteTitle}" text-anchor="end" font-family="${FONT}" opacity="0.55">说明</text>
      </g>
    </g>`;
}

/**
 * @param {object} cfg
 * @param {object} cfg.circuit 电路
 * @param {object[]} cfg.deviceTypes 元件类型数组
 * @param {object} [cfg.snapshot] 仿真快照
 * @param {object} [cfg.options] { showGrid, showPins, selected, hovered }
 */export function renderCircuit({ circuit, deviceTypes, snapshot, options = {} }) {
  const {
    showGrid = true,
    showPins = false,
    selected = null,
    selectedIds = null,
    selectedNet = null,
    selectedNote = null,
    interactive = false,
    dimDead = false,
  } = options;
  const W = circuit.canvas?.width || 2000;
  const H = circuit.canvas?.height || 1300;
  const types = toTypeMap(deviceTypes);
  const devices = new Map((circuit.devices || []).map((d) => [d.id, d]));
  const snapNets = snapshot?.nets || {};
  const snapDevs = snapshot?.devices || {};

  /* ---------------------------------------------------------- 导线 */
  const wireParts = [];
  const dotParts = [];
  const labelParts = [];

  const netList = circuit.nets || [];
  const netGeos = netList.map((net) => buildNetGeometry(net, { devices, types }));
  const hopSegs = computeHops(netList, netGeos);
  const segsByNet = new Map();
  hopSegs.forEach(({ seg, hops }) => {
    if (!segsByNet.has(seg.net)) segsByNet.set(seg.net, []);
    segsByNet.get(seg.net).push({ seg, hops });
  });

  netList.forEach((net, i) => {
    const geo = netGeos[i];
    const color = wireColor(net, snapNets[net.id]);
    const live = !!snapNets[net.id]?.live;
    const width = net.bus ? 3 : 2.3;
    const opacity = dimDead && !live && net.phase !== 'N' && net.phase !== 'PE' ? 0.55 : 1;
    const isSel = selectedNet === net.id;

    const parts = [];
    if (isSel) {
      // 选中网络：先铺一层高亮底线，再画本体，视觉上像「被圈住的导线」
      for (const { seg } of segsByNet.get(net.id) || []) {
        parts.push(
          `<line x1="${seg.x1}" y1="${seg.y1}" x2="${seg.x2}" y2="${seg.y2}" stroke="${C.accent}" stroke-width="${width + 7}" stroke-linecap="round" opacity="0.28"/>`
        );
      }
    }
    for (const { seg, hops } of segsByNet.get(net.id) || []) {
      parts.push(
        segToPath(seg, hops)
          .replaceAll('WIRECOLOR', color)
          .replaceAll('WIDTH', width)
          .replaceAll('OPACITY', opacity)
      );
      if (interactive) {
        // data-seg = polyline 索引：Delete 时据此只删除选中的那一段，不误删整条网络。
        const segIdx = Number.isInteger(seg.polylineIndex) ? ` data-seg="${seg.polylineIndex}"` : '';
        parts.push(
          `<line x1="${seg.x1}" y1="${seg.y1}" x2="${seg.x2}" y2="${seg.y2}" stroke="transparent" stroke-width="13" fill="none" data-net="${net.id}"${segIdx} style="pointer-events:stroke"/>`
        );
      }
    }
    // 母线接线点位：可吸附、可起线、可收线，解决三相线过细/过密难以命中的问题
    if (interactive && net.bus) parts.push(busTaps(net, segsByNet.get(net.id) || [], color));
    // 实心节点：两根导线相接（T 接 / 端点相接 / 引脚接点）处画明显实心圆点。
    // 用稍大的深色描边 + 实心填充，保证在交叉跳线背景下仍清晰可辨。
    for (const j of geo.junctions) {
      parts.push(
        `<circle class="junction" cx="${j.x}" cy="${j.y}" r="${Math.max(3.4, width * 1.15)}" fill="${color}" stroke="${C.canvas}" stroke-width="1" opacity="${opacity}"/>`
      );
    }
    if (net.label?.text) {
      labelParts.push(
        `<text x="${net.label.x}" y="${net.label.y}" font-size="12" font-weight="600" fill="${color}" text-anchor="${
          net.label.anchor || 'start'
        }" font-family="${FONT}">${esc(net.label.text)}</text>`
      );
    }
    // 导线编号（电气原理图标准：线号标注在导线旁）
    if (net.tag) {
      let p = net.tagPos;
      if (!p) {
        const l = geo.lines[0];
        if (l) {
          // 竖直导线标在右侧，水平导线标在上方
          p =
            Math.abs(l.y1 - l.y2) < 0.6
              ? { x: (l.x1 + l.x2) / 2, y: l.y1 - 7, anchor: 'middle' }
              : { x: Math.max(l.x1, l.x2) + 6, y: (l.y1 + l.y2) / 2 + 4, anchor: 'start' };
        }
      }
      if (p) {
        // 白色描边 + 深青文字：无论底色是网格还是导线都清晰可读
        labelParts.push(
          `<text x="${p.x}" y="${p.y}" font-size="12.5" font-weight="700" fill="${C.wireTag}" text-anchor="${
            p.anchor || 'start'
          }" font-family="${FONT}" paint-order="stroke" stroke="${C.canvas}" stroke-width="3.5" stroke-linejoin="round" data-net="${
            net.id
          }" style="cursor:${interactive ? 'pointer' : 'default'}">${esc(net.tag)}</text>`
        );
      }
    }
    // 网络标号：原理图标准画法，小旗标签
    if (net.name) labelParts.push(netFlag(net, geo, color));

    wireParts.push(
      `<g class="wire" data-net="${net.id}" style="cursor:${interactive ? 'pointer' : 'default'}">${parts.join('')}</g>`
    );
  });

  /* ---------------------------------------------------------- 元件 */
  const devParts = [];
  for (const dev of circuit.devices || []) {
    const type = types.get(dev.type);
    if (!type) continue;
    const rt = snapDevs[dev.id] || {};
    const b = typeBounds(type);
    // 多选（框选）的元件也画选中虚线框
    const isSel = selected === dev.id || (Array.isArray(selectedIds) && selectedIds.includes(dev.id));
    const sym = drawSymbol(type, {
      closed: !!rt.closed,
      energized: !!rt.energized,
      lit: !!rt.lit,
      running: !!rt.motor?.running,
      direction: rt.motor?.direction,
      pressed: !!rt.pressed,
      tripped: !!rt.tripped,
      blown: !!rt.blown,
      state: rt.state,
      short: type.short || '',
    });

    const label = dev.label || type.short || dev.id;
    const lp = dev.labelPos || type.labelPos || 'left';
    const gap = type.labelGap ?? 14;
    let lx = 0;
    let ly = 0;
    let anchor = 'start';
    if (lp === 'right') {
      lx = b.maxX + gap;
      ly = 4;
      anchor = 'start';
    } else if (lp === 'left') {
      lx = b.minX - gap;
      ly = 4;
      anchor = 'end';
    } else if (lp === 'top') {
      lx = 0;
      ly = b.minY - 12;
      anchor = 'middle';
    } else if (lp === 'top-left') {
      lx = b.minX - 2;
      ly = b.minY - 12;
      anchor = 'start';
    } else {
      lx = 0;
      ly = b.minY - 12;
      anchor = 'middle';
    }
    // 标号可拖拽：在 labelPos 基准位置上叠加用户自定义偏移（相对元件，元件移动时标号跟随）。
    const labelOff = dev.labelOffset || {};
    lx += Number(labelOff.x) || 0;
    ly += Number(labelOff.y) || 0;

    // 引脚点位：两侧常显小圆点（预留接线位）；搭建模式显示大点位 + 加宽命中区
    const pinMarks = (type.pins || [])
      .map((p) => {
        const w = pinWorld(dev, type, p.id);
        const base = `<circle cx="${w.x}" cy="${w.y}" r="${
          showPins ? 4.6 : 3
        }" fill="${showPins ? C.panel : C.canvas}" stroke="${
          showPins ? C.accent : C.inkSoft
        }" stroke-width="${showPins ? 1.6 : 1.2}" class="pin" data-pin="${dev.id}:${p.id}"/>`;
        const hit = showPins
          ? `<circle cx="${w.x}" cy="${w.y}" r="10" fill="transparent" data-pin="${dev.id}:${p.id}" style="cursor:crosshair"/>`
          : '';
        return base + hit;
      })
      .join('');

    // 状态角标
    let badge = '';
    if (rt.tripped) badge = statusBadge(dev.x + b.maxX + 34, dev.y + b.minY + 2, '已脱扣', C.danger, '#fdecec');
    else if (type.role === 'motor' && rt.motor?.running) {
      badge = statusBadge(dev.x + 0, dev.y + (b.maxY + 30), rt.motor.direction === 'reverse' ? '反转运行' : '正转运行', C.ok, '#e9f7ef');
    } else if (rt.timerLeft != null) {
      badge = statusBadge(dev.x + b.maxX + 40, dev.y + b.minY, `${(rt.timerLeft / 1000).toFixed(1)}s`, C.amber, '#fdf4e3');
    }

    // 命中矩形 / 选中框必须用本地坐标，且放进 translate 组内跟随元件平移旋转。
    // （此前它们在外层 <g> 直接用了本地 b 坐标，被画到世界原点，撑大包围盒并遮挡元件点选。）
    // 小触点符号（常开/常闭）只有一条 20px 窄条，命中区向左右各扩 22px，
    // 覆盖符号与编号文字之间的空隙，避免点击「元件视觉中心」却命中背景网格。
    const hitPadX = Math.max(10, 22);
    const hitRect = interactive
      ? `<rect x="${b.minX - hitPadX}" y="${b.minY - 12}" width="${b.maxX - b.minX + hitPadX * 2}" height="${
          b.maxY - b.minY + 24
        }" fill="transparent" style="pointer-events:all"/>`
      : '';
    const selRect = isSel
      ? `<rect x="${b.minX - 12}" y="${b.minY - 12}" width="${b.maxX - b.minX + 24}" height="${
          b.maxY - b.minY + 24
        }" rx="6" fill="none" stroke="${C.accent}" stroke-width="1.6" stroke-dasharray="5 4"/>`
      : '';
    // 编号文字命中区：把文字本体也纳入元件点选范围（用户点编号即可改属性）
    const labelW = Math.max(20, label.length * 10.5);
    const labelH = 22;
    let labelHX = dev.x + lx;
    if (anchor === 'end') labelHX -= labelW;
    else if (anchor === 'middle') labelHX -= labelW / 2;
    const labelHitRect = interactive
      ? `<rect x="${labelHX - 3}" y="${dev.y + ly - labelH + 4}" width="${labelW + 6}" height="${labelH}" fill="transparent" data-label-drag="${dev.id}" style="pointer-events:all;cursor:move"/>`
      : '';

    devParts.push(`
      <g class="dev" data-dev="${dev.id}" style="cursor:${interactive ? 'move' : 'pointer'}">
        <g transform="translate(${dev.x} ${dev.y}) rotate(${dev.rot || 0})">${hitRect}${selRect}${sym}</g>
        ${labelHitRect}
        <text x="${dev.x + lx}" y="${dev.y + ly}" font-size="16" font-weight="700" fill="${deviceLabelColor(
          dev,
          type
        )}" text-anchor="${anchor}" font-family="${FONT}" paint-order="stroke" stroke="${C.panel}" stroke-width="3" stroke-linejoin="round" data-dev-label="${
          dev.id
        }" data-label-drag="${dev.id}" style="cursor:move">${esc(label)}</text>
        ${pinMarks}
        ${badge}
        ${
          type.showPinLabels
            ? (type.pins || [])
                .map((p) => {
                  const w = pinWorld(dev, type, p.id);
                  const dx = w.dir === 'left' ? -7 : w.dir === 'right' ? 7 : 0;
                  const dy = w.dir === 'up' ? -7 : w.dir === 'down' ? 13 : 4;
                  return `<text x="${w.x + dx}" y="${w.y + dy}" font-size="9.5" fill="${C.inkSoft}" text-anchor="middle" font-family="${FONT}">${esc(
                    p.id
                  )}</text>`;
                })
                .join('')
            : ''
        }
      </g>`);
  }

  /* ---------------------------------------------------------- 说明文本（文字 + 图片） */
  const noteParts = (circuit.notes || [])
    .map((n) => renderNote(n, { interactive, selected: selectedNote === n.id }))
    .join('');

  /* ---------------------------------------------------------- 注释 */
  const annotations = (circuit.annotations || [])
    .map(
      (a) => `<text x="${a.x}" y="${a.y}" font-size="${a.size || 12}" font-weight="${a.weight || 500}" fill="${
        a.color || C.inkSoft
      }" text-anchor="${a.anchor || 'start'}" font-family="${FONT}">${esc(a.text)}</text>`
    )
    .join('');

  const shortBanner =
    snapshot?.shorts?.length > 0
      ? `<g>
          <rect x="${W / 2 - 130}" y="12" width="260" height="34" rx="8" fill="#fdecec" stroke="${C.danger}" stroke-width="1.4"/>
          <text x="${W / 2}" y="34" font-size="14" font-weight="700" fill="${C.danger}" text-anchor="middle" font-family="${FONT}">⚠ 检测到短路，保护元件已动作</text>
        </g>`
      : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" font-family="${FONT}">
  <defs>
    <pattern id="gridMinor" width="20" height="20" patternUnits="userSpaceOnUse">
      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="${C.grid}" stroke-width="1"/>
    </pattern>
    <pattern id="gridMajor" width="100" height="100" patternUnits="userSpaceOnUse">
      <rect width="100" height="100" fill="url(#gridMinor)"/>
      <path d="M 100 0 L 0 0 0 100" fill="none" stroke="${C.gridStrong}" stroke-width="1.2"/>
    </pattern>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#1b2a3a" flood-opacity="0.08"/>
    </filter>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" fill="${C.canvas}"/>
  ${showGrid ? `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#gridMajor)"/>` : ''}
  <g class="wires">${wireParts.join('')}</g>
  <g class="wire-labels">${labelParts.join('')}</g>
  <g class="devices">${devParts.join('')}</g>
  <g class="notes">${noteParts}</g>
  <g class="annotations">${annotations}</g>
  ${shortBanner}
</svg>`;
}

export default renderCircuit;
