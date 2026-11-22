<script setup>
/**
 * 电路画布：SVG 渲染、缩放平移、运行时操作（点按/按住）、
 * 以及搭建模式的三种交互：放置元件、拖拽移动、手工走线。
 *
 * 设计取舍：渲染仍是「数据 → SVG 字符串」的纯函数，画布只负责把屏幕坐标
 * 换算成图纸坐标并向上抛出语义事件（move / wire / place / select），
 * 这样电气逻辑与交互逻辑互不缠绕，也便于用脚本做无头验证。
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { renderCircuit } from '../../../shared/render/index.js';
import { typeBounds } from '../../../shared/render/layout.js';

const props = defineProps({
  circuit: { type: Object, default: null },
  deviceTypes: { type: Array, default: () => [] },
  snapshot: { type: Object, default: null },
  mode: { type: String, default: 'course' }, // course | build
  tool: { type: String, default: 'select' }, // select | wire | place
  selected: { type: String, default: null },
  selectedIds: { type: Array, default: () => [] }, // 框选出来的多个元件
  selectedNet: { type: String, default: null },
  selectedSeg: { type: Number, default: null }, // 当前选中的导线段（polyline 索引），用于段级删除
  selectedNote: { type: String, default: null },
  armedNote: { type: Boolean, default: false }, // 「说明文本」放置模式
  showPins: { type: Boolean, default: false },
  armedType: { type: String, default: null }, // 待放置的元件类型
  wiring: { type: Boolean, default: false },
  showGrid: { type: Boolean, default: true },
  locked: { type: Boolean, default: false },
});
const emit = defineEmits([
  'activate', 'press', 'select', 'select-net', 'pin-click',
  'place', 'device-move', 'device-delete', 'wire-finish', 'wire-cancel', 'wire-to-net',
  'wire-net-to-pin', 'wire-net-to-net',
  'wire-delete', 'edit-net-label', 'label-move',
  'select-note', 'note-move', 'note-delete', 'place-note', 'edit-net-tag', 'edit-note',
  'marquee-select', 'devices-move',
]);

const GRID = 10;

const viewport = ref(null);
const content = ref(null);
const transform = ref({ x: 40, y: 30, k: 1 });
const panning = ref(false);
const middlePanning = ref(false); // 滚轮（中键）按下拖拽画布
const hovering = ref(null); // 悬停的引脚（走线时高亮）
let panStart = null;
let pressedDevice = null;
let drag = null;
let groupDrag = null; // 多选整体拖拽：{ start, items: [{id,x,y,el,lastX,lastY}], moved }
let labelDrag = null; // 标号拖拽：{ id, start, baseX, baseY, textEl, hitEl, lastX, lastY }
let noteDrag = null;  // 说明文本拖拽：{ id, start, ox, oy, lastX, lastY, moved, el }
const marquee = ref(null); // 框选：{ start: {x,y}, cur: {x,y}, moved }（图纸坐标）

/** 走线草稿：{ from: 'dev:pin', points: [{x,y}...], cursor: {x,y} } */
const wireDraft = ref(null);

const canvasW = computed(() => props.circuit?.canvas?.width || 2000);
const canvasH = computed(() => props.circuit?.canvas?.height || 1300);
const isBuild = computed(() => props.mode === 'build');

/* ------------------------------------------------------------- 渲染 */
const svgHtml = computed(() => {
  if (!props.circuit) return '';
  return renderCircuit({
    circuit: props.circuit,
    deviceTypes: props.deviceTypes,
    snapshot: props.snapshot,
    options: {
      showGrid: props.showGrid,
      showPins: props.showPins,
      selected: props.selected,
      selectedIds: props.selectedIds,
      selectedNet: props.selectedNet,
      selectedNote: props.selectedNote,
      interactive: isBuild.value,
    },
  });
});

const transformStyle = computed(() => ({
  width: `${canvasW.value}px`,
  height: `${canvasH.value}px`,
  transform: `translate(${transform.value.x}px, ${transform.value.y}px) scale(${transform.value.k})`,
}));

