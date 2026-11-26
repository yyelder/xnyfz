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
 * 时间继电器延时触点的国标「半圆弧（伞形）」限定符号（GB/T 4728 附录）。
 * 伞弧凸向「被延时的那个动作方向」，因此凸向由「延时类型 + 动合/动断」共同决定：
 *   动合触点闭合方向向左、动断触点闭合方向向右；
 *   延时闭合 → 凸向闭合方向；延时断开 → 凸向断开方向。
 *     ┌────────┬────────┬────────┐
 *     │        │ 延时闭合│ 延时断开│
 *     │ 动合NO │  凸左  │  凸右  │
 *     │ 动断NC │  凸右  │  凸左  │
 *     └────────┴────────┴────────┘
 * 半圆弧整体向凸向一侧让开 ARC_GAP，与动触点竖线之间留出明显空隙（弦不贴本体）：
 * 弧的开口朝向动触点，弧两端各带一小段「向外撇」的斜短划（国标箭头感），
 * 弧心处用一条短横「伞柄」从弦跨过空隙接到动触点上，形成国标「伞形」。
 * 伞柄止于动触点上（斜置时不越过触点本体），下端不会从触点右侧支出来。
 * 弧线/伞柄/斜划都用与本体同级的线宽，缩小到教学画布尺寸时仍然清楚。
 * data-delay / data-delay-bulge / data-arc-gap 供正确性单测与后续交互识别。
 */
const ARC_GAP = 9;    // 弦与动触点竖线的水平间距（伞弧不贴本体）
const ARC_R = 6.5;    // 半圆弧半径
const ARC_END = 3;    // 弧两端斜短划长度（45° 向外撇）
const ARC_W = 2.0;    // 伞弧线宽
const ARC_CY = 0;     // 弧心高度：与本体中部齐平，弧身与斜置的动触点保持等距间隙
function timerDelayMark(x, bulge, delayKind = null, color = C.ink, tiltDeg = 0) {
  if (bulge !== 'left' && bulge !== 'right') return '';
  const cy = ARC_CY;
  const r = ARC_R;
  const dir = bulge === 'left' ? -1 : 1;          // 凸向
  const sweep = bulge === 'left' ? 0 : 1;
  const chordX = x + dir * ARC_GAP;               // 弦（两弧端所在竖线），与竖线保持间隙
  const arc = path(`M ${n(chordX)} ${n(cy - r)} A ${r} ${r} 0 0 ${sweep} ${n(chordX)} ${n(cy + r)}`, color, ARC_W);
  // 伞柄终点：动触点在该高度上的实际位置（斜置触点不会伸到竖线右侧）
  const endX = x + Math.tan((tiltDeg * Math.PI) / 180) * (11 - cy);
  const stem = ln(chordX, cy, endX, cy, color, ARC_W);
  const d = ARC_END * 0.7071;
  const cap1 = ln(chordX, cy - r, chordX + dir * d, cy - r - d, color, ARC_W); // 上端斜划朝弧外侧上撇
  const cap2 = ln(chordX, cy + r, chordX + dir * d, cy + r + d, color, ARC_W); // 下端斜划朝弧外侧下撇
  return `<g class="timer-delay" data-delay="${delayKind || ''}" data-delay-bulge="${bulge}" data-arc-gap="${ARC_GAP}">${arc}${stem}${cap1}${cap2}</g>`;
}

/** 由「延时类型 + 动合/动断」推导国标伞弧凸向（见 timerDelayMark 说明） */
function delayBulge(delayKind, nc) {
  if (delayKind !== 'close' && delayKind !== 'open') return null;
  return (delayKind === 'close') === !nc ? 'left' : 'right';
}

/**
 * 时间继电器专用触点（对齐用户提供的国标符号表）：
 *  - 动合（常开）：动触点为斜线，断开时明显倾斜；
 *  - 动断（常闭）：动触点顶端带国标小折钩（随动触点一起旋转）；
 *  - delayKind：'close' 延时闭合 / 'open' 延时断开 / null 瞬动（无伞弧）。
 * 引脚仍在 ±28，与 device-types.json 中 KT 触点的 pins 一致。
 */
