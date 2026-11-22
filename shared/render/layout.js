/**
 * 几何布局：引脚世界坐标、导线（网络）走线、接点判定。
 * 纯计算，无 DOM 依赖，可在 Node 中直接调用（用于离线渲染校验）。
 */

const DIR_VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

/** 旋转方向向量 */
function rotateDir(dir, deg) {
  const v = DIR_VEC[dir] || [0, 1];
  const rad = ((deg || 0) * Math.PI) / 180;
  const cx = Math.cos(rad);
  const sx = Math.sin(rad);
  const x = v[0] * cx - v[1] * sx;
  const y = v[0] * sx + v[1] * cx;
  // 吸附回四方向
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'right' : 'left';
  return y > 0 ? 'down' : 'up';
}

/** 引脚世界坐标 */
export function pinWorld(dev, type, pinId) {
  const pin = (type?.pins || []).find((p) => p.id === pinId);
  if (!pin) return null;
  const rad = ((dev.rot || 0) * Math.PI) / 180;
  const cx = Math.cos(rad);
  const sx = Math.sin(rad);
  return {
    x: dev.x + pin.x * cx - pin.y * sx,
    y: dev.y + pin.x * sx + pin.y * cx,
    dir: rotateDir(pin.dir || 'down', dev.rot || 0),
  };
}

/** 元件引脚包围盒（局部坐标） */
export function typeBounds(type) {
  const pins = type?.pins || [];
  if (!pins.length) return { minX: -20, maxX: 20, minY: -20, maxY: 20 };
  const xs = pins.map((p) => p.x);
  const ys = pins.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

const seg = (x1, y1, x2, y2) => ({ x1, y1, x2, y2 });
const isHoriz = (s) => Math.abs(s.y1 - s.y2) < 0.6;
const isVert = (s) => Math.abs(s.x1 - s.x2) < 0.6;

/** 点到线段距离（用于检测一根导线的端点是否落在另一根导线中段，形成 T 接实心节点） */
function distPointToSeg(px, py, s) {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - s.x1) * dx + (py - s.y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
}
/** 点是否严格落在线段内部（排除两端点，避免把普通折角误判为 T 接） */
function pointInsideSeg(px, py, s) {
  const onLine = distPointToSeg(px, py, s) < 1.2;
  const atEnd =
    (Math.abs(px - s.x1) < 1.2 && Math.abs(py - s.y1) < 1.2) ||
    (Math.abs(px - s.x2) < 1.2 && Math.abs(py - s.y2) < 1.2);
  return onLine && !atEnd;
}

function polylineToSegments(points) {
  const out = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    if (x1 === x2 && y1 === y2) continue;
    out.push(seg(x1, y1, x2, y2));
  }
  return out;
}

/**
 * 自动走线：把同一网络上的引脚用正交线段连接
 */
export function autoRoute(pins) {
  const lines = [];
  const junctions = [];
  if (!pins.length) return { lines, junctions };
  if (pins.length === 1) return { lines, junctions };

  const xs = pins.map((p) => p.x);
  const ys = pins.map((p) => p.y);
  const xSpread = Math.max(...xs) - Math.min(...xs);
  const ySpread = Math.max(...ys) - Math.min(...ys);

  // 全部共线：直接一根
  if (xSpread < 0.6) {
    lines.push(seg(xs[0], Math.min(...ys), xs[0], Math.max(...ys)));
    return { lines, junctions };
  }
  if (ySpread < 0.6) {
    lines.push(seg(Math.min(...xs), ys[0], Math.max(...xs), ys[0]));
    return { lines, junctions };
  }

  // 两点：按引脚方向走 Z 形
  if (pins.length === 2) {
    const [a, b] = pins;
    const aVert = a.dir === 'up' || a.dir === 'down';
    const bVert = b.dir === 'up' || b.dir === 'down';
    if (aVert && bVert) {
      const midY = (a.y + b.y) / 2;
      lines.push(seg(a.x, a.y, a.x, midY));
      lines.push(seg(a.x, midY, b.x, midY));
      lines.push(seg(b.x, midY, b.x, b.y));
      junctions.push({ x: a.x, y: midY }, { x: b.x, y: midY });
    } else if (!aVert && !bVert) {
      const midX = (a.x + b.x) / 2;
      lines.push(seg(a.x, a.y, midX, a.y));
      lines.push(seg(midX, a.y, midX, b.y));
      lines.push(seg(midX, b.y, b.x, b.y));
      junctions.push({ x: midX, y: a.y }, { x: midX, y: b.y });
    } else {
      const v = aVert ? a : b;
      const h = aVert ? b : a;
      lines.push(seg(v.x, v.y, v.x, h.y));
      lines.push(seg(v.x, h.y, h.x, h.y));
      junctions.push({ x: v.x, y: h.y });
    }
    return { lines, junctions };
  }

  // 多点：拉一条主干（总线），引脚垂直下引
  if (xSpread >= ySpread) {
    const trunkY = Math.round(ys.reduce((s, v) => s + v, 0) / ys.length);
    const sorted = [...xs].sort((a, b) => a - b);
    lines.push(seg(sorted[0], trunkY, sorted[sorted.length - 1], trunkY));
    for (const p of pins) {
      if (Math.abs(p.y - trunkY) < 0.6) continue;
      lines.push(seg(p.x, p.y, p.x, trunkY));
      junctions.push({ x: p.x, y: trunkY });
    }
  } else {
    const trunkX = Math.round(xs.reduce((s, v) => s + v, 0) / xs.length);
    const sorted = [...ys].sort((a, b) => a - b);
    lines.push(seg(trunkX, sorted[0], trunkX, sorted[sorted.length - 1]));
    for (const p of pins) {
      if (Math.abs(p.x - trunkX) < 0.6) continue;
      lines.push(seg(p.x, p.y, trunkX, p.y));
      junctions.push({ x: trunkX, y: p.y });
    }
  }
  return { lines, junctions };
}