/** 走线预览路径（正交折线，随鼠标折向） */
const previewPath = computed(() => {
  const d = wireDraft.value;
  if (!d) return '';
  const pts = [...d.points];
  const cur = d.cursor || pts[pts.length - 1];
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const lastVert = prev ? Math.abs(prev.x - last.x) < 0.5 : true;
  let mid = null;
  if (Math.abs(cur.x - last.x) > 0.5 && Math.abs(cur.y - last.y) > 0.5) {
    mid = lastVert ? { x: cur.x, y: last.y } : { x: last.x, y: cur.y };
  }
  const all = mid ? [...pts, mid, cur] : [...pts, cur];
  let path = `M ${all[0].x} ${all[0].y}`;
  for (let i = 1; i < all.length; i += 1) path += ` L ${all[i].x} ${all[i].y}`;
  return path;
});

/** 走线预览的末点（尚未落到引脚时显示为十字） */
const endDot = computed(() => (wireDraft.value ? wireDraft.value.cursor : null));

/** 框选矩形（图纸坐标）：拖动空白区域时显示半透明选框 */
const marqueeRect = computed(() => {
  const m = marquee.value;
  if (!m) return null;
  const x1 = Math.min(m.start.x, m.cur.x);
  const y1 = Math.min(m.start.y, m.cur.y);
  return { x: x1, y: y1, w: Math.abs(m.cur.x - m.start.x), h: Math.abs(m.cur.y - m.start.y) };
});

/** 元件世界包围盒（含旋转），用于框选命中测试 */
function deviceBBox(dev) {
  const type = props.deviceTypes.find((t) => t.id === dev.type);
  if (!type) return null;
  const b = typeBounds(type);
  const rot = ((Number(dev.rot) || 0) % 360 + 360) % 360;
  let minX;
  let maxX;
  let minY;
  let maxY;
  if (rot === 90) { minX = -b.maxY; maxX = -b.minY; minY = b.minX; maxY = b.maxX; }
  else if (rot === 180) { minX = -b.maxX; maxX = -b.minX; minY = -b.maxY; maxY = -b.minY; }
  else if (rot === 270) { minX = b.minY; maxX = b.maxY; minY = -b.maxX; maxY = -b.minX; }
  else { minX = b.minX; maxX = b.maxX; minY = b.minY; maxY = b.maxY; }
  const pad = 10;
  return {
    x1: dev.x + minX - pad,
    y1: dev.y + minY - pad,
    x2: dev.x + maxX + pad,
    y2: dev.y + maxY + pad,
  };
}

/** 框选命中的元件：包围盒与选框有交集即选中 */
function devicesInMarquee(rect) {
  if (!rect) return [];
  const ids = [];
  for (const dev of props.circuit?.devices || []) {
    const bb = deviceBBox(dev);
    if (!bb) continue;
    const overlap = bb.x1 <= rect.x + rect.w && bb.x2 >= rect.x && bb.y1 <= rect.y + rect.h && bb.y2 >= rect.y;
    if (overlap) ids.push(dev.id);
  }
  return ids;
}

function fit() {
  const el = viewport.value;
  if (!el || !props.circuit) return;
  const k = Math.min((el.clientWidth - 30) / canvasW.value, (el.clientHeight - 30) / canvasH.value);
  transform.value = {
    k,
    x: (el.clientWidth - canvasW.value * k) / 2,
    y: (el.clientHeight - canvasH.value * k) / 2,
  };
}

watch(() => props.circuit?.id, () => {
  wireDraft.value = null;
  fit();
});

/** 切换工具时清掉未完成的走线 */
watch(() => props.tool, (t) => {
  if (t !== 'wire') wireDraft.value = null;
});

/* ------------------------------------------------------------- 坐标 */
function toSvgPoint(e) {
  const svg = content.value?.querySelector('.svg-host svg');
  if (!svg) return null;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
  return { x: pt.x, y: pt.y };
}

const snap = (v) => Math.round(v / GRID) * GRID;
const snapPt = (p) => ({ x: snap(p.x), y: snap(p.y) });

/** 找指针附近的引脚（用于吸附）；命中半径随缩放自适应 */
function pinNear(p, radius = null) {
  const svg = content.value?.querySelector('.svg-host svg');
  if (!svg) return null;
  const r = radius ?? Math.max(9, 18 / transform.value.k);
  let best = null;
  for (const el of svg.querySelectorAll('[data-pin]')) {
    const x = Number(el.getAttribute('cx'));
    const y = Number(el.getAttribute('cy'));
    const d = Math.hypot(x - p.x, y - p.y);
    if (d <= r && (!best || d < best.d)) best = { ref: el.getAttribute('data-pin'), x, y, d };
  }
  return best;
}

