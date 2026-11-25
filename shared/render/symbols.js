/**
 * 元件符号绘制库（图形符号对齐 GB/T 4728《常用电器、电机的图形与文字符号》，
 * 即用户提供的《电力拖动控制线路与技能训练》附录三页国标图）。
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

/**
 * 时间继电器延时触点的国标「半圆弧（伞形）」限定符号。
 * 半圆的直径边贴在动触点竖线上，弧凸向一侧：
 *   通电延时（缓吸，flip=false）弧凸向左（⊂）；断电延时（缓放，flip=true）弧凸向右（⊃）。
 */
function delayArc(x, flip = false, color = C.ink) {
  const cy = -3;
  const r = 7;
  // 从 (x, cy-r) 到 (x, cy+r)：sweep=0 经过左侧 (x-r, cy) 为左半圆；sweep=1 为右半圆
  const sweep = flip ? 1 : 0;
  return path(`M ${n(x)} ${n(cy - r)} A ${r} ${r} 0 0 ${sweep} ${n(x)} ${n(cy + r)}`, color, THIN);
}

/** 接触器主触头的灭弧小圆弧（国标常开主触头顶端带一小弧） */
function arcMark(x, y = -14, color = C.ink) {
  return path(`M ${n(x - 5)} ${n(y)} Q ${n(x)} ${n(y - 6)} ${n(x + 5)} ${n(y)}`, color, THIN);
}

/** 竖直单极触点：柱 x，本体 y ∈ [-11, 11]，引脚在 ±28。
 *  nc      —— 常闭：定触点处加一小横杠（国标辅助常闭触点的斜 T 标记）
 *  delay   —— 延时触点：加国标半圆弧伞形标记
 *  arc     —— 主触头：顶端加灭弧小弧
 */
function contactPole(x, closed, { nc = false, delay = false, delayFlip = false, arc = false, color = C.ink } = {}) {
  const bladeAngle = closed ? 0 : -30;
  const out = [];
  out.push(ln(x, -28, x, -11, color));
  out.push(ln(x, 11, x, 28, color));
  out.push(dot(x, -11, 2.2, color));
  out.push(`<g transform="rotate(${bladeAngle} ${n(x)} 11)">${ln(x, 11, x, -10.5, color, 2.6)}</g>`);
  if (nc) out.push(ln(x - 6, -11, x + 6, -11, color, THIN));
  if (arc) out.push(arcMark(x, -15, color));
  if (delay) out.push(delayArc(x, delayFlip, color));
  return out.join('');
}

/** 三极电气联锁虚线 */
function mechLink(xs, y, color = C.muted) {
  if (xs.length < 2) return '';
  return `<line x1="${n(xs[0])}" y1="${n(y)}" x2="${n(xs[xs.length - 1])}" y2="${n(y)}" stroke="${color}" stroke-width="1.2" stroke-dasharray="4 3"/>`;
}

/**
 * 按钮操作件（国标：动触点上方一条横「桥/帽」，短推杆 + 虚线机械联动到动触点）。
 * 旧实现画在左侧虚线推杆，与国标图纸（推杆在上方）不一致，这里改为上方。
 */
function buttonCap(pressed, color = C.ink) {
  const y = pressed ? -19 : -25;
  return (
    ln(-11, y, 11, y, color, 2.2) +          // 按钮帽（横）
    ln(0, y, 0, y + 7, color, THIN) +         // 推杆
    ln(-8, -11, 8, -11, color, THIN, 'stroke-dasharray="3 2"') // 虚线联动到动触点
  );
}

/** 行程开关的机械滚轮/撞块标记（触点上方一个小三角 + 短竖柄，国标 SQ 触头特征） */
function limitRoller(x, color = C.ink) {
  return (
    path(`M ${n(x - 6)} ${n(-18)} L ${n(x)} ${n(-27)} L ${n(x + 6)} ${n(-18)} Z`, color, THIN, C.panel) +
    ln(x, -18, x, -11, color, THIN)
  );
}