/**
 * 把引脚接到已有的几何（母线）上：垂直（或水平）引 Stub
 */
function attachPin(pin, lines, junctions) {
  let best = null;
  for (const s of lines) {
    if (isHoriz(s)) {
      const x1 = Math.min(s.x1, s.x2);
      const x2 = Math.max(s.x1, s.x2);
      const cx = Math.min(Math.max(pin.x, x1), x2);
      const dist = Math.abs(pin.y - s.y1) + Math.abs(pin.x - cx) * 0.25;
      if (!best || dist < best.dist) best = { s, dist, kind: 'h', footX: cx, footY: s.y1, x1, x2 };
    } else if (isVert(s)) {
      const y1 = Math.min(s.y1, s.y2);
      const y2 = Math.max(s.y1, s.y2);
      const cy = Math.min(Math.max(pin.y, y1), y2);
      const dist = Math.abs(pin.x - s.x1) + Math.abs(pin.y - cy) * 0.25;
      if (!best || dist < best.dist) best = { s, dist, kind: 'v', footX: s.x1, footY: cy, y1, y2 };
    }
  }
  if (!best) return;

  if (best.kind === 'h') {
    // 母线延长到引脚 x
    if (pin.x < best.x1) {
      best.s.x1 = pin.x;
      if (best.s.x1 === best.s.x2) best.s.y2 = best.s.y1;
    }
    if (pin.x > best.x2) {
      best.s.x2 = pin.x;
    }
    if (Math.abs(pin.y - best.footY) > 0.6) {
      lines.push(seg(pin.x, pin.y, pin.x, best.footY));
    }
    junctions.push({ x: pin.x, y: best.footY });
  } else {
    if (pin.y < best.y1) best.s.y1 = pin.y;
    if (pin.y > best.y2) best.s.y2 = pin.y;
    if (Math.abs(pin.x - best.footX) > 0.6) {
      lines.push(seg(pin.x, pin.y, best.footX, pin.y));
    }
    junctions.push({ x: best.footX, y: pin.y });
  }
}

/**
 * 计算一个网络的走线
 * @param {object} net 网络定义
 * @param {{devices: Map, types: Map}} ctx
 */
export function buildNetGeometry(net, ctx) {
  const pins = [];
  for (const [devId, pinId] of net.pins || []) {
    const dev = ctx.devices.get(devId);
    if (!dev) continue;
    const type = ctx.types.get(dev.type);
    const w = pinWorld(dev, type, pinId);
    if (w) pins.push({ devId, pinId, ...w });
  }

  let lines = [];
  const junctions = (net.junctions || []).map((j) => (Array.isArray(j) ? { x: j[0], y: j[1] } : j));

  if (net.geometry?.length) {
    // 每条 polyline 是一个独立的走线段，记录索引以支持「Delete 只删选中的一段」
    net.geometry.forEach((pl, pidx) => {
      for (const s of polylineToSegments(pl)) lines.push({ ...s, polylineIndex: pidx });
    });
    /**
     * 实心节点（junction dot）：两根导线相接处必须画实心圆点，表示电气连接。
     * 检测规则：
     *  1) 同一网络内，某条 polyline 的端点落在另一条 polyline 的线段「内部」→ T 接；
     *  2) 两条 polyline 的端点重合（端点对端点）→ 相接。
     * 注意 attachPin 之后还会补引脚接点，此处统一去重（见下方 uniq）。
     */
    const plEndpoints = net.geometry.map((pl) => [pl[0], pl[pl.length - 1]]);
    for (let a = 0; a < net.geometry.length; a += 1) {
      for (let b = 0; b < net.geometry.length; b += 1) {
        if (a === b) continue;
        const segsB = polylineToSegments(net.geometry[b]);
        for (const ep of plEndpoints[a]) {
          if (!ep) continue;
          let connected = false;
          for (const sb of segsB) {
            if (pointInsideSeg(ep[0], ep[1], sb)) {
              junctions.push({ x: ep[0], y: ep[1] });
              connected = true;
              break;
            }
          }
          if (connected) continue;
          for (const epB of plEndpoints[b]) {
            if (epB && Math.abs(ep[0] - epB[0]) < 1.2 && Math.abs(ep[1] - epB[1]) < 1.2) {
              junctions.push({ x: ep[0], y: ep[1] });
              break;
            }
          }
        }
      }
    }
    for (const p of pins) attachPin(p, lines, junctions);
  } else {
    const auto = autoRoute(pins);
    lines = auto.lines;
    junctions.push(...auto.junctions);
  }

  // 合并重复接点
  const uniq = [];
  for (const j of junctions) {
    if (!uniq.some((u) => Math.abs(u.x - j.x) < 0.6 && Math.abs(u.y - j.y) < 0.6)) uniq.push(j);
  }
  return { lines, junctions: uniq, pins };
}

export default buildNetGeometry;