/** 点到线段距离 */
function distToSeg(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** 找指针附近的导线网络（几何命中，兜底 DOM 命中失效的场景） */
function netNear(p) {
  const r = Math.max(10, 16 / transform.value.k);
  let best = null;
  for (const net of props.circuit?.nets || []) {
    for (const poly of net.geometry || []) {
      for (let i = 1; i < poly.length; i += 1) {
        const d = distToSeg(p, { x: poly[i - 1][0], y: poly[i - 1][1] }, { x: poly[i][0], y: poly[i][1] });
        if (d <= r && (!best || d < best.d)) best = { netId: net.id, d };
      }
    }
  }
  return best;
}

/** 母线接线点位：读取 data-tap 的精确坐标（避免点击落在相邻相线上串相） */
function tapPointOf(el) {
  if (!el) return null;
  const raw = el.getAttribute('data-tap');
  if (!raw) return null;
  const [x, y] = raw.split(',').map(Number);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/** 走线折线追加一点：必要时补一个正交拐点 */
function appendWirePoint(d, target) {
  const last = d.points[d.points.length - 1];
  const pts = [...d.points];
  if (Math.hypot(target.x - last.x, target.y - last.y) > 1) {
    if (Math.abs(target.x - last.x) > 0.5 && Math.abs(target.y - last.y) > 0.5) {
      const prev = pts[pts.length - 2] || null;
      const lastVert = prev ? Math.abs(prev.x - last.x) < 0.5 : true;
      pts.push(lastVert ? { x: target.x, y: last.y } : { x: last.x, y: target.y });
    }
    pts.push(target);
  }
  return pts;
}

/* ------------------------------------------------------------- 缩放平移 */
function onWheel(e) {
  if (!viewport.value) return;
  const rect = viewport.value.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const factor = e.deltaY < 0 ? 1.12 : 0.89;
  const k2 = Math.min(3, Math.max(0.25, transform.value.k * factor));
  transform.value.x = mx - ((mx - transform.value.x) / transform.value.k) * k2;
  transform.value.y = my - ((my - transform.value.y) / transform.value.k) * k2;
  transform.value.k = k2;
}

/**
 * 滚轮（中键 button=1）按下：捕获阶段拦截，直接拖动画布位置。
 * 必须在捕获阶段处理——svg-host 上的 @pointerdown.stop 会阻止冒泡，
 * 若放在冒泡阶段，鼠标落在元件/导线上时中键拖拽会失效。
 */
function onCaptureDown(e) {
  if (e.button !== 1) return;
  e.preventDefault();
  e.stopPropagation();
  middlePanning.value = true;
  panning.value = true;
  panStart = { mx: e.clientX, my: e.clientY, x: transform.value.x, y: transform.value.y };
  viewport.value?.setPointerCapture?.(e.pointerId);
}

function onViewportDown(e) {
  if (e.button === 1) return; // 中键由 onCaptureDown 处理
  if (drag || wireDraft.value) return;
  panning.value = true;
  panStart = { mx: e.clientX, my: e.clientY, x: transform.value.x, y: transform.value.y };
  e.currentTarget.setPointerCapture?.(e.pointerId);
}

function onViewportMove(e) {
  if (panning.value && panStart) {
    transform.value.x = panStart.x + (e.clientX - panStart.mx);
    transform.value.y = panStart.y + (e.clientY - panStart.my);
    return;
  }
  if (noteDrag) {
    const p = toSvgPoint(e);
    if (!p) return;
    const dx = p.x - noteDrag.start.x;
    const dy = p.y - noteDrag.start.y;
    if (!noteDrag.moved && Math.hypot(dx, dy) * transform.value.k < 4) return;
    noteDrag.moved = true;
    noteDrag.lastX = snap(noteDrag.ox + dx);
    noteDrag.lastY = snap(noteDrag.oy + dy);
    if (noteDrag.el) {
      noteDrag.el.style.transform = `translate(${noteDrag.lastX - noteDrag.ox}px, ${noteDrag.lastY - noteDrag.oy}px)`;
      noteDrag.el.style.transition = 'none';
    }
    return;
  }
  if (labelDrag) {
    const p = toSvgPoint(e);
    if (!p) return;
    const dx = p.x - labelDrag.start.x;
    const dy = p.y - labelDrag.start.y;
    if (!labelDrag.moved && Math.hypot(dx, dy) * transform.value.k < 3) return;
    labelDrag.moved = true;
    labelDrag.lastX = Math.round((labelDrag.offsetX + dx) / GRID) * GRID;
    labelDrag.lastY = Math.round((labelDrag.offsetY + dy) / GRID) * GRID;
    // 预览：标号文字与命中区一起做平移（在基准坐标上叠加相对偏移）
    const px = labelDrag.baseX + (labelDrag.lastX - labelDrag.offsetX);
    const py = labelDrag.baseY + (labelDrag.lastY - labelDrag.offsetY);
    if (labelDrag.textEl) {
      labelDrag.textEl.setAttribute('x', px);
      labelDrag.textEl.setAttribute('y', py);
    }
    for (const h of labelDrag.hitEls) {
      if (h === labelDrag.textEl) continue;
      const bx = Number(h.getAttribute('x')) || 0;
      const by = Number(h.getAttribute('y')) || 0;
      // 命中区基准：首次拖动时记录，之后按增量平移
      if (h._baseX == null) { h._baseX = bx; h._baseY = by; }
      h.setAttribute('x', h._baseX + (labelDrag.lastX - labelDrag.offsetX));
      h.setAttribute('y', h._baseY + (labelDrag.lastY - labelDrag.offsetY));
    }
    return;
  }
  if (marquee.value) {
    const p = toSvgPoint(e);
    if (!p) return;
    marquee.value = { ...marquee.value, cur: p };
    return;
  }
  if (groupDrag) {
    const p = toSvgPoint(e);
    if (!p) return;
    const dx = p.x - groupDrag.start.x;
    const dy = p.y - groupDrag.start.y;
    if (!groupDrag.moved && Math.hypot(dx, dy) * transform.value.k < 4) return;
    groupDrag.moved = true;
    // 拖动中只做 DOM 变换预览（每个元件独立吸附网格），松手后一次性提交
    for (const it of groupDrag.items) {
      it.lastX = snap(it.x + dx);
      it.lastY = snap(it.y + dy);
      if (it.el) {
        it.el.style.transform = `translate(${it.lastX - it.x}px, ${it.lastY - it.y}px)`;
        it.el.style.transition = 'none';
      }
    }
    return;
  }
  if (drag) {
    const p = toSvgPoint(e);
    if (!p) return;
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) * transform.value.k < 4) return;
    drag.moved = true;
    drag.lastX = snap(drag.devX + dx);
    drag.lastY = snap(drag.devY + dy);
    // 拖动中只做 DOM 变换预览（不重渲染整图，保证流畅），松手后一次性提交
    if (drag.el) {
      drag.el.style.transform = `translate(${drag.lastX - drag.devX}px, ${drag.lastY - drag.devY}px)`;
      drag.el.style.transition = 'none';
    }
    return;
  }
  if (wireDraft.value) {
    const p = toSvgPoint(e);
    if (!p) return;
    const near = pinNear(p);
    hovering.value = near ? near.ref : null;
    const target = near ? { x: near.x, y: near.y } : snapPt(p);
    wireDraft.value = { ...wireDraft.value, cursor: target };
  }
}