/** 继电器/接触器线圈：国标为宽扁横向矩形（线圈操作器件），内部不写大字 */
function coilRect(fill, stroke, w = 44, h = 22) {
  return rect(-w / 2, -h / 2, w, h, fill, stroke, 2.2, 2);
}

/** 变压器绕组：一串半圆弧（国标线圈组），dir=1 朝右、dir=-1 朝左 */
function winding(x, yTop, yBottom, dir = 1, color = C.ink) {
  const count = 3;
  const step = (yBottom - yTop) / count;
  let d = `M ${n(x)} ${n(yTop)}`;
  for (let i = 0; i < count; i += 1) {
    const y0 = yTop + i * step;
    d += ` A ${n(step / 2)} ${n(step / 2)} 0 0 ${dir > 0 ? 1 : 0} ${n(x)} ${n(y0 + step)}`;
  }
  return path(d, color, 2.1);
}

/** 变压器铁芯：两条平行竖线 */
function core(color = C.ink) {
  return ln(-3, -30, -3, 30, color, THIN) + ln(3, -30, 3, 30, color, THIN);
}

/**
 * 圆形器件（电动机等）的径向引线：把引脚点 (x, y) 连到半径 r 的圆周上。
 * 引脚在圆外时从引脚连到圆周；引脚落在圆内时从圆周连到引脚。
 * 两种情况都保证「端子 ↔ 本体」有一条可见连线，且与 device-types.json 的 pins 坐标严格对齐。
 */
function radialLead(x, y, r, color = C.ink) {
  const d = Math.hypot(x, y);
  if (d < 1e-6) return '';
  const k = r / d;
  return ln(x * k, y * k, x, y, color, STROKE);
}

/* -------------------------------------------------------------- 符号表 */