const TILT = 18;   // 延时触点断开时动触点的倾斜角
function timerContact(x, closed, { nc = false, delayKind = null, color = C.ink } = {}) {
  // 动触点断开时朝伞弧一侧倾倒（左凸向左、右凸向右），伞柄才不会横穿触点本体
  const tilt = delayKind && delayBulge(delayKind, nc) === 'right' ? TILT : -TILT;
  const angle = closed ? 0 : tilt;
  const out = [];
  out.push(ln(x, -28, x, -11, color));   // 静触点引线
  out.push(dot(x, -11, 2.2, color));     // 静触点
  out.push(ln(x, 11, x, 28, color));     // 动触点引线
  const blade = [ln(x, 11, x, -10.5, color, 2.6)];
  if (nc) {
    // 动断触点：动触点顶端一条水平横杠 + 上方短竖（国标动断特征，区别于延时伞弧）
    blade.push(ln(x - 6, -10.5, x + 6, -10.5, color, THIN));
    blade.push(ln(x, -10.5, x, -5, color, THIN));
  }
  out.push(`<g class="timer-blade" data-nc="${nc ? 1 : 0}" transform="rotate(${angle} ${n(x)} 11)">${blade.join('')}</g>`);
  if (delayKind) out.push(timerDelayMark(x, delayBulge(delayKind, nc), delayKind, color, closed ? 0 : tilt));
  return out.join('');
}

/** 接触器主触头的灭弧小圆弧（国标常开主触头顶端带一小弧） */
function arcMark(x, y = -14, color = C.ink) {
  return path(`M ${n(x - 5)} ${n(y)} Q ${n(x)} ${n(y - 6)} ${n(x + 5)} ${n(y)}`, color, THIN);
}

/** 竖直单极触点：柱 x，本体 y ∈ [-11, 11]，引脚在 ±28。
 *  nc        —— 常闭：定触点处加一小横杠（国标辅助常闭触点的斜 T 标记）
 *  delayKind —— 延时触点：'close' / 'open'，加国标半圆弧伞形标记
 *  arc       —— 主触头：顶端加灭弧小弧
 */
function contactPole(x, closed, { nc = false, delayKind = null, arc = false, color = C.ink } = {}) {
  const bladeAngle = closed ? 0 : -30;
  const out = [];
  out.push(ln(x, -28, x, -11, color));
  out.push(ln(x, 11, x, 28, color));
  out.push(dot(x, -11, 2.2, color));
  out.push(`<g transform="rotate(${bladeAngle} ${n(x)} 11)">${ln(x, 11, x, -10.5, color, 2.6)}</g>`);
  if (nc) out.push(ln(x - 6, -11, x + 6, -11, color, THIN));
  if (arc) out.push(arcMark(x, -15, color));
  if (delayKind) out.push(timerDelayMark(x, delayBulge(delayKind, nc), delayKind, color));
  return out.join('');
}

/** 三极电气联锁虚线 */
function mechLink(xs, y, color = C.muted) {
  if (xs.length < 2) return '';
  return `<line x1="${n(xs[0])}" y1="${n(y)}" x2="${n(xs[xs.length - 1])}" y2="${n(y)}" stroke="${color}" stroke-width="1.2" stroke-dasharray="4 3"/>`;
}

/**
 * 热元件的双金属片（国标：框内导体向左折一级的阶梯）
 * 居中于 x，自 yTop 进入框体、向左让出 14 的台阶、再回到 x 穿出 yBot。
 */