function endPan() {
  panning.value = false;
  middlePanning.value = false;
  panStart = null;
}

/* ------------------------------------------------------------- 交互 */
function onSvgDown(e) {
  if (e.button === 1) return; // 中键交给画布平移
  const point = toSvgPoint(e);
  const pinEl = e.target.closest?.('[data-pin]');
  const netEl = e.target.closest?.('[data-net]');
  const labelEl = e.target.closest?.('[data-label-drag]');
  const devEl = e.target.closest?.('[data-dev]');
  const tapEl = e.target.closest?.('[data-tap]');
  const noteEl = e.target.closest?.('[data-note]');

  /* --- 说明文本卡片：点击选中，按住可拖动（放在最前面，卡片盖在元件上层） --- */
  if (noteEl && isBuild.value && !props.locked && props.tool !== 'wire') {
    const id = noteEl.getAttribute('data-note');
    const note = (props.circuit.notes || []).find((n) => n.id === id);
    if (note) {
      noteDrag = {
        id,
        start: point,
        ox: Number(note.x) || 0,
        oy: Number(note.y) || 0,
        lastX: Number(note.x) || 0,
        lastY: Number(note.y) || 0,
        moved: false,
        el: noteEl,
      };
      emit('select-note', id);
      viewport.value?.setPointerCapture?.(e.pointerId);
      return;
    }
  }

  /* --- 走线模式（锁定画布时禁用走线，保留元件操作） ---
   * 起点/终点均可为「元件引脚」或「母线/导线接线点位」，
   * 因此既能从元件拉到三相线，也能从三相线拉到元件。 */
  if (!props.locked && (props.tool === 'wire' || props.wiring)) {
    const tapPt = tapPointOf(tapEl);
    const domNet = netEl ? netEl.getAttribute('data-net') : null;
    // 明确点在接线点位上时优先作为母线节点，避免被附近引脚吸附抢走
    const near = tapPt ? null : point ? pinNear(point) : null;

    let netHit = null;
    if (tapPt && domNet) netHit = { netId: domNet, point: tapPt };
    else {
      const geo = point ? netNear(point) : null;
      const id = domNet || geo?.netId || null;
      if (id && point) netHit = { netId: id, point: snapPt(point) };
      else if (id) netHit = { netId: id, point: null };
    }

    /* ------- 起点 ------- */
    if (!wireDraft.value) {
      if (near) {
        const p = { x: near.x, y: near.y };
        wireDraft.value = { from: near.ref, fromNet: null, points: [p], cursor: { x: 0, y: 0 } };
        emit('pin-click', near.ref);
        return;
      }
      if (netHit?.point) {
        const p = netHit.point;
        wireDraft.value = { from: null, fromNet: netHit.netId, points: [p], cursor: { x: p.x, y: p.y } };
        emit('select-net', netHit.netId);
        return;
      }
      return; // 空白处不起线
    }

    /* ------- 终点 ------- */
    const d = wireDraft.value;
    if (near) {
      if (d.from === near.ref) { // 点回起点 → 取消
        wireDraft.value = null;
        emit('wire-cancel');
        return;
      }
      const pts = appendWirePoint(d, { x: near.x, y: near.y });
      if (d.fromNet) emit('wire-net-to-pin', { netId: d.fromNet, to: near.ref, points: pts });
      else emit('wire-finish', { from: d.from, to: near.ref, points: pts });
      wireDraft.value = null;
      hovering.value = null;
      return;
    }
    if (netHit?.point) {
      if (d.fromNet === netHit.netId) return; // 同一母线内点击：忽略
      const pts = appendWirePoint(d, netHit.point);
      if (d.fromNet) emit('wire-net-to-net', { fromNetId: d.fromNet, netId: netHit.netId, points: pts });
      else emit('wire-to-net', { from: d.from, netId: netHit.netId, points: pts });
      wireDraft.value = null;
      hovering.value = null;
      return;
    }
    if (point) {
      // 空白落点 → 追加正交拐点
      const p = snapPt(point);
      wireDraft.value = { ...d, points: appendWirePoint(d, p), cursor: p };
    }
    return;
  }

  /* --- 点击引脚（放置模式 / 普通选择） ---
   * 选择工具下点击引脚应「选中该引脚所属元件」（端子符号小、引脚命中圈大，
   * 用户点端子时经常先命中引脚）。此前只 emit pin-click，而编辑器的 pin-click
   * 处理器会把已接引脚的网络设为选中，导致点端子却显示「导线属性」。
   * 走线模式已在前面分支 return，这里不会影响走线。 */
  if (pinEl) {
    const ref = pinEl.getAttribute('data-pin');
    if (isBuild.value && !props.locked && props.tool !== 'wire') {
      const devId = String(ref || '').split(':')[0];
      if (devId) emit('select', devId);
    }
    emit('pin-click', ref);
    return;
  }

  /* --- 标号（KM1/SB1 等）：可拖拽移动位置，点击则选中元件 ---
   * 标号文字与命中区都带 data-label-drag。搭建模式下按住拖动即可改变标号位置；
   * 拖动中只做 DOM 预览，松手后一次性提交偏移，保证流畅。 */
  if (labelEl && isBuild.value && !props.locked && props.tool !== 'wire') {
    const id = labelEl.getAttribute('data-label-drag');
    const dev = props.circuit.devices.find((d) => d.id === id);
    if (!dev) return;
    const textEl = content.value?.querySelector?.(`text[data-label-drag="${id}"]`);
    const hitEls = content.value?.querySelectorAll?.(`[data-label-drag="${id}"]`) || [];
    labelDrag = {
      id,
      start: point,
      baseX: textEl ? Number(textEl.getAttribute('x')) : dev.x,
      baseY: textEl ? Number(textEl.getAttribute('y')) : dev.y,
      textEl,
      hitEls,
      offsetX: Number(dev.labelOffset?.x) || 0,
      offsetY: Number(dev.labelOffset?.y) || 0,
      lastX: Number(dev.labelOffset?.x) || 0,
      lastY: Number(dev.labelOffset?.y) || 0,
      moved: false,
    };
    emit('select', id);
    viewport.value?.setPointerCapture?.(e.pointerId);
    return;
  }

  /* --- 元件 --- */
  if (devEl) {
    const id = devEl.getAttribute('data-dev');
    if (isBuild.value && !props.locked) {
      const dev = props.circuit.devices.find((d) => d.id === id);
      if (!dev) return;
      /* 框选多元件后：拖动任意一个被选中元件 = 整体移动（松手一次提交一个历史节点） */
      const multi = (props.selectedIds || []).length > 1 && props.selectedIds.includes(id);
      if (multi) {
        const items = (props.selectedIds || [])
          .map((sid) => {
            const d = props.circuit.devices.find((x) => x.id === sid);
            if (!d) return null;
            return {
              id: sid,
              x: d.x,
              y: d.y,
              lastX: d.x,
              lastY: d.y,
              el: content.value?.querySelector?.(`g.dev[data-dev="${sid}"]`) || null,
            };
          })
          .filter(Boolean);
        groupDrag = { start: point, items, moved: false };
        viewport.value?.setPointerCapture?.(e.pointerId);
        return;
      }
      drag = { id, start: point, devX: dev.x, devY: dev.y, lastX: dev.x, lastY: dev.y, moved: false, el: devEl };
      viewport.value?.setPointerCapture?.(e.pointerId);
      return;
    }
    const type = props.deviceTypes.find((t) => {
      const d = props.circuit.devices.find((x) => x.id === id);
      return d && t.id === d.type;
    });
    if (type?.role === 'button') {
      pressedDevice = id;
      emit('press', id, true);
    } else {
      emit('activate', id);
    }
    return;
  }

  /* --- 导线：选中网络（便于设置网络标号 / 段级删除） ---
   * data-seg 标明命中的是第几段手工走线（>=0）。Delete 时据此只删这一段，
   * 遇到导线间的接点也只影响选中段，不删整条网络。 */
  if (netEl && isBuild.value) {
    const netId = netEl.getAttribute('data-net');
    const segEl = e.target.closest?.('[data-seg]');
    const segAttr = segEl ? segEl.getAttribute('data-seg') : null;
    const segIndex = segAttr != null && segAttr !== '' ? Number(segAttr) : null;
    emit('select-net', netId, Number.isInteger(segIndex) ? segIndex : null);
    return;
  }

  /* --- 空白处：放置元件 / 说明文本 / 框选 --- */
  if (isBuild.value && !props.locked && point) {
    if (props.armedNote) {
      emit('place-note', snapPt(point));
      return;
    }
    if (props.armedType) {
      emit('place', snapPt(point));
      return;
    }
    // 选择工具：空白处按下拖动 = 框选多个元件（松手后可整体拖动/旋转/删除）
    // 必须捕获指针：svg-host 会 stop 掉 pointerup 的冒泡，不捕获则收不到框选提交事件
    marquee.value = { start: point, cur: point, moved: false };
    viewport.value?.setPointerCapture?.(e.pointerId);
  }
}

