/**
 * 元件符号绘制库
 * ------------------------------------------------------------------
 * 每个符号函数接收「元件类型 + 运行时状态」，返回局部坐标系下的 SVG 片段。
 * 约定：原点位于元件中心，引脚坐标与 device-types.json 中 pins 一致；
 * 元件内部的引线（引脚 → 本体）由符号自己绘制，引脚端点由外层画点。
 */
import { C } from './palette.js';

const n = (v) => Math.round(v * 100) / 100;
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STROKE = 2.2;
const THIN = 1.6;

function ln(x1, y1, x2, y2, stroke = C.ink, w = STROKE, extra = '') {
  return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" ${extra}/>`;
}
function dot(x, y, r = 2.6, fill = C.ink) {
  return `<circle cx="${n(x)}" cy="${n(y)}" r="${r}" fill="${fill}"/>`;
}
function rect(x, y, w, h, fill = 'none', stroke = C.ink, sw = STROKE, rx = 0) {
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}
function txt(x, y, s, opts = {}) {
  const { size = 10, fill = C.inkSoft, anchor = 'middle', weight = 500, family = "'Segoe UI','Microsoft YaHei',sans-serif" } = opts;
  return `<text x="${n(x)}" y="${n(y)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" font-family="${family}">${esc(s)}</text>`;
}
function path(d, stroke = C.ink, w = STROKE, fill = 'none') {
  return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/* -------------------------------------------------------------- 基础零件 */

/** 竖直单极触点：柱 x，本体 y ∈ [-11, 11]，引脚在 ±28 */
function contactPole(x, closed, { nc = false, delay = false, color = C.ink } = {}) {
  const bladeAngle = closed ? 0 : -30;
  const out = [];
  out.push(ln(x, -28, x, -11, color));
  out.push(ln(x, 11, x, 28, color));
  // 定触点
  out.push(dot(x, -11, 2.2, color));
  // 动触片（绕下端点旋转）
  out.push(
    `<g transform="rotate(${bladeAngle} ${n(x)} 11)">${ln(x, 11, x, -10.5, color, 2.6)}</g>`
  );
  if (nc) out.push(ln(x - 6, -11, x + 6, -11, color, THIN));
  if (delay) {
    // 延时触点：用半个"降落伞"符号标识
    out.push(
      path(`M ${n(x + 8)} -13 L ${n(x + 8)} -10 L ${n(x + 15)} -10`, color, THIN),
      path(`M ${n(x + 9)} -10 Q ${n(x + 11.5)} -4 ${n(x + 14)} -10`, color, THIN)
    );
  }
  return out.join('');
}

/** 三极电气联锁虚线 */
function mechLink(xs, y, color = C.muted) {
  if (xs.length < 2) return '';
  return `<line x1="${n(xs[0])}" y1="${n(y)}" x2="${n(xs[xs.length - 1])}" y2="${n(y)}" stroke="${color}" stroke-width="1.2" stroke-dasharray="4 3"/>`;
}

/** 按钮驱动机构（左侧推杆） */
function buttonActuator(pressed, color = C.inkSoft) {
  const y = pressed ? 0 : -4;
  return `
    <line x1="-22" y1="${n(y)}" x2="-8" y2="${n(y)}" stroke="${color}" stroke-width="1.4" stroke-dasharray="3 3"/>
    <line x1="-22" y1="${n(y - 9)}" x2="-22" y2="${n(y + 9)}" stroke="${color}" stroke-width="2"/>
    <line x1="-30" y1="${n(y)}" x2="-22" y2="${n(y)}" stroke="${color}" stroke-width="2"/>
  `;
}

/* -------------------------------------------------------------- 符号表 */

const symbols = {
  meter_v(t, ctx) {
    return (
      ln(0, -30, 0, -20) +
      ln(0, 20, 0, 30) +
      `<circle cx="0" cy="0" r="20" fill="#ffffff" stroke="${C.ink}" stroke-width="${STROKE}"/>` +
      txt(0, 7, 'V', { size: 18, weight: 700, fill: C.ink, family: "'Segoe UI',sans-serif" })
    );
  },
  meter_a(t, ctx) {
    return (
      ln(0, -30, 0, -20) +
      ln(0, 20, 0, 30) +
      `<circle cx="0" cy="0" r="20" fill="#ffffff" stroke="${C.ink}" stroke-width="${STROKE}"/>` +
      txt(0, 7, 'A', { size: 18, weight: 700, fill: C.ink, family: "'Segoe UI',sans-serif" })
    );
  },
  breaker1(t, ctx) {
    const closed = ctx.closed;
    const ang = closed ? 0 : -28;
    const color = ctx.tripped ? C.danger : C.ink;
    return `
      ${ln(0, -32, 0, -13, color)}
      ${ln(0, 13, 0, 32, color)}
      ${dot(0, -13, 2.3, color)}
      <g transform="rotate(${ang} 0 13)">${ln(0, 13, 0, -12, color, 2.6)}</g>
      ${rect(5, -19, 7, 7, 'none', color, 1.2)}
    `;
  },

  breaker2(t, ctx) {
    const xs = [-24, 24];
    const ang = ctx.closed ? 0 : -28;
    const color = ctx.tripped ? C.danger : C.ink;
    return xs
      .map(
        (x) => `
      ${ln(x, -32, x, -13, color)}
      ${ln(x, 13, x, 32, color)}
      ${dot(x, -13, 2.2, color)}
      <g transform="rotate(${ang} ${x} 13)">${ln(x, 13, x, -12, color, 2.4)}</g>`
      )
      .join('') + mechLink(xs, 0, ctx.tripped ? C.danger : C.muted) + rect(30, -19, 7, 7, 'none', color, 1.2);
  },

  breaker3(t, ctx) {
    const xs = [-80, 0, 80];
    const ang = ctx.closed ? 0 : -28;
    const color = ctx.tripped ? C.danger : C.ink;
    return (
      xs
        .map(
          (x) => `
      ${ln(x, -32, x, -13, color)}
      ${ln(x, 13, x, 32, color)}
      ${dot(x, -13, 2.2, color)}
      <g transform="rotate(${ang} ${x} 13)">${ln(x, 13, x, -12, color, 2.4)}</g>
      ${rect(x + 5, -19, 6, 6, 'none', color, 1.1)}`
        )
        .join('') + mechLink(xs, 24, ctx.tripped ? C.danger : C.muted)
    );
  },

  rcd2(t, ctx) {
    return symbols.breaker2(t, ctx) + txt(0, 2, 'RCD', { size: 8, fill: C.inkSoft }) + txt(0, 60, '', {});
  },

  fuse(t, ctx) {
    const color = ctx.blown ? C.danger : C.ink;
    return `
      ${ln(0, -34, 0, -18, color)}
      ${ln(0, 18, 0, 34, color)}
      ${rect(-8, -18, 16, 36, C.panel, color, 2)}
      ${ln(0, -18, 0, 18, color, 1.4)}
      ${ctx.blown ? ln(-6, -8, 6, 8, C.danger, 2) : ''}
    `;
  },

  switch1(t, ctx) {
    const ang = ctx.closed ? 0 : -30;
    return `
      ${ln(0, -30, 0, -12, C.ink)}
      ${ln(0, 12, 0, 30, C.ink)}
      ${dot(0, -12, 2.4, C.ink)}
      ${dot(0, 12, 2.4, C.ink)}
      <g transform="rotate(${ang} 0 12)">${ln(0, 12, 0, -11, C.ink, 2.8)}</g>
    `;
  },

  switch2way(t, ctx) {
    const toB = ctx.state === 'b';
    const bladeEnd = toB ? 'M 0 -14 L 26 14' : 'M 0 -14 L -26 14';
    return `
      ${ln(0, -30, 0, -14, C.ink)}
      ${ln(-28, 14, -28, 30, C.ink)}
      ${ln(28, 14, 28, 30, C.ink)}
      ${dot(0, -14, 2.4, C.ink)}
      ${dot(-28, 14, 2.2, C.ink)}
      ${dot(28, 14, 2.2, C.ink)}
      ${path(bladeEnd, C.ink, 2.8)}
    `;
  },

  button_no(t, ctx) {
    return contactPole(0, ctx.closed, { color: C.ink }) + buttonActuator(ctx.pressed);
  },

  button_nc(t, ctx) {
    return contactPole(0, ctx.closed, { nc: true, color: C.ink }) + buttonActuator(ctx.pressed);
  },

  coil(t, ctx) {
    const on = ctx.energized;
    const color = on ? C.coilOn : C.ink;
    return `
      ${ln(0, -36, 0, -26, color)}
      ${ln(0, 26, 0, 36, color)}
      ${rect(-24, -26, 48, 52, on ? '#fdf1dc' : C.panel, color, 2.2, 3)}
      ${txt(0, 5, ctx.short || 'KM', { size: 15, weight: 700, fill: color, family: "'Segoe UI',sans-serif" })}
      ${on ? `<circle cx="16" cy="-18" r="3.4" fill="${C.coilOn}"/>` : ''}
    `;
  },

  contact_no(t, ctx) {
    return contactPole(0, ctx.closed);
  },

  contact_nc(t, ctx) {
    return contactPole(0, ctx.closed, { nc: true });
  },

  contact3_no(t, ctx) {
    const xs = [-80, 0, 80];
    return xs.map((x) => contactPole(x, ctx.closed)).join('') + mechLink(xs, 24);
  },

  thermal_nc(t, ctx) {
    const color = ctx.tripped ? C.danger : C.ink;
    return contactPole(0, ctx.closed, { nc: true, color }) + txt(12, -12, 'FR', { size: 8.5, fill: color });
  },

  thermal3(t, ctx) {
    const xs = [-80, 0, 80];
    return (
      xs
        .map(
          (x) => `
      ${ln(x, -30, x, -16, C.ink)}
      ${ln(x, 16, x, 30, C.ink)}
      ${rect(x - 7, -16, 14, 32, C.panel, C.ink, 2)}
      ${ln(x - 7, -8, x + 7, -8, C.inkSoft, 1.3)}
      ${ln(x - 7, 8, x + 7, 8, C.inkSoft, 1.3)}`
        )
        .join('') + mechLink(xs, 22)
    );
  },

  kt_no(t, ctx) {
    return contactPole(0, ctx.closed, { delay: true });
  },

  kt_nc(t, ctx) {
    return contactPole(0, ctx.closed, { nc: true, delay: true });
  },

  lamp(t, ctx) {
    const on = ctx.lit;
    return `
      ${ln(0, -36, 0, -20, on ? C.amber : C.ink)}
      ${ln(0, 20, 0, 36, on ? C.amber : C.ink)}
      ${on ? `<circle cx="0" cy="0" r="34" fill="${C.lampGlow}"/>` : ''}
      <circle cx="0" cy="0" r="20" fill="${on ? C.lampOn : C.panel}" stroke="${on ? '#b8860b' : C.ink}" stroke-width="2.2"/>
      ${ln(-12, -12, 12, 12, on ? '#8a6208' : C.ink, 1.8)}
      ${ln(-12, 12, 12, -12, on ? '#8a6208' : C.ink, 1.8)}
    `;
  },

  tube(t, ctx) {
    const on = ctx.lit;
    return `
      ${ln(0, -56, 0, -46, on ? C.amber : C.ink)}
      ${ln(0, 46, 0, 56, on ? C.amber : C.ink)}
      ${on ? `<rect x="-26" y="-56" width="52" height="112" rx="14" fill="rgba(160,220,255,.45)"/>` : ''}
      ${rect(-13, -46, 26, 92, on ? '#eaf7ff' : C.panel, on ? '#4a9fd4' : C.ink, 2.2, 13)}
      ${ln(-9, -38, 9, -38, on ? '#4a9fd4' : C.inkSoft, 1.4)}
      ${ln(-9, 38, 9, 38, on ? '#4a9fd4' : C.inkSoft, 1.4)}
      ${on ? `<rect x="-8" y="-34" width="16" height="68" rx="8" fill="#dff1fb"/>` : ''}
    `;
  },

  inductor(t, ctx) {
    const y0 = -44;
    let d = `M 0 ${y0} L 0 ${y0 + 8}`;
    for (let i = 0; i < 4; i += 1) {
      const y = y0 + 8 + i * 12;
      d += ` A 7 7 0 0 1 0 ${y + 12}`;
    }
    return `
      ${ln(0, -44, 0, -36, C.ink)}
      ${path(`M 0 -36 L 0 -32`, C.ink, 2)}
      ${path(d, C.ink, 2.2)}
      ${ln(0, 44, 0, 44, C.ink)}
      ${ln(0, 20, 0, 44, C.ink)}
    `;
  },

  starter(t, ctx) {
    return `
      ${ln(0, -26, 0, -12, C.inkSoft)}
      ${ln(0, 12, 0, 26, C.inkSoft)}
      <circle cx="0" cy="0" r="12" fill="${C.panel}" stroke="${C.inkSoft}" stroke-width="2"/>
      ${txt(0, 4, 'S', { size: 11, weight: 700, fill: C.inkSoft })}
    `;
  },

  motor3(t, ctx) {
    const on = ctx.running;
    const color = on ? C.motorOn : C.ink;
    const pins = [
      [-80, -44],
      [0, -44],
      [80, -44],
    ];
    return `
      ${pins.map(([x, y]) => radialLead(x, y, 50, color)).join('')}
      ${on ? `<circle cx="0" cy="0" r="63" fill="rgba(31,157,85,.10)"/>` : ''}
      <circle cx="0" cy="0" r="50" fill="${C.panel}" stroke="${color}" stroke-width="2.4"/>
      ${txt(0, -2, 'M', { size: 26, weight: 700, fill: color, family: "'Segoe UI',sans-serif" })}
      ${txt(0, 20, '3~', { size: 13, weight: 600, fill: color, family: "'Segoe UI',sans-serif" })}
      ${on ? rotationMark(ctx.direction) : ''}
    `;
  },

  motor6(t, ctx) {
    const on = ctx.running;
    const color = on ? C.motorOn : C.ink;
    const pins = [
      [-80, -44],
      [0, -44],
      [80, -44],
      [-80, 44],
      [0, 44],
      [80, 44],
    ];
    return `
      ${pins.map(([x, y]) => radialLead(x, y, 50, color)).join('')}
      ${on ? `<circle cx="0" cy="0" r="63" fill="rgba(31,157,85,.10)"/>` : ''}
      <circle cx="0" cy="0" r="50" fill="${C.panel}" stroke="${color}" stroke-width="2.4"/>
      ${txt(0, -2, 'M', { size: 26, weight: 700, fill: color, family: "'Segoe UI',sans-serif" })}
      ${txt(0, 20, '3~', { size: 13, weight: 600, fill: color, family: "'Segoe UI',sans-serif" })}
      ${on ? rotationMark(ctx.direction) : ''}
    `;
  },

  socket(t, ctx) {
    const on = ctx.energized;
    const color = on ? C.amber : C.ink;
    return `
      ${ln(0, -36, 0, -22, color)}
      ${ln(0, 22, 0, 36, color)}
      <circle cx="0" cy="0" r="22" fill="${on ? '#fdf3e0' : C.panel}" stroke="${color}" stroke-width="2.2"/>
      ${ln(-7, -8, -7, 6, color, 3)}
      ${ln(7, -8, 7, 6, color, 3)}
      ${txt(0, 17, 'XS', { size: 9, weight: 600, fill: color })}
    `;
  },

  terminal(t, ctx) {
    return `
      ${ln(0, -20, 0, -8, C.ink)}
      ${ln(0, 8, 0, 20, C.ink)}
      <circle cx="0" cy="0" r="7" fill="${C.panel}" stroke="${C.ink}" stroke-width="2"/>
    `;
  },

  /** 电源端子：圆点 + 向下引线（对齐竞品 L1/L2/L3/N/PE 端子样式，标签在上方） */
  terminal_pwr(t, ctx) {
    return `
      ${ln(0, 6, 0, 20, C.ink)}
      <circle cx="0" cy="0" r="5" fill="${C.panel}" stroke="${C.ink}" stroke-width="2.4"/>
    `;
  },

  /** 接近开关：触点 + 端部菱形（传感元件标志，对齐竞品分类） */
  prox(t, ctx) {
    return (
      contactPole(0, ctx.closed, { nc: !!t?.nc }) +
      `<path d="M 0 -26 L 8 -34 L 0 -42 L -8 -34 Z" fill="${C.panel}" stroke="${C.ink}" stroke-width="1.6"/>`
    );
  },
};

/** 从引脚点朝圆心画一段短引线，形成接线端子效果 */
function radialLead(x, y, r, color) {
  const len = Math.hypot(x, y);
  if (len <= r) return ln(x, y, x, y, color, 2);
  const ex = (x / len) * r;
  const ey = (y / len) * r;
  return ln(x, y, ex, ey, color, 2.4);
}

/** 电机转向标识（弧形箭头） */
function rotationMark(dir) {
  const cw = dir !== 'reverse';
  const d = cw ? 'M -16 -30 A 34 34 0 0 1 16 -30' : 'M 16 -30 A 34 34 0 0 0 -16 -30';
  const tip = cw ? 'M 16 -30 l 6 -5 l 1 8 z' : 'M -16 -30 l -6 -5 l -1 8 z';
  return path(d, C.ok, 1.8) + path(tip, C.ok, 1.4, C.ok);
}

/**
 * 绘制元件符号
 * @param {object} type 元件类型定义
 * @param {object} ctx 运行时状态 { closed, energized, lit, running, direction, pressed, tripped, blown, state, short }
 * @returns {string} SVG 片段
 */
export function drawSymbol(type, ctx = {}) {
  const fn = symbols[type?.symbol];
  if (!fn) {
    return `<rect x="-16" y="-16" width="32" height="32" fill="none" stroke="${C.danger}" stroke-dasharray="3 3"/>${txt(0, 4, '?', {
      size: 14,
      fill: C.danger,
    })}`;
  }
  return fn(type, { closed: false, ...ctx });
}

export default drawSymbol;