function bimetalStep(x, yTop, yBot, color = C.ink, w = 20) {
  const half = 12;
  return `<path class="bimetal" data-x="${n(x)}" data-step="${n(w)}" d="M ${n(x)} ${n(yTop)} L ${n(x)} ${n(-half)} ` +
    `L ${n(x - w)} ${n(-half)} L ${n(x - w)} ${n(half)} L ${n(x)} ${n(half)} L ${n(x)} ${n(yBot)}" ` +
    `fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/**
 * 热继电器触点的双金属片标记（国标「⊏」形，开口朝外）：
 * 竖片在内侧（x=24），上下两条短臂向右折到外缘（x=34）；
 * 常开、常闭两个触点方向一致（都朝右），虚线自刀身横穿后止于竖片。
 */
const FR_MARK_X = 34;    // 标记外缘
const FR_MARK_H = 12;    // 标记上下臂的半高
const FR_MARK_ARM = 10;  // 臂长（开口深度）
const FR_MARK_INNER = FR_MARK_X - FR_MARK_ARM;
function thermalMark(color = C.ink) {
  return (
    `<g class="thermal-mark" data-side="right" data-open="right" data-x="${n(FR_MARK_INNER)}">` +
    ln(FR_MARK_INNER, -FR_MARK_H, FR_MARK_INNER, FR_MARK_H, color, 2) +
    ln(FR_MARK_INNER, -FR_MARK_H, FR_MARK_X, -FR_MARK_H, color, 2) +
    ln(FR_MARK_INNER, FR_MARK_H, FR_MARK_X, FR_MARK_H, color, 2) +
    `</g>`
  );
}

/**
 * 热继电器辅助触点（国标 FR 画法，比接触器辅助触点更平缓）：
 *  - 静触头自上引脚竖直下来；常闭型末端再向右折一小段短路片（FR_BAR）；
 *  - 斜刀绕下引脚铰接，刀长 22.5、倾角 21°：常开断态向左倒（刀尖停在上引线左侧），
 *    常闭闭合态向右倒，刀身斜穿短路片中部、刀尖落在片端以内，左侧不再留悬空断口；
 *  - 常闭断开时斜刀反向倒向左侧 21°，与短路片脱开。
 */
const FR_TILT = 21;      // 斜刀倾角
const FR_BAR = 12;       // 常闭短路片长度
const FR_BAR_Y = -6;     // 短路片高度（静触头末端）
const FR_BLADE = 22.5;   // 刀长

function thermalContact(x, closed, { nc = false, color = C.ink } = {}) {
  const ang = nc ? (closed ? FR_TILT : -FR_TILT) : (closed ? 0 : -FR_TILT);
  const a = (Math.abs(ang) * Math.PI) / 180;
  const dir = ang >= 0 ? 1 : -1;
  const sx = x + dir * FR_BLADE * Math.sin(a);
  const sy = 10 - FR_BLADE * Math.cos(a);
  const out = [];
  if (nc) {
    out.push(ln(x, -28, x, FR_BAR_Y, color));                              // 静触头
    out.push(ln(x, FR_BAR_Y, x + FR_BAR, FR_BAR_Y, color, 2.2, 'class="contact-bar"')); // 短路片
  } else {
    out.push(ln(x, -28, x, -9, color));                                    // 静触头（无节点圆点）
  }
  out.push(ln(x, 10, x, 28, color));                                       // 下引线
  out.push(ln(x, 10, sx, sy, color, 2.6, 'class="fr-blade"'));             // 斜刀
  return {
    svg:
      `<g class="blade-contact fr-contact" data-nc="${nc ? 1 : 0}" data-angle="${n(ang)}" ` +
      `data-tip="${n(sx)},${n(sy)}" data-bar="${nc ? FR_BAR : 0}">${out.join('')}</g>`,
    tipX: sx,
    tipY: sy,
    // 刀身与 y=0（虚线高度）的交点，用来让虚线左端始终只比刀身多出 12
    crossX: x + (sx - x) * (10 / Math.max(1e-6, 10 - sy)),
  };
}

/** 热元件驱动的虚线：自刀身左侧 12 处横穿，止于右侧标记 */
function thermalLink(crossX, color = C.inkSoft) {
  return ln(crossX - 12, 0, FR_MARK_INNER, 0, color, 1.2, 'class="thermal-link" stroke-dasharray="4 3"');
}

/** 斜刀在高度 y 处的横坐标（断路器极间点线的落点） */
function bladeXAt(x, angleDeg, y) {
  return x + (12 - y) * Math.tan((angleDeg * Math.PI) / 180);
}

/**
 * 断路器（空气开关）单极：静触头端画「×」（自动脱扣标记），斜刀绕下引脚摆动。
 * 空气开关在图纸上以斜刀表示，脱扣后整只变红。
 */
function breakerPole(x, closed, color = C.ink) {
  const ang = closed ? 0 : NO_OPEN;
  const cy = -11;
  const c = 5; // × 半臂长
  return (
    `<g class="breaker-pole" data-x="${n(x)}" data-angle="${n(ang)}">` +
    ln(x, -32, x, -16, color) +
    ln(x - c, cy - c, x + c, cy + c, color, 2) +
    ln(x - c, cy + c, x + c, cy - c, color, 2) +
    ln(x, 12, x, 32, color) +
    `<g transform="rotate(${ang} ${n(x)} 12)">${ln(x, 12, x, -7, color, 2.6)}</g>` +
    `</g>`
  );
}

/** 断路器各极之间的脱扣联动（国标用点线） */
function breakerLink(xs, closed, color = C.muted) {
  if (xs.length < 2) return '';
  const ang = closed ? 0 : NO_OPEN;
  const y = 2;
  const x1 = bladeXAt(xs[0], ang, y);
  const x2 = bladeXAt(xs[xs.length - 1], ang, y);
  return `<line class="breaker-link" x1="${n(x1)}" y1="${n(y)}" x2="${n(x2)}" y2="${n(y)}" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="1.6 3.6"/>`;
}

/**
 * 斜刀式触点（按钮 SB 与行程开关 SQ 共用，对齐国标符号表）：
 *  - 静触点自上引脚竖直下来；常闭型末端水平折出一小段「短路片」；
 *  - 动触点是一把绕下引脚（y=11）铰接的斜刀：常开常态朝左倾倒、离开静触点，
 *    常闭常态朝短路片一侧倾倒，闭合时刀尖正好压住片端；
 *  - 铰点向下补一条短竖线（y=11 → y=28），把斜刀接到下接线引脚，不留悬空端；
 *  - mirror：把常闭的短路片与倾倒方向镜像到左侧（复合型左侧那一组用）；
 *  - actuator：刀身中段挂一小三角（行程开关的撞块/操作件，随刀一起摆动）。
 */
const BLADE_TILT = 28;   // 斜刀常态倾斜角
const BLADE_LEN = 21;    // 刀长（自铰点算起）
function bladePoint(x, angleDeg, s = BLADE_LEN) {
  const a = (angleDeg * Math.PI) / 180;
  return [x + s * Math.sin(a), 11 - s * Math.cos(a)];
}
/** 斜刀与 y=0 水平线的交点横坐标（机械联动虚线落在这里） */
function bladeCrossX(x, angleDeg) {
  return x + 11 * Math.tan((angleDeg * Math.PI) / 180);
}
/** 撞块小三角的左侧尖点（复合型用虚线把两组尖点连起来） */
function actuatorApex(x, angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  const [vx, vy] = bladePoint(x, angleDeg, 12);
  return [vx - 8 * Math.cos(a), vy - 8 * Math.sin(a)];
}
function bladeContact(x, closed, { nc = false, mirror = false, actuator = false, color = C.ink } = {}) {
  const side = mirror ? -1 : 1;
  const closedAngle = nc ? side * BLADE_TILT : 0;
  const openAngle = nc ? -side * BLADE_TILT * 0.62 : -BLADE_TILT;
  const angle = closed ? closedAngle : openAngle;
  const out = [];
  if (nc) {
    const [tx, ty] = bladePoint(x, closedAngle);
    out.push(ln(x, -28, x, ty, color));        // 静触点
    out.push(ln(x, ty, tx, ty, color, 2.2, 'class="contact-bar"')); // 短路片：刀尖搭在片端
  } else {
    out.push(ln(x, -28, x, -10, color));
  }
  const [bx, by] = bladePoint(x, angle);
  out.push(ln(x, 11, x, 28, color));                            // 下引线：铰点短竖线接到下接线引脚
  out.push(ln(x, 11, bx, by, color, 2.6, 'class="blade"'));   // 斜刀
  const [px, py] = actuatorApex(x, angle);
  if (actuator) {
    const [ax, ay] = bladePoint(x, angle, 2);
    const [ux, uy] = bladePoint(x, angle, 12);
    out.push(`<path class="limit-actuator" d="M ${n(ax)} ${n(ay)} L ${n(px)} ${n(py)} L ${n(ux)} ${n(uy)}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"/>`);
  }
  const svg =
    `<g class="blade-contact" data-nc="${nc ? 1 : 0}" data-mirror="${mirror ? 1 : 0}" data-angle="${n(angle)}" ` +
    `data-x="${n(x)}" data-tip="${n(bx)},${n(by)}" data-apex="${n(px)},${n(py)}">${out.join('')}</g>`;
  return { svg, angle, tipX: bx, tipY: by, apexX: px, apexY: py };
}

/**
 * 辅助触点（接触器 KM / 中间继电器 KA / 时间继电器瞬动，对齐国标符号表）：
 *  - 常开：上静触头竖直下来即止，动触点为绕下引脚（y=10）铰接的斜刀，
 *    断态朝左倾倒 30°，闭合时回正搭到静触头下端；
 *  - 常闭：上静触头末端向右折出一段水平「短路片」（长 NC_BAR），
 *    动触点以 40° 斜穿短路片、刀尖略高于片且停在片端以内（国标画法），
 *    断开时斜刀退回左侧 22°；
 *  - 两者都不画实心节点圆点（国标辅助触点不带节点）。
 * data-nc / data-angle / data-bar / data-tip 供正确性单测。
 */
const NC_BAR = 18;       // 常闭短路片长度
const NC_CLOSED = 40;    // 常闭闭合时斜刀角（向右）
const NC_OPEN = -22;     // 常闭断开时斜刀角（向左）
const NO_OPEN = -30;     // 常开断态斜刀角

function bladeTo(x, angleDeg, len) {
  const a = (Math.abs(angleDeg) * Math.PI) / 180;
  const dir = angleDeg >= 0 ? 1 : -1;
  return [x + dir * len * Math.sin(a), 10 - len * Math.cos(a)];
}

function auxContact(x, closed, { nc = false, color = C.ink } = {}) {
  if (nc) {
    const ang = closed ? NC_CLOSED : NC_OPEN;
    const [tx, ty] = bladeTo(x, ang, 25);
    const out = [
      ln(x, -28, x, -7, color),                                        // 静触头
      ln(x, -7, x + NC_BAR, -7, color, 2.2, 'class="contact-bar"'),    // 短路片
      ln(x, 10, x, 28, color),                                         // 下引线
      ln(x, 10, tx, ty, color, 2.6, 'class="nc-blade"'),               // 斜刀
    ];
    return `<g class="aux-contact" data-nc="1" data-angle="${n(ang)}" data-bar="${NC_BAR}" data-tip="${n(tx)},${n(ty)}">${out.join('')}</g>`;
  }
  const ang = closed ? 0 : NO_OPEN;
  const [tx, ty] = bladeTo(x, ang, 20);
  const out = [
    ln(x, -28, x, -9, color),                       // 静触头（无节点圆点）
    ln(x, 10, x, 28, color),                        // 下引线
    ln(x, 10, tx, ty, color, 2.6, 'class="no-blade"'), // 斜刀
  ];
  return `<g class="aux-contact" data-nc="0" data-angle="${n(ang)}" data-tip="${n(tx)},${n(ty)}">${out.join('')}</g>`;
}

/**
 * 接触器主触头（三极）：静触头下端带国标小方钩（灭弧罩），
 * 动触点为长斜刀自下引脚铰接，断开 30°、闭合回正顶住钩底。
 */
function mainContactPole(x, closed, color = C.ink) {
  const ang = closed ? 0 : NO_OPEN;
  const hook = path(
    `M ${n(x)} ${n(-17)} L ${n(x - 6.5)} ${n(-17)} L ${n(x - 6.5)} ${n(-26)} L ${n(x)} ${n(-26)}`,
    color, 2
  );
  return (
    `<g class="main-contact" data-angle="${n(ang)}" data-x="${n(x)}">` +
    ln(x, -30, x, -17, color) + hook +
    ln(x, 12, x, 30, color) +
    `<g transform="rotate(${ang} ${n(x)} 12)">${ln(x, 12, x, -17, color, 2.6)}</g>` +
    `</g>`
  );
}

/**
 * 按钮操作件（国标：左侧「E」形推杆 + 虚线机械联动到动触点）。
 * E 形 = 竖杆 + 上下两条长横 + 中间一条短横，短横之后用虚线接到刀身。
 * 按下时整只操作件右移，推杆把斜刀顶过去。
 */
function buttonActuator(cx, endX, color = C.ink, pressed = false) {
  const x = cx + (pressed ? 4 : 0);
  return (
    `<g class="button-actuator" data-pressed="${pressed ? 1 : 0}" data-x="${n(x)}" data-end="${n(endX)}">` +
    ln(x, -16, x, 10, color, 2.1) +              // 竖杆
    ln(x, -16, x + 12, -16, color, 2.1) +        // 上横
    ln(x, 10, x + 12, 10, color, 2.1) +          // 下横
    ln(x, 0, x + 6, 0, color, 2.1) +             // 中横（推杆）
    ln(x + 9, 0, endX, 0, color, 1.2, 'class="link-rod" stroke-dasharray="3 2.6"') +
    `</g>`
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
  /**
   * 断路器（空气开关）单极：静触头处画「×」（自动脱扣标记），动触点为斜刀，
   * 断开时朝左倾倒 30°，闭合时回正顶到 × 下方。
   */
  breaker1(t, ctx) {
    const color = ctx.tripped ? C.danger : C.ink;
    return breakerPole(0, ctx.closed, color);
  },
  /** 断路器两极：两极之间用点线（脱扣联动）相连 */
  breaker2(t, ctx) {
    const color = ctx.tripped ? C.danger : C.ink;
    const xs = [-24, 24];
    return xs.map((x) => breakerPole(x, ctx.closed, color)).join('') + breakerLink(xs, ctx.closed, color);
  },
  breaker3(t, ctx) {
    const color = ctx.tripped ? C.danger : C.ink;
    const xs = [-80, 0, 80];
    return xs.map((x) => breakerPole(x, ctx.closed, color)).join('') + breakerLink(xs, ctx.closed, color);
  },
  rcd2(t, ctx) {
    const color = ctx.tripped ? C.danger : C.ink;
    return symbols.breaker2(t, ctx) + txt(0, 28, 'RCD', { size: 8, fill: color });
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

  /** 按钮（常开/常闭）：国标斜刀触点 + 左侧 E 形操作件 */
  button_no(t, ctx) {
    const pressed = !!ctx.pressed;
    const r = bladeContact(0, pressed);
    return r.svg + buttonActuator(-30, bladeCrossX(0, r.angle), C.ink, pressed);
  },
  button_nc(t, ctx) {
    const pressed = !!ctx.pressed;
    const r = bladeContact(0, !pressed, { nc: true });
    return r.svg + buttonActuator(-30, bladeCrossX(0, r.angle), C.ink, pressed);
  },
  /** 复合按钮 SB：左常闭（11-12）+ 右常开（23-24），共用一只推杆 */
  button_comp(t, ctx) {
    const pressed = !!ctx.pressed;
    const nc = bladeContact(-22, !pressed, { nc: true, mirror: true });
    const no = bladeContact(22, pressed);
    return (
      nc.svg + no.svg +
      buttonActuator(-46, bladeCrossX(22, no.angle), C.ink, pressed)
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

  /** 行程开关 SQ（常开/常闭）：斜刀触点 + 刀身撞块小三角 */
  limit_no(t, ctx) {
    return bladeContact(0, ctx.closed, { actuator: true }).svg;
  },
  limit_nc(t, ctx) {
    return bladeContact(0, ctx.closed, { nc: true, actuator: true }).svg;
  },
  /** 行程开关复合触头：常闭（左，镜像）+ 常开（右），两组撞块用虚线机械联动 */
  limit_comp(t, ctx) {
    const on = ctx.state === 'closed';
    const nc = bladeContact(-22, !on, { nc: true, mirror: true, actuator: true });
    const no = bladeContact(22, on, { actuator: true });
    const [lax, lay] = actuatorApex(-22, nc.angle);
    const [rax, ray] = actuatorApex(22, no.angle);
    const ly = (lay + ray) / 2;
    return nc.svg + no.svg + ln(lax, ly, rax, ly, C.muted, 1.2, 'stroke-dasharray="3 2.4"');
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
  /** 时间继电器通电延时（缓吸）线圈 KT：竖直矩形被横线分成上下两半，下半部画 ×（国标） */
  coil_timer_on(t, ctx) {
    const on = ctx.energized;
    const color = on ? C.coilOn : C.ink;
    return (
      ln(0, -36, 0, -22, color) + ln(0, 22, 0, 36, color) +
      rect(-16, -22, 32, 44, on ? '#fdf1dc' : C.panel, color, 2.2) +
      `<g class="timer-coil" data-timer-coil="on">` +
      ln(-16, 0, 16, 0, color, THIN) +
      ln(-14, 2, 14, 20, color, THIN) + ln(-14, 20, 14, 2, color, THIN) +
      `</g>`
    );
  },
  /** 时间继电器断电延时（缓放）线圈 KT：同样的竖直矩形，下半部实心黑块（国标） */
  coil_timer_off(t, ctx) {
    const on = ctx.energized;
    const color = on ? C.coilOn : C.ink;
    return (
      ln(0, -36, 0, -22, color) + ln(0, 22, 0, 36, color) +
      rect(-16, -22, 32, 44, on ? '#fdf1dc' : C.panel, color, 2.2) +
      `<g class="timer-coil" data-timer-coil="off">` +
      ln(-16, 0, 16, 0, color, THIN) +
      rect(-15, 1, 30, 20, C.ink, C.ink, 1) +
      `</g>`
    );
  },

  contact_no(t, ctx) { return auxContact(0, ctx.closed); },
  contact_nc(t, ctx) { return auxContact(0, ctx.closed, { nc: true }); },
  /** 接触器常开主触头（三极）：静触头下端带灭弧小钩 */
  contact3_no(t, ctx) {
    const xs = [-80, 0, 80];
    return xs.map((x) => mainContactPole(x, ctx.closed)).join('');
  },

  /**
   * 热继电器触点 FR（国标）：平缓斜刀 + 右侧「⊏」形标记 + 横穿虚线。
   * 常开、常闭的标记方向一致（竖片在左、开口朝右）；
   * 常闭闭合时斜刀向右倒、刀尖落在短路片内，左侧不留悬空断口。
   * 过载脱扣时整只变红：常闭断开、常开（报警）闭合。
   */
  thermal_nc(t, ctx) {
    const color = ctx.tripped ? C.danger : C.ink;
    const c = thermalContact(0, ctx.closed, { nc: true, color });
    return c.svg + thermalMark(color) + thermalLink(c.crossX);
  },
  thermal_no(t, ctx) {
    const color = ctx.tripped ? C.danger : C.ink;
    const c = thermalContact(0, ctx.closed, { color });
    return c.svg + thermalMark(color) + thermalLink(c.crossX);
  },
  /** 热元件（单极）KH：一个宽框 + 框内一组阶梯状双金属片（导体自框内折一级） */
  thermal1(t, ctx) {
    return (
      `<g class="thermal" data-poles="1" data-frame="76x46">` +
      rect(-38, -23, 76, 46, C.panel, C.ink, 2.2, 2) +
      bimetalStep(0, -30, 30) +
      `</g>`
    );
  },
  /** 热元件（三极）KH/FR：三个极共用一个宽框，框内三段阶梯状双金属片 */
  thermal3(t, ctx) {
    const xs = [-80, 0, 80];
    return (
      `<g class="thermal" data-poles="3" data-frame="224x46">` +
      rect(-112, -23, 224, 46, C.panel, C.ink, 2.2, 2) +
      xs.map((x) => bimetalStep(x, -30, 30, C.ink, 20)).join('') +
      `</g>`
    );
  },

  /* 时间继电器触点（GB/T 4728）：按「延时闭合 / 延时断开」分两类，各含动合/动断；
   * 伞弧凸向由 delayBulge() 依国标推导，动断触点额外带顶端横杠。 */
  /** 延时闭合动合触点（通电延时闭合 NO）：伞弧凸左 */
  kt_no(t, ctx) { return timerContact(0, ctx.closed, { delayKind: 'close' }); },
  /** 延时断开动断触点（通电延时断开 NC）：伞弧凸左 + 动断横杠 */
  kt_nc(t, ctx) { return timerContact(0, ctx.closed, { nc: true, delayKind: 'open' }); },
  /** 延时断开动合触点（断电延时断开 NO）：伞弧凸右 */
  kt_off_no(t, ctx) { return timerContact(0, ctx.closed, { delayKind: 'open' }); },
  /** 延时闭合动断触点（断电延时闭合 NC）：伞弧凸右 + 动断横杠 */
  kt_off_nc(t, ctx) { return timerContact(0, ctx.closed, { nc: true, delayKind: 'close' }); },
  /** 瞬动触点：不画延时伞弧，随线圈立即动作；图形与辅助触点一致（斜刀 / L 形短路片） */
  kt_inst_no(t, ctx) { return auxContact(0, ctx.closed); },
  kt_inst_nc(t, ctx) { return auxContact(0, ctx.closed, { nc: true }); },

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
   * 插座（对齐用户提供的国标符号表）：
   *  - 单相两眼：圆圈 + 两个竖插孔；
   *  - 单相三眼：圆圈 + 上方保护极孔、下方两个工作极孔，三条引线；
   *  - 三相插座：一条横线 + 两个下半圆插孔 + 三条引线（两斜一竖，国标单线画法）。
   * 图形符号本身不带文字符号（XS 由元件编号承担）。
   */
  socket(t, ctx) {
    const color = ctx.energized ? C.amber : C.ink;
    return (
      ln(0, -36, 0, -17, color, 2.4) + ln(0, 17, 0, 36, color, 2.4) +
      `<circle cx="0" cy="0" r="17" fill="${C.panel}" stroke="${color}" stroke-width="2.2"/>` +
      ln(-6, -5, -6, 5, color, 2.4) + ln(6, -5, 6, 5, color, 2.4)
    );
  },
  /** 单相三眼插座：圆内三孔（上保护极、下两工作极），PE 自上、L/N 自下引出 */
  socket3w(t, ctx) {
    const color = ctx.energized ? C.amber : C.ink;
    return (
      ln(0, -44, 0, -17, color, 2.4) +
      ln(-8, 15, -8, 44, color, 2.4) + ln(8, 15, 8, 44, color, 2.4) +
      `<circle cx="0" cy="0" r="17" fill="${C.panel}" stroke="${color}" stroke-width="2.2"/>` +
      ln(0, -11, 0, -3, color, 2.4) +
      ln(-8, 2, -8, 12, color, 2.4) + ln(8, 2, 8, 12, color, 2.4)
    );
  },
  /** 三相插座：横线 + 两个下半圆插孔 + 三条引线（左斜、中竖、右斜） */
  socket3ph(t, ctx) {
    const color = C.ink;
    return (
      `<g class="socket-3ph" data-poles="3">` +
      ln(-20, -6, 20, -6, color, 2.2) +
      path('M -20 -6 A 10 10 0 0 0 0 -6', color, 2.2) +
      path('M 0 -6 A 10 10 0 0 0 20 -6', color, 2.2) +
      ln(-20, -6, -38, -26, color, 2.2) +
      ln(20, -6, 38, -26, color, 2.2) +
      ln(0, -6, 0, -40, color, 2.2) +
      `</g>`
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