/** 框选矩形几何（与 marqueeRect 同规则，供 onWindowUp 在清除前计算） */
function marqueeRectOf(m) {
  if (!m) return null;
  return {
    x: Math.min(m.start.x, m.cur.x),
    y: Math.min(m.start.y, m.cur.y),
    w: Math.abs(m.cur.x - m.start.x),
    h: Math.abs(m.cur.y - m.start.y),
  };
}

function onSvgUp() {
  if (pressedDevice) {
    emit('press', pressedDevice, false);
    pressedDevice = null;
  }
}

/**
 * 双击：导线 → 聚焦右侧「线号」输入框（快速添加/修改线号）；
 * 说明文本卡片 → 聚焦说明文字编辑框。
 */
function onSvgDblClick(e) {
  if (!isBuild.value || props.locked) return;
  const noteEl = e.target.closest?.('[data-note]');
  if (noteEl) {
    emit('edit-note', noteEl.getAttribute('data-note'));
    return;
  }
  const netEl = e.target.closest?.('[data-net]');
  if (netEl) emit('edit-net-tag', netEl.getAttribute('data-net'));
}

function onWindowUp() {
  if (marquee.value) {
    const m = marquee.value;
    marquee.value = null;
    const rect = marqueeRectOf(m);
    if (rect && (rect.w > 4 || rect.h > 4)) {
      // 拖动框选：提交命中元件；一个都没框到则视为清空选择
      emit('marquee-select', devicesInMarquee(rect));
    } else {
      emit('marquee-select', []);
    }
  }
  if (groupDrag) {
    if (groupDrag.moved) {
      emit('devices-move', groupDrag.items.map((it) => ({ id: it.id, x: it.lastX, y: it.lastY })));
    } else {
      // 未拖动：普通点击 → 单选该元件
      emit('select', groupDrag.items[0]?.id || null);
    }
    groupDrag = null;
  }
  if (noteDrag) {
    if (noteDrag.moved) emit('note-move', noteDrag.id, noteDrag.lastX, noteDrag.lastY);
    noteDrag = null;
  }
  if (labelDrag) {
    if (labelDrag.moved) {
      emit('label-move', labelDrag.id, labelDrag.lastX, labelDrag.lastY);
    } else {
      // 未拖动：当作普通点击选中（上面 down 时已 emit select，这里无需重复）
    }
    labelDrag = null;
  }
  if (drag) {
    if (!drag.moved) {
      emit('select', drag.id);
    } else {
      // 拖动结束：一次性提交位置（触发全量重渲染，预览变换随之被替换）
      emit('device-move', drag.id, drag.lastX, drag.lastY);
    }
    drag = null;
  }
  onSvgUp();
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    if (wireDraft.value) { wireDraft.value = null; emit('wire-cancel'); }
    if (marquee.value) marquee.value = null;
    if (groupDrag) {
      // 恢复整体拖拽预览到初始位置
      for (const it of groupDrag.items) {
        if (it.el) it.el.style.transform = '';
      }
      groupDrag = null;
    }
    if (noteDrag) {
      if (noteDrag.el) noteDrag.el.style.transform = '';
      noteDrag = null;
    }
    if (drag) {
      if (drag.el) drag.el.style.transform = '';
      drag = null;
    }
    if (labelDrag) {
      // 恢复标号预览到初始位置
      if (labelDrag.textEl) {
        labelDrag.textEl.setAttribute('x', labelDrag.baseX);
        labelDrag.textEl.setAttribute('y', labelDrag.baseY);
      }
      for (const h of labelDrag.hitEls) {
        if (h === labelDrag.textEl) continue;
        if (h._baseX != null) { h.setAttribute('x', h._baseX); h.setAttribute('y', h._baseY); }
      }
      labelDrag = null;
    }
    // 搭建模式：Esc 顺带清空当前选择（含框选）
    if (isBuild.value && !props.locked && (props.selected || props.selectedNet || props.selectedNote || (props.selectedIds || []).length)) {
      emit('select', null);
    }
    return;
  }
  if (!isBuild.value || props.locked) return;
  // 焦点在输入框/文本域时，Backspace / Delete 属于正常的文字编辑，绝不能误删元件或导线。
  const tag = e.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;

  if (e.key === 'Delete') {
    // Delete：删除选中对象。优先删说明文本 / 元件（含框选的多个元件），否则删选中的导线（段级）。
    if (props.selectedNote) {
      e.preventDefault();
      emit('note-delete', props.selectedNote);
    } else if (props.selected || (props.selectedIds || []).length) {
      e.preventDefault();
      emit('device-delete', props.selected);
    } else if (props.selectedNet) {
      e.preventDefault();
      emit('wire-delete', { netId: props.selectedNet, segIndex: props.selectedSeg });
    }
    return;
  }
  if (e.key === 'Backspace') {
    // Backspace：编辑网络标号（不删除元件）。选中导线时定位到右侧标号输入框。
    if (props.selectedNet) {
      e.preventDefault();
      emit('edit-net-label', props.selectedNet);
    }
    // 仅选中元件时，Backspace 不做删除——删除统一用 Delete，避免误删。
    return;
  }
}