const symbols = {
  meter_v(t, ctx) {
    return (
      ln(0, -30, 0, -20) + ln(0, 20, 0, 30) +
      `<circle cx="0" cy="0" r="20" fill="#ffffff" stroke="${C.ink}" stroke-width="${STROKE}"/>` +
      txt(0, 7, 'V', { size: 18, weight: 700, fill: C.ink })
    );
  },
  meter_a(t, ctx) {
    return (
      ln(0, -30, 0, -20) + ln(0, 20, 0, 30) +
      `<circle cx="0" cy="0" r="20" fill="#ffffff" stroke="${C.ink}" stroke-width="${STROKE}"/>` +
      txt(0, 7, 'A', { size: 18, weight: 700, fill: C.ink })
    );
  },
  breaker1(t, ctx) {
    const closed = ctx.closed;
    const ang = closed ? 0 : -28;
    const color = ctx.tripped ? C.danger : C.ink;
    return (
      ln(0, -32, 0, -13, color) + ln(0, 13, 0, 32, color) + dot(0, -13, 2.3, color) +
      `<g transform="rotate(${ang} 0 13)">${ln(0, 13, 0, -12, color, 2.6)}</g>` +
      rect(5, -19, 7, 7, 'none', color, 1.2)
    );
  },
  breaker2(t, ctx) {
    const xs = [-24, 24];
    const ang = ctx.closed ? 0 : -28;
    const color = ctx.tripped ? C.danger : C.ink;
    return xs.map((x) => `
      ${ln(x, -32, x, -13, color)} ${ln(x, 13, x, 32, color)} ${dot(x, -13, 2.2, color)}
      <g transform="rotate(${ang} ${x} 13)">${ln(x, 13, x, -12, color, 2.4)}</g>`
    ).join('') + mechLink(xs, 0, ctx.tripped ? C.danger : C.muted) + rect(30, -19, 7, 7, 'none', color, 1.2);
  },
  breaker3(t, ctx) {
    const xs = [-80, 0, 80];
    const ang = ctx.closed ? 0 : -28;
    const color = ctx.tripped ? C.danger : C.ink;
    return xs.map((x) => `
      ${ln(x, -32, x, -13, color)} ${ln(x, 13, x, 32, color)} ${dot(x, -13, 2.2, color)}
      <g transform="rotate(${ang} ${x} 13)">${ln(x, 13, x, -12, color, 2.4)}</g>
      ${rect(x + 5, -19, 6, 6, 'none', color, 1.1)}`
    ).join('') + mechLink(xs, 24, ctx.tripped ? C.danger : C.muted);
  },
  rcd2(t, ctx) {
    return symbols.breaker2(t, ctx) + txt(0, 2, 'RCD', { size: 8, fill: C.inkSoft });
  },

  /** 熔断器：国标细长矩形，中间一条熔丝线贯穿（旧版过宽且带对角叉，已收窄） */
  fuse(t, ctx) {
    const color = ctx.blown ? C.danger : C.ink;
    return (
      ln(0, -34, 0, -17, color) + ln(0, 17, 0, 34, color) +
      rect(-5, -17, 10, 34, C.panel, color, 2) +
      ln(0, -17, 0, 17, color, 1.3) +
      (ctx.blown ? ln(-4, -7, 4, 7, C.danger, 1.8) : '')
    );
  },
  fuse3(t, ctx) {
    const xs = [-80, 0, 80];
    const color = ctx.blown ? C.danger : C.ink;
    return xs.map((x) => `
      ${ln(x, -32, x, -17, color)} ${ln(x, 17, x, 32, color)}
      ${rect(x - 5, -17, 10, 34, C.panel, color, 2)} ${ln(x, -17, x, 17, color, 1.3)}`
    ).join('') + mechLink(xs, 24, color);
  },

  /** 单极控制开关 SA：斜刀触点 */
  switch1(t, ctx) {
    const ang = ctx.closed ? 0 : -30;
    return (
      ln(0, -30, 0, -12, C.ink) + ln(0, 12, 0, 30, C.ink) +
      dot(0, -12, 2.4, C.ink) + dot(0, 12, 2.4, C.ink) +
      `<g transform="rotate(${ang} 0 12)">${ln(0, 12, 0, -11, C.ink, 2.8)}</g>`
    );
  },
  switch2way(t, ctx) {
    const toB = ctx.state === 'b';
    const bladeEnd = toB ? 'M 0 -14 L 26 14' : 'M 0 -14 L -26 14';
    return (
      ln(0, -30, 0, -14, C.ink) + ln(-28, 14, -28, 30, C.ink) + ln(28, 14, 28, 30, C.ink) +
      dot(0, -14, 2.4, C.ink) + dot(-28, 14, 2.2, C.ink) + dot(28, 14, 2.2, C.ink) +
      path(bladeEnd, C.ink, 2.8)
    );
  },

  /** 隔离开关 QS：触点上带一小横杠（国标隔离特征），明显断开间隙 */
  isolator1(t, ctx) {
    const ang = ctx.closed ? 0 : -32;
    return (
      ln(0, -30, 0, -13, C.ink) + ln(0, 13, 0, 30, C.ink) +
      dot(0, -13, 2.2, C.ink) +
      `<g transform="rotate(${ang} 0 13)">${ln(0, 13, 0, -11, C.ink, 2.6)}</g>` +
      ln(-6, -13, 6, -13, C.ink, THIN) + // 隔离横杠
      ln(-5, 13, 5, 13, C.ink, THIN)     // 静触头座
    );
  },
  isolator3(t, ctx) {
    const xs = [-80, 0, 80];
    const ang = ctx.closed ? 0 : -32;
    return xs.map((x) => `
      ${ln(x, -30, x, -13, C.ink)} ${ln(x, 13, x, 30, C.ink)} ${dot(x, -13, 2.2, C.ink)}
      <g transform="rotate(${ang} ${x} 13)">${ln(x, 13, x, -11, C.ink, 2.5)}</g>
      ${ln(x - 6, -13, x + 6, -13, C.ink, THIN)} ${ln(x - 5, 13, x + 5, 13, C.ink, THIN)}`
    ).join('') + mechLink(xs, 22);
  },

  /** 按钮（常开/常闭）：国标上方推杆 + 桥式触点 */
  button_no(t, ctx) {
    return contactPole(0, ctx.closed, { color: C.ink }) + buttonCap(ctx.pressed);
  },
  button_nc(t, ctx) {
    return contactPole(0, ctx.closed, { nc: true, color: C.ink }) + buttonCap(ctx.pressed);
  },
  /** 复合按钮 SB：一组常闭（左）+ 一组常开（右），共用推杆 */
  button_comp(t, ctx) {
    const pressed = !!ctx.pressed;
    return (
      contactPole(-22, !pressed, { nc: true, color: C.ink }) +
      contactPole(22, pressed, { color: C.ink }) +
      buttonCap(pressed) +
      ln(-22, -28, 22, -28, C.muted, 1.1, 'stroke-dasharray="3 2"')
    );
  },
  /** 急停按钮 SB：常闭触点 + 蘑菇头（带圆圈），按下断开 */
  button_estop(t, ctx) {
    const pressed = !!ctx.pressed;
    return (
      contactPole(0, !pressed, { nc: true, color: C.danger }) +
      ln(0, -25, 0, -32, C.danger, THIN) +
      `<circle cx="0" cy="-36" r="7" fill="${C.panel}" stroke="${C.danger}" stroke-width="2"/>` +
      ln(-4, -36, 4, -36, C.danger, 1.4)
    );
  },

  /** 行程开关 SQ（常开/常闭）：触点 + 上方滚轮三角标记 */
  limit_no(t, ctx) {
    return contactPole(0, ctx.closed, { color: C.ink }) + limitRoller(0);
  },
  limit_nc(t, ctx) {
    return contactPole(0, ctx.closed, { nc: true, color: C.ink }) + limitRoller(0);
  },
  /** 行程开关复合触头：常闭（左）+ 常开（右）——是否压下只看 state，避免常闭组导通误判 */
  limit_comp(t, ctx) {
    const on = ctx.state === 'closed';
    return (
      contactPole(-22, !on, { nc: true, color: C.ink }) +
      contactPole(22, on, { color: C.ink }) +
      limitRoller(-22) + limitRoller(22) +
      ln(-22, -28, 22, -28, C.muted, 1.1, 'stroke-dasharray="3 2"')
    );
  },

  /** 线圈（KM/KA/KT 通用）：国标宽扁空白矩形；得电时填充暖色 */
  coil(t, ctx) {
    const on = ctx.energized;
    const color = on ? C.coilOn : C.ink;
    return (
      ln(0, -36, 0, -11, color) + ln(0, 11, 0, 36, color) +
      coilRect(on ? '#fdf1dc' : C.panel, color) +
      (on ? dot(16, -8, 3, C.coilOn) : '')
    );
  },
  /** 时间继电器通电延时（缓吸）线圈 KT：矩形内画 × （国标） */
  coil_timer_on(t, ctx) {
    const on = ctx.energized;
    const color = on ? C.coilOn : C.ink;
    return (
      ln(0, -36, 0, -11, color) + ln(0, 11, 0, 36, color) +
      coilRect(on ? '#fdf1dc' : C.panel, color) +
      ln(-6, -6, 6, 6, color, THIN) + ln(-6, 6, 6, -6, color, THIN)
    );
  },
  /** 时间继电器断电延时（缓放）线圈 KT：矩形内实心黑块（国标） */
  coil_timer_off(t, ctx) {
    const on = ctx.energized;
    const color = on ? C.coilOn : C.ink;
    return (
      ln(0, -36, 0, -11, color) + ln(0, 11, 0, 36, color) +
      coilRect(on ? '#fdf1dc' : C.panel, color) +
      rect(-7, -6, 14, 12, color, color, 1)
    );
  },

  contact_no(t, ctx) { return contactPole(0, ctx.closed); },
  contact_nc(t, ctx) { return contactPole(0, ctx.closed, { nc: true }); },
  /** 接触器常开主触头（三极）：带国标灭弧小弧 */
  contact3_no(t, ctx) {
    const xs = [-80, 0, 80];
    return xs.map((x) => contactPole(x, ctx.closed, { arc: true })).join('') + mechLink(xs, 24);
  },

  /** 热继电器常闭触点 KH/FR：常闭触点 + 热脱扣小标记 */
  thermal_nc(t, ctx) {
    const color = ctx.tripped ? C.danger : C.ink;
    return contactPole(0, ctx.closed, { nc: true, color }) + txt(12, -12, 'FR', { size: 8.5, fill: color });
  },
  /** 热元件（单极）KH：国标为横向扁矩形，内一段双金属片折线「⊏」 */
  thermal1(t, ctx) {
    return (
      ln(0, -30, 0, -10, C.ink) + ln(0, 10, 0, 30, C.ink) +
      rect(-16, -10, 32, 20, C.panel, C.ink, 2) +
      path('M -9 -4 L 9 -4 M 0 -4 L 5 5', C.inkSoft, 1.5)
    );
  },
  /** 热元件（三极）KH：三个横向扁矩形 + 双金属片折线 */
  thermal3(t, ctx) {
    const xs = [-80, 0, 80];
    return xs.map((x) => `
      ${ln(x, -30, x, -10, C.ink)} ${ln(x, 10, x, 30, C.ink)}
      ${rect(x - 16, -10, 32, 20, C.panel, C.ink, 2)}
      ${path(`M ${n(x - 9)} -4 L ${n(x + 9)} -4 M ${n(x)} -4 L ${n(x + 5)} 5`, C.inkSoft, 1.5)}`
    ).join('') + mechLink(xs, 22);
  },

  /** 时间继电器通电延时触点（∩ 伞弧） */
  kt_no(t, ctx) { return contactPole(0, ctx.closed, { delay: true, delayFlip: false }); },
  kt_nc(t, ctx) { return contactPole(0, ctx.closed, { nc: true, delay: true, delayFlip: false }); },
  /** 时间继电器断电延时触点（∪ 伞弧翻转） */
  kt_off_no(t, ctx) { return contactPole(0, ctx.closed, { delay: true, delayFlip: true }); },
  kt_off_nc(t, ctx) { return contactPole(0, ctx.closed, { nc: true, delay: true, delayFlip: true }); },

  /** 照明灯 EL：国标圆圈内 × */
  lamp(t, ctx) {
    const on = ctx.lit;
    return (
      ln(0, -36, 0, -20, on ? C.amber : C.ink) + ln(0, 20, 0, 36, on ? C.amber : C.ink) +
      (on ? `<circle cx="0" cy="0" r="34" fill="${C.lampGlow}"/>` : '') +
      `<circle cx="0" cy="0" r="20" fill="${on ? C.lampOn : C.panel}" stroke="${on ? '#b8860b' : C.ink}" stroke-width="2.2"/>` +
      ln(-12, -12, 12, 12, on ? '#8a6208' : C.ink, 1.8) + ln(-12, 12, 12, -12, on ? '#8a6208' : C.ink, 1.8)
    );
  },
  /** 信号灯 / 指示灯 HL：国标同为圆圈内 ×，得电时着色 */
  lamp_signal(t, ctx) {
    const on = ctx.lit;
    const color = on ? C.amber : C.ink;
    return (
      ln(0, -30, 0, -16, color) + ln(0, 16, 0, 30, color) +
      `<circle cx="0" cy="0" r="16" fill="${on ? C.lampOn : C.panel}" stroke="${color}" stroke-width="2.2"/>` +
      ln(-9, -9, 9, 9, color, 1.7) + ln(-9, 9, 9, -9, color, 1.7)
    );
  },

  tube(t, ctx) {
    const on = ctx.lit;
    return (
      ln(0, -56, 0, -46, on ? C.amber : C.ink) + ln(0, 46, 0, 56, on ? C.amber : C.ink) +
      (on ? `<rect x="-26" y="-56" width="52" height="112" rx="14" fill="rgba(160,220,255,.45)"/>` : '') +
      rect(-13, -46, 26, 92, on ? '#eaf7ff' : C.panel, on ? '#4a9fd4' : C.ink, 2.2, 13) +
      ln(-9, -38, 9, -38, on ? '#4a9fd4' : C.inkSoft, 1.4) + ln(-9, 38, 9, 38, on ? '#4a9fd4' : C.inkSoft, 1.4) +
      (on ? `<rect x="-8" y="-34" width="16" height="68" rx="8" fill="#dff1fb"/>` : '')
    );
  },
  inductor(t, ctx) {
    let d = 'M 0 -36 L 0 -32';
    for (let i = 0; i < 4; i += 1) {
      const y = -32 + i * 12;
      d += ` A 7 7 0 0 1 0 ${y + 12}`;
    }
    return ln(0, -44, 0, -36, C.ink) + path(d, C.ink, 2.2) + ln(0, 20, 0, 44, C.ink);
  },
  starter(t, ctx) {
    return (
      ln(0, -26, 0, -12, C.inkSoft) + ln(0, 12, 0, 26, C.inkSoft) +
      `<circle cx="0" cy="0" r="12" fill="${C.panel}" stroke="${C.inkSoft}" stroke-width="2"/>` +
      txt(0, 4, 'S', { size: 11, weight: 700, fill: C.inkSoft })
    );
  },

  /** 三相异步电动机 M：国标「圆圈内 M，下注 3~」，三条引线由引脚径向接入 */
  motor3(t, ctx) {
    const on = ctx.running;
    const color = on ? C.motorOn : C.ink;
    const pins = (t?.pins || [{ x: -80, y: -44 }, { x: 0, y: -44 }, { x: 80, y: -44 }]).map((p) => [p.x, p.y]);
    return (
      pins.map(([x, y]) => radialLead(x, y, 50, color)).join('') +
      (on ? `<circle cx="0" cy="0" r="63" fill="rgba(31,157,85,.10)"/>` : '') +
      `<circle cx="0" cy="0" r="50" fill="${C.panel}" stroke="${color}" stroke-width="2.4"/>` +
      txt(0, -2, 'M', { size: 26, weight: 700, fill: color }) +
      txt(0, 20, '3~', { size: 13, weight: 600, fill: color }) +
      (on ? rotationMark(ctx.direction) : '')
    );
  },
  /** 三相异步电动机（六端子）：上下各三条径向引线 */
  motor6(t, ctx) {
    const on = ctx.running;
    const color = on ? C.motorOn : C.ink;
    const pins = (t?.pins || []).map((p) => [p.x, p.y]);
    return (
      pins.map(([x, y]) => radialLead(x, y, 50, color)).join('') +
      (on ? `<circle cx="0" cy="0" r="63" fill="rgba(31,157,85,.10)"/>` : '') +
      `<circle cx="0" cy="0" r="50" fill="${C.panel}" stroke="${color}" stroke-width="2.4"/>` +
      txt(0, -2, 'M', { size: 26, weight: 700, fill: color }) +
      txt(0, 20, '3~', { size: 13, weight: 600, fill: color }) +
      (on ? rotationMark(ctx.direction) : '')
    );
  },
  /** 直流电动机 M：圆圈内 M，旁边一小段励磁绕组（国标他励/并励示意） */
  motor_dc(t, ctx) {
    // 直流电机按「两端通电即运转」处理（role=load），故同时接受 running / energized
    const on = ctx.running || ctx.energized;
    const color = on ? C.motorOn : C.ink;
    const pins = (t?.pins || []).map((p) => [p.x, p.y]);
    return (
      pins.map(([x, y]) => radialLead(x, y, 30, color)).join('') +
      `<circle cx="0" cy="0" r="30" fill="${C.panel}" stroke="${color}" stroke-width="2.4"/>` +
      txt(0, 7, 'M', { size: 24, weight: 700, fill: color }) +
      winding(16, -10, 10, 1, color) +
      (on ? rotationMark(ctx.direction) : '')
    );
  },

  /** 单相变压器 TC：两组绕组 + 中间铁芯双竖线（原副边电气隔离） */
  transformer1(t, ctx) {
    return (
      ln(-18, -40, -18, -30, C.ink) + ln(-18, 30, -18, 40, C.ink) +
      ln(18, -40, 18, -30, C.ink) + ln(18, 30, 18, 40, C.ink) +
      winding(-18, -30, 30, 1, C.ink) + winding(18, -30, 30, -1, C.ink) +
      core()
    );
  },
  /** 三相变压器 TM：三组绕组并列，简化为三对线圈 + 铁芯 */
  transformer3(t, ctx) {
    const xs = [-46, 0, 46];
    let out = '';
    for (const x of xs) {
      out += ln(x - 12, -40, x - 12, -28, C.ink) + ln(x - 12, 28, x - 12, 40, C.ink) +
        ln(x + 12, -40, x + 12, -28, C.ink) + ln(x + 12, 28, x + 12, 40, C.ink) +
        winding(x - 12, -28, 28, 1, C.ink) + winding(x + 12, -28, 28, -1, C.ink) +
        ln(x - 3, -28, x - 3, 28, C.ink, THIN) + ln(x + 3, -28, x + 3, 28, C.ink, THIN);
    }
    return out + mechLink([-46, 0, 46], 34);
  },

  /**
   * 插座 XS / 插头 XP：国标「半圆弧 + 粗触片」符号旋转 90° 竖向使用，
   * 与 socket_1p 的上下接线端子 (0,±36) 严格对齐（国标符号允许旋转使用）。
   * 国标图形符号本身不带文字符号（XS/XP 是单独标注的文字符号），
   * 因此这里不内嵌字母，交给元件编号 label 承担。
   */
  socket(t, ctx) {
    const on = ctx.energized;
    const color = on ? C.amber : C.ink;
    return (
      ln(0, -36, 0, -12, color, 2.4) + ln(0, 12, 0, 36, color, 2.4) +
      path('M 0 -12 A 12 12 0 0 1 0 12', color, 2.2) +   // 右半圆凹口
      ln(-6, -12, -6, 12, color, 2.6)                      // 插座触片粗竖线
    );
  },
  plug(t, ctx) {
    const on = ctx.energized;
    const color = on ? C.amber : C.ink;
    return (
      ln(0, -36, 0, -12, color, 2.4) + ln(0, 12, 0, 36, color, 2.4) +
      path('M 0 -12 A 12 12 0 0 0 0 12', color, 2.2) +   // 左半圆凸头
      ln(6, -12, 6, 12, color, 2.6)                        // 插针粗竖线
    );
  },

  terminal(t, ctx) {
    return (
      ln(0, -20, 0, -8, C.ink) + ln(0, 8, 0, 20, C.ink) +
      `<circle cx="0" cy="0" r="7" fill="${C.panel}" stroke="${C.ink}" stroke-width="2"/>`
    );
  },
  terminal_pwr(t, ctx) {
    return ln(0, 6, 0, 20, C.ink) + `<circle cx="0" cy="0" r="5" fill="${C.panel}" stroke="${C.ink}" stroke-width="2.4"/>`;
  },
  prox(t, ctx) {
    return contactPole(0, ctx.closed, { nc: !!t?.nc }) +
      `<path d="M 0 -26 L 8 -34 L 0 -42 L -8 -34 Z" fill="${C.panel}" stroke="${C.ink}" stroke-width="1.6"/>`;
  },
};

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