onMounted(() => {
  window.addEventListener('pointerup', onWindowUp);
  window.addEventListener('keydown', onKeydown);
  fit();
});
onUnmounted(() => {
  window.removeEventListener('pointerup', onWindowUp);
  window.removeEventListener('keydown', onKeydown);
});

function zoomIn() {
  transform.value.k = Math.min(3, transform.value.k * 1.2);
}
function zoomOut() {
  transform.value.k = Math.max(0.25, transform.value.k / 1.2);
}

defineExpose({ fit, zoomIn, zoomOut });
</script>

<template>
  <div class="canvas-wrap">
    <div
      ref="viewport"
      class="canvas-viewport"
      :class="{ panning, 'middle-panning': middlePanning, 'wire-mode': tool === 'wire', 'cross-mode': !!armedType }"
      @wheel="onWheel"
      @pointerdown.capture="onCaptureDown"
      @pointerdown="onViewportDown"
      @pointermove="onViewportMove"
      @pointerup="endPan"
      @pointercancel="endPan"
      @auxclick.prevent
      @contextmenu.prevent
    >
      <div ref="content" class="canvas-content" :style="transformStyle">
        <div class="svg-host" v-html="svgHtml" @pointerdown.stop="onSvgDown" @pointerup.stop="onSvgUp" @pointerleave="onSvgUp" @dblclick.stop="onSvgDblClick" />
        <svg class="ghost" :viewBox="`0 0 ${canvasW} ${canvasH}`" :width="canvasW" :height="canvasH">
          <path v-if="wireDraft" :d="previewPath" fill="none" stroke="#1a73e8" stroke-width="2.4" stroke-dasharray="7 5" stroke-linecap="round" />
          <circle v-if="endDot" :cx="endDot.x" :cy="endDot.y" r="4" fill="#1a73e8" />
          <circle v-if="wireDraft" :cx="wireDraft.points[0].x" :cy="wireDraft.points[0].y" r="5" fill="#fff" stroke="#1a73e8" stroke-width="2.4" />
          <rect
            v-if="marqueeRect"
            :x="marqueeRect.x" :y="marqueeRect.y"
            :width="Math.max(marqueeRect.w, 1)" :height="Math.max(marqueeRect.h, 1)"
            fill="rgba(26,115,232,0.10)" stroke="#1a73e8" stroke-width="1.4" stroke-dasharray="5 4"
          />
        </svg>
      </div>
    </div>

    <div class="canvas-overlay">
      <button class="btn small" @click="fit">适配窗口</button>
      <button class="btn small" @click="transform.k = Math.min(3, transform.k * 1.2)">放大</button>
      <button class="btn small" @click="transform.k = Math.max(0.25, transform.k / 1.2)">缩小</button>
    </div>

    <div v-if="tool === 'wire'" class="canvas-tip">
      {{ wireDraft ? '走线中：点击拐点改变走向，点击目标引脚完成接线（Esc 取消）' : '走线：点击起点引脚开始' }}
    </div>
    <div v-else-if="armedType" class="canvas-tip">在画布上点击放置元件（Esc 取消）</div>
    <div v-else-if="isBuild" class="canvas-tip subtle">空白处按住拖动可框选多个元件；拖动选中元件可整体移动；点击导线可设置网络标号</div>
    <div v-else-if="mode === 'course' && snapshot && !snapshot.shorts.length" class="canvas-tip subtle">
      点击开关/断路器可操作；按钮为按下生效、松开复位
    </div>
  </div>
</template>
