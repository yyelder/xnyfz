<script setup>
/**
 * 原理图仿真编辑器（对齐 simgrap 原理图编辑器）
 * ------------------------------------------------------------------
 * 布局：顶部工具栏 / 左侧元件库 / 中间画布 / 右侧属性面板。
 * 仿真：复用拓扑逻辑引擎，编辑操作即时 rebuild，运行态可操作元件。
 * 交互：点击元件库 → 画布点击放置；点引脚 → 拐点 → 引脚走线；
 *       撤销/重做以「结构快照」为粒度，拖拽移动松手后作为一个历史节点。
 */
import { ref, computed, watch, nextTick } from 'vue';
import { useSimulator } from '../composables/useSimulator.js';
import { saveCircuit } from '../api.js';
import CanvasView from './CanvasView.vue';
import DeviceLibrary from './DeviceLibrary.vue';
import { translateBusNet } from '../../../shared/render/layout.js';

const props = defineProps({
  work: { type: Object, default: null },
  deviceTypes: { type: Array, default: () => [] },
  /**
   * 课程模式：由「课程仿真 › 我的电路」直接打开，编辑的就是课程本身（无编辑副本）。
   * 保存时保留 kind='course' 与 sourceWorkId / category / order 等课程身份字段，
   * 并隐藏「加入课程仿真」（课程已经是课程了，再发布只会造出重复项）。
   */
  courseMode: { type: Boolean, default: false },
});
const emit = defineEmits(['back', 'saved', 'publish']);

const sim = useSimulator();
const draft = ref(null);
const running = ref(false);
const tool = ref('select');
const selected = ref(null);
const selectedIds = ref([]); // 框选的多个元件（长度>1 时可整体拖动/旋转/删除）
const selectedSegs = ref([]); // 框选命中的导线段 [{ netId, segIndex }]，与元件一起整体拖动
const selectedNet = ref(null);
const selectedSeg = ref(null); // 选中的导线段（polyline 索引）
const selectedNote = ref(null); // 选中的说明文本卡片
// 取消选中网络时一并清掉段索引，避免残留导致下一次 Delete 删错段
watch(selectedNet, (v) => { if (v == null) selectedSeg.value = null; });
const armedType = ref(null);
const armedNote = ref(false); // 「说明文本」放置模式
const showGrid = ref(true);
const locked = ref(false);
const saving = ref(false);
const canvasRef = ref(null);
const libCollapsed = ref(false);

/* ------------------------------------------------------------ 面板宽度（可拖拽） */
const libW = ref(264);
const sideW = ref(300);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
let resizeState = null;
function startResize(side, e) {
  e.preventDefault();
  resizeState = { side, startX: e.clientX, startW: side === 'lib' ? libW.value : sideW.value };
  window.addEventListener('pointermove', onResizeMove);
  window.addEventListener('pointerup', endResize, { once: true });
}
function onResizeMove(e) {
  if (!resizeState) return;
  const dx = e.clientX - resizeState.startX;
  if (resizeState.side === 'lib') libW.value = clamp(resizeState.startW + dx, 180, 520);
  else sideW.value = clamp(resizeState.startW - dx, 220, 560);
}
function endResize() {
  resizeState = null;
  window.removeEventListener('pointermove', onResizeMove);
}

/* ------------------------------------------------------------ 电源母线配置 */
const busPhases = ref('');          // 留空时按工业/家庭给默认值
const busLength = ref(1400);        // 母线长度（px），可自定义
const busGap = ref(48);             // 相线间距（px），拉大后更易接线
const parsePhases = (s) => String(s || '').split(/[,，\s、]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
const defaultPhases = (kind) => (kind === '3ph' ? 'U,V,W,N,PE' : 'L,N,PE');

/* 接线教程（对齐竞品「使用教程」）：首次进入自动弹出，之后从工具栏打开 */
const TUTORIAL_KEY = 'scj_tutorial_seen';
const showTutorial = ref(false);
try {
  showTutorial.value = !localStorage.getItem(TUTORIAL_KEY);
} catch (_) { /* 隐私模式等场景忽略 */ }
function closeTutorial() {
  showTutorial.value = false;
  try { localStorage.setItem(TUTORIAL_KEY, '1'); } catch (_) {}
}

/* ------------------------------------------------------------ 历史栈 */
const history = ref([]);
const future = ref([]);
const snap = () =>
  JSON.stringify({
    devices: draft.value?.devices || [],
    nets: draft.value?.nets || [],
    annotations: draft.value?.annotations || [],
    notes: draft.value?.notes || [],
    summary: draft.value?.summary || '',
    theory: draft.value?.theory || [],
    steps: draft.value?.steps || [],
    checkpoints: draft.value?.checkpoints || [],
  });
function restore(s) {
  draft.value.devices = s.devices;
  draft.value.nets = s.nets;
  draft.value.annotations = s.annotations;
  draft.value.notes = s.notes || [];
  draft.value.summary = s.summary || '';
  draft.value.theory = s.theory || [];
  draft.value.steps = s.steps || [];
  draft.value.checkpoints = s.checkpoints || [];
  syncCourseDrafts();
  selected.value = null;
  selectedIds.value = [];
  selectedSegs.value = [];
  selectedNet.value = null;
  selectedNote.value = null;
  sim.open(draft.value, props.deviceTypes);
}
function commit(fn) {
  history.value.push(snap());
  if (history.value.length > 80) history.value.shift();
  future.value = [];
  fn();
  sim.rebuild();
}
function undo() {
  if (!history.value.length || !draft.value) return;
  future.value.push(snap());
  restore(JSON.parse(history.value.pop()));
}
function redo() {
  if (!future.value.length || !draft.value) return;
  history.value.push(snap());
  restore(JSON.parse(future.value.pop()));
}

/* ------------------------------------------------------------ 课程演示信息（原理说明 / 操作步骤 / 考核要点） */
/**
 * 画好的电路可以「加入课程仿真」用于课堂演示，演示端的「原理说明 / 操作步骤 / 考核要点」
 * 就来自这三份文本。此处提供编辑入口：每行一条，随作品一并保存与撤销。
 * 注意：必须声明在 loadWork 之前（loadWork 的 immediate watch 会调用 syncCourseDrafts）。
 */
const courseDrafts = ref({ summary: '', theory: '', steps: '', checkpoints: '' });
let courseEditSnapshot = null;

function syncCourseDrafts() {
  const d = draft.value || {};
  courseDrafts.value = {
    summary: d.summary || '',
    theory: (d.theory || []).join('\n'),
    steps: (d.steps || []).join('\n'),
    checkpoints: (d.checkpoints || []).join('\n'),
  };
  courseEditSnapshot = null;
}

const linesOf = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);

/** 实时写入：边输边生效（与编号/线号一致的策略），失焦时若有变化才压历史 */
function onCourseInput(key, e) {
  if (!draft.value) return;
  if (courseEditSnapshot === null) courseEditSnapshot = snap();
  courseDrafts.value = { ...courseDrafts.value, [key]: e.target.value };
  if (key === 'summary') draft.value.summary = e.target.value;
  else draft.value[key] = linesOf(e.target.value);
}
function onCourseBlur() {
  if (courseEditSnapshot !== null && courseEditSnapshot !== snap()) {
    history.value.push(courseEditSnapshot);
    if (history.value.length > 80) history.value.shift();
    future.value = [];
  }
  courseEditSnapshot = null;
}

/** 发布目标：工业→电力拖动控制，家庭→常用照明电路；只会进入该大类的「我的电路」 */
const publishTarget = computed(() => {
  const w = draft.value || props.work || {};
  const k = w.category;
  const drive = k === 'drive' || k === 'industrial' || w.supply?.system === '3ph';
  return drive ? '电力拖动控制 › 我的电路' : '常用照明电路 › 我的电路';
});

/** 把当前作品加入课程仿真：先保存作品，再交给上层（App）生成/更新对应课程 */
async function publishToCourse() {
  if (!draft.value || running.value) return;
  const saved = await save();
  emit('publish', saved || JSON.parse(JSON.stringify(draft.value)));
}

/* ------------------------------------------------------------ 装载 */
function loadWork() {
  if (!props.work) return;
  draft.value = JSON.parse(JSON.stringify(props.work));
  // 旧作品画布较小 → 打开时自动扩容（用户要求画布大一点），不影响已画的母线/元件位置
  const cv = draft.value.canvas || (draft.value.canvas = {});
  if (!cv.width || cv.width < 2400) cv.width = 2400;
  if (!cv.height || cv.height < 1500) cv.height = 1500;
  running.value = false;
  tool.value = 'select';
  selected.value = null;
  selectedIds.value = [];
  selectedSegs.value = [];
  selectedNet.value = null;
  selectedNote.value = null;
  armedType.value = null;
  armedNote.value = false;
  history.value = [];
  future.value = [];
  sim.clearActiveFaults();
  sim.open(draft.value, props.deviceTypes);
  syncCourseDrafts();
  nextTick(() => canvasRef.value?.fit());
}
watch(() => props.work?.id, loadWork, { immediate: true });

watch(running, (r) => {
  tool.value = 'select';
  armedType.value = null;
  armedNote.value = false;
  selected.value = null;
  selectedIds.value = [];
  selectedSegs.value = [];
  selectedNet.value = null;
  selectedNote.value = null;
  nextTick(() => canvasRef.value?.fit());
});

/* ------------------------------------------------------------ 放置 / 编辑 */
function armType(id) {
  if (running.value) return;
  armedNote.value = false;
  armedType.value = armedType.value === id ? null : id;
  tool.value = armedType.value ? 'place' : 'select';
  selectedNet.value = null;
  selectedNote.value = null;
}
function setTool(t) {
  tool.value = t;
  armedType.value = null;
  armedNote.value = false;
}
/** 工具栏「说明文本」：进入放置模式，点画布落点即生成一张可编辑的说明卡片 */
function armNote() {
  if (running.value) return;
  armedNote.value = !armedNote.value;
  armedType.value = null;
  tool.value = armedNote.value ? 'place' : 'select';
  selectedNote.value = null;
  selectedNet.value = null;
  selected.value = null;
}
/* 工具栏「编辑元件」：聚焦右侧属性面板的编号输入框 */
function focusDevEditor() {
  if (!selected.value) return;
  document.querySelector('.editor-side .net-editor input')?.focus();
}

const PHASE_CYCLE = ['U', 'V', 'W', 'N', 'PE'];
/** 相线下拉预设（可先在下拉里选，也可在「自定义」里输入任意名称） */
const PHASE_OPTIONS = [
  ['U', 'U — U 相（黄）'], ['V', 'V — V 相（绿）'], ['W', 'W — W 相（红）'],
  ['L1', 'L1 — 相线 1（黄）'], ['L2', 'L2 — 相线 2（绿）'], ['L3', 'L3 — 相线 3（红）'],
  ['L', 'L — 单相火线'], ['N', 'N — 中性线（蓝）'], ['PE', 'PE — 保护地（黄绿）'],
  ['PEN', 'PEN — 保护接地中性'], ['0', '0 — 零线'],
];
/** 已知相线名（用于判断端子编号是否为「默认相名」，只有默认名才随相线联动更新） */
const KNOWN_PHASES = new Set(['U', 'V', 'W', 'L1', 'L2', 'L3', 'L', 'N', 'PE', 'PEN', '0']);

/**
 * 联动 = 名称（本轮需求）：取消独立「联动组」字段，线圈/触点/按钮只要编号相同即自动关联。
 * 元件类型 → 默认电器代号前缀，仅用于「放置元件时自动起一个不重复的编号」（如 KM1、KM2）。
 * 用户随后改编号即改联动（引擎 groupKeyOf 完全按 label 代号判定），无需再设置任何组。
 */
const LINKAGE_PREFIX = {
  km_coil: 'KM', km_no: 'KM', km_nc: 'KM', km_no_3p: 'KM',
  kt_coil: 'KT', kt_no: 'KT', kt_nc: 'KT',
  ka_coil: 'KA', ka_no: 'KA', ka_nc: 'KA',
  sb_no: 'SB', sb_nc: 'SB',
};
/** 从编号里提取电器代号，用于放置时避开已占用的序号 */
function codeOfLabel(label) {
  const m = /^\s*((?:KM|KT|KA|SB|FR|QF|SA|SQ|ST)\s*[0-9A-Za-z△]*)/i.exec(String(label || ''));
  return m ? m[1].replace(/\s+/g, '').toUpperCase() : '';
}
function nextCodeFor(prefix) {
  const used = new Set(
    (draft.value?.devices || [])
      .map((d) => codeOfLabel(d.label))
      .filter((c) => c.startsWith(prefix))
  );
  let i = 1;
  while (used.has(`${prefix}${i}`)) i += 1;
  return `${prefix}${i}`;
}
/**
 * 最近使用的代号（按放置顺序取最后一个）。
 * 接触器/时间继电器的「触点」放置时默认跟随最近的同前缀线圈代号，
 * 这样新放的常开/常闭/主触点自动与线圈同名 → 按名称联动立即生效，
 * 不会出现「放了个常闭触点却编号 KM2、与 KM1 线圈不联动」的问题。
 */
function lastCodeOf(prefix) {
  const codes = (draft.value?.devices || [])
    .map((d) => codeOfLabel(d.label))
    .filter((c) => c.startsWith(prefix));
  return codes.length ? codes[codes.length - 1] : null;
}
/** 主控类型：放置时分配「新」代号；其余联动元件跟随最近代号 */
const LINKAGE_MASTER = new Set(['km_coil', 'kt_coil', 'ka_coil']);
function codeForNewType(typeId) {
  const prefix = LINKAGE_PREFIX[typeId];
  if (!prefix) return null;
  // 接触器/时间继电器/中间继电器：线圈递增新代号，触点跟随最近代号（默认与线圈同名）
  if (prefix === 'KM' || prefix === 'KT' || prefix === 'KA') {
    if (LINKAGE_MASTER.has(typeId)) return nextCodeFor(prefix);
    return lastCodeOf(prefix) || nextCodeFor(prefix);
  }
  // 按钮（SB）常开/常闭多为独立元件，保持递增
  return nextCodeFor(prefix);
}

function onPlace(p) {
  if (!armedType.value || !draft.value) return;
  const t = props.deviceTypes.find((x) => x.id === armedType.value);
  if (!t) return;
  commit(() => {
    const n = draft.value.devices.filter((d) => d.type === t.id).length + 1;
    const id = `${t.short || 'X'}${n}_${Math.random().toString(36).slice(2, 5)}`;
    // 电源端子：自动分配下一个相线名，选中后可在属性面板改成任意名称
    const isTerminal = t.id === 'pwr_terminal';
    const phase = PHASE_CYCLE[(n - 1) % PHASE_CYCLE.length];
    const prefix = LINKAGE_PREFIX[t.id];
    // 联动类元件：线圈递增新代号，触点跟随最近线圈代号（默认同名 → 立即联动）。
    const code = prefix ? codeForNewType(t.id) : null;
    const label = isTerminal ? phase : code || `${t.short || 'X'}${n}`;
    draft.value.devices.push({
      id,
      type: t.id,
      label,
      labelPos: isTerminal ? 'top' : 'left',
      x: p.x,
      y: p.y,
      rot: 0,
      props: isTerminal ? { phase } : {},
    });
    selected.value = id;
    selectedNet.value = null;
  });
  armedType.value = null;
  tool.value = 'select';
}

function onDeviceMove(id, x, y) {
  const dev = draft.value?.devices.find((d) => d.id === id);
  if (!dev) return;
  commit(() => {
    dev.x = x;
    dev.y = y;
  });
}

/**
 * 框选提交：payload 为 { ids, segs }（兼容旧数组格式）。
 * 框到元件 → selectedIds 生效；框到导线 → selectedSegs 生效，可与元件一起整体拖动。
 */
function onMarqueeSelect(payload) {
  const ids = Array.isArray(payload) ? payload : payload?.ids || [];
  const segs = Array.isArray(payload) ? [] : payload?.segs || [];
  selectedIds.value = Array.isArray(ids) ? ids : [];
  selectedSegs.value = Array.isArray(segs)
    ? segs.filter((s) => s && s.netId && Number.isInteger(s.segIndex))
    : [];
  if (selectedIds.value.length === 1) {
    selected.value = selectedIds.value[0];
  } else {
    selected.value = null;
  }
  selectedNote.value = null;
  // 只框到导线（没有元件）：顺带选中第一条导线，右侧可编辑线号 / 删除该段
  if (!selectedIds.value.length && selectedSegs.value.length) {
    selectedNet.value = selectedSegs.value[0].netId;
    selectedSeg.value = selectedSegs.value[0].segIndex;
  } else {
    selectedNet.value = null;
    selectedSeg.value = null;
  }
}

/**
 * 群组移动提交：payload 为 { moves, segs, dx, dy }（兼容旧数组格式）。
 * 元件与导线在同一次 commit 内完成，整组移动只产生一个历史节点。
 */
function onDevicesMove(payload) {
  if (!draft.value) return;
  const moves = Array.isArray(payload) ? payload : payload?.moves || [];
  const segs = Array.isArray(payload) ? [] : payload?.segs || [];
  const dx = Number(payload?.dx) || 0;
  const dy = Number(payload?.dy) || 0;
  const hasMoves = Array.isArray(moves) && moves.length > 0;
  const hasSegs = Array.isArray(segs) && segs.length > 0 && (dx !== 0 || dy !== 0);
  if (!hasMoves && !hasSegs) return;
  // 框选命中的电源母线：整条网络（主干 + 支线 + 相线文字 + 线号）一起平移，
  // 并且支线落在元件引脚上的端点保持不动；普通导线仍按「只平移选中的折线」处理。
  const busIds = [...new Set(segs.filter((s) => s?.bus).map((s) => s.netId))];
  const plainSegs = segs.filter((s) => !s?.bus);
  commit(() => {
    if (hasMoves) {
      for (const m of moves) {
        const dev = draft.value.devices.find((d) => d.id === m.id);
        if (dev && Number.isFinite(m.x) && Number.isFinite(m.y)) {
          dev.x = m.x;
          dev.y = m.y;
        }
      }
    }
    for (const id of busIds) translateBusNet(draft.value, props.deviceTypes, id, dx, dy);
    for (const s of plainSegs) {
      const net = draft.value.nets.find((n) => n.id === s.netId);
      const poly = net?.geometry?.[s.segIndex];
      if (Array.isArray(poly)) {
        // net.geometry[segIndex] 是一条折线 [[x,y], ...]：整条平移，保持折角与长度
        net.geometry[s.segIndex] = poly.map((pt) => [Math.round(pt[0] + dx), Math.round(pt[1] + dy)]);
      }
    }
  });
}

/** 插入的三相线 / 单相线：在画布上按住整条母线拖动后写回，一次 commit = 一个历史节点 */
function onBusMove(payload) {
  if (!draft.value) return;
  const netId = payload?.netId;
  const dx = Number(payload?.dx) || 0;
  const dy = Number(payload?.dy) || 0;
  if (!netId || (dx === 0 && dy === 0)) return;
  commit(() => {
    translateBusNet(draft.value, props.deviceTypes, netId, dx, dy);
  });
}

/** 线号拖动提交：写入独立字段 wireTagPos，避免与网络标号小旗（flagPos）互相干扰 */
function onTagMove(netId, x, y, anchor) {
  const net = draft.value?.nets.find((n) => n.id === netId);
  if (!net || !Number.isFinite(x) || !Number.isFinite(y)) return;
  commit(() => {
    net.wireTagPos = { x, y, anchor: anchor || 'start' };
  });
}

/** 当前生效的选中元件集合：框选优先，其次单选 */
function activeIds() {
  if (selectedIds.value.length) return [...selectedIds.value];
  return selected.value ? [selected.value] : [];
}

function rotateSelected() {
  if (!draft.value) return;
  const ids = activeIds();
  if (!ids.length) return;
  commit(() => {
    for (const id of ids) {
      const dev = draft.value.devices.find((d) => d.id === id);
      if (dev) dev.rot = ((dev.rot || 0) + 90) % 360;
    }
  });
}

function deleteSelected() {
  if (!draft.value) return;
  const ids = new Set(activeIds());
  if (!ids.size) return;
  commit(() => {
    draft.value.devices = draft.value.devices.filter((d) => !ids.has(d.id));
    draft.value.nets = draft.value.nets
      .map((n) => ({ ...n, pins: (n.pins || []).filter(([d]) => !ids.has(d)) }))
      .filter((n) => (n.pins || []).length > 0);
    selected.value = null;
    selectedIds.value = [];
    selectedSegs.value = [];
  });
}

function clearDevices() {
  if (!draft.value) return;
  if (draft.value.devices.length === 0) return;
  if (!window.confirm('清空全部元件与接线？（电源母线保留）')) return;
  commit(() => {
    draft.value.devices = [];
    draft.value.nets = draft.value.nets.filter((n) => n.phase);
    selected.value = null;
    selectedIds.value = [];
    selectedSegs.value = [];
    selectedNet.value = null;
  });
}

/* ------------------------------------------------------------ 走线 */
const pinNetOf = (refStr) => {
  const [d, p] = String(refStr).split(':');
  return (draft.value?.nets || []).find((n) => (n.pins || []).some(([dn, pn]) => dn === d && pn === p));
};

/**
 * 引脚点击：选择工具下由 CanvasView 先 emit select 选中元件，
 * 这里不再抢先把网络设为选中（否则点端子会跳到「导线属性」，无法改相线）。
 * 仅当未选中元件且引脚确已接线时，才退回选中网络。
 */
function onPinClick(ref) {
  if (running.value) return;
  if (selected.value) return; // 元件已被选中，保留元件属性面板
  const net = pinNetOf(ref);
  if (net) selectedNet.value = net.id;
}

/* 电源端子相别：接线端落在电源端子上时，自动为所在网络赋予相别（L1/L2/L3/L/N/PE） */
function terminalPhaseOf(refStr) {
  const [d] = String(refStr).split(':');
  const dev = draft.value?.devices.find((x) => x.id === d);
  return dev && dev.type === 'pwr_terminal' ? dev.props?.phase || null : null;
}

function onWireFinish({ from, to, points }) {
  if (!draft.value) return;
  commit(() => {
    const geom = points.map((p) => [Math.round(p.x), Math.round(p.y)]);
    const netA = pinNetOf(from);
    const netB = pinNetOf(to);
    const pushPin = (net, refStr) => {
      const [d, p] = refStr.split(':');
      if (!(net.pins || []).some(([dn, pn]) => dn === d && pn === p)) net.pins = [...(net.pins || []), [d, p]];
    };
    let targetNet = null;
    if (netA && netB && netA.id !== netB.id) {
      netB.pins.forEach((pin) => pushPin(netA, `${pin[0]}:${pin[1]}`));
      netA.geometry = [...(netA.geometry || []), ...(netB.geometry || []), geom];
      netA.label = netA.label || netB.label;
      netA.name = netA.name || netB.name;
      draft.value.nets = draft.value.nets.filter((n) => n.id !== netB.id);
      targetNet = netA;
      selectedNet.value = netA.id;
    } else if (netA) {
      pushPin(netA, to);
      netA.geometry = [...(netA.geometry || []), geom];
      targetNet = netA;
      selectedNet.value = netA.id;
    } else if (netB) {
      pushPin(netB, from);
      netB.geometry = [...(netB.geometry || []), geom];
      targetNet = netB;
      selectedNet.value = netB.id;
    } else {
      targetNet = { id: `n-${Math.random().toString(36).slice(2, 7)}`, pins: [], geometry: [geom] };
      pushPin(targetNet, from);
      pushPin(targetNet, to);
      draft.value.nets.push(targetNet);
      selectedNet.value = targetNet.id;
    }
    /* 相别自动标注（电源端子） */
    const ph = terminalPhaseOf(from) || terminalPhaseOf(to);
    if (targetNet && ph && !targetNet.phase) targetNet.phase = ph;
    selected.value = null;
  });
}

/** 把一个元件引脚并入指定网络（母线/导线），并追加走线几何 */
function mergePinIntoNet(netId, pinRef, points) {
  const net = draft.value.nets.find((n) => n.id === netId);
  if (!net) return;
  const [d, p] = String(pinRef).split(':');
  net.pins = net.pins || [];
  if (!net.pins.some(([dn, pn]) => dn === d && pn === p)) net.pins.push([d, p]);
  const ph = terminalPhaseOf(pinRef);
  if (ph && !net.phase) net.phase = ph;
  if (points?.length) {
    net.geometry = [...(net.geometry || []), points.map((pt) => [Math.round(pt.x), Math.round(pt.y)])];
  }
  selectedNet.value = net.id;
  selected.value = null;
}

/** 元件引脚 → 母线/导线 */
function onWireToNet({ from, netId, points }) {
  if (!draft.value) return;
  commit(() => mergePinIntoNet(netId, from, points));
}

/** 母线/导线 → 元件引脚（新增：三相线可直接往元件上接线） */
function onWireNetToPin({ netId, to, points }) {
  if (!draft.value) return;
  commit(() => mergePinIntoNet(netId, to, points));
}

/** 母线 → 另一条导线：把用户画出的连接折线并入目标网络（两网等电位按同一网络处理） */
function onWireNetToNet({ fromNetId, netId, points }) {
  if (!draft.value || fromNetId === netId) return;
  commit(() => {
    const a = draft.value.nets.find((n) => n.id === fromNetId);
    const b = draft.value.nets.find((n) => n.id === netId);
    if (!a || !b) return;
    // 合并为同一网络：把 b 的引脚与几何并入 a，删除 b
    for (const pin of b.pins || []) {
      if (!(a.pins || []).some(([d, p]) => d === pin[0] && p === pin[1])) {
        a.pins = [...(a.pins || []), pin];
      }
    }
    a.geometry = [...(a.geometry || []), ...(b.geometry || [])];
    if (points?.length) a.geometry.push(points.map((pt) => [Math.round(pt.x), Math.round(pt.y)]));
    if (!a.phase && b.phase) a.phase = b.phase;
    if (!a.name && b.name) a.name = b.name;
    draft.value.nets = draft.value.nets.filter((n) => n.id !== b.id);
    selectedNet.value = a.id;
    selected.value = null;
  });
}

/* ------------------------------------------------------------ 网络 / 属性编辑 */
const netOfSelected = computed(
  () => (draft.value?.nets || []).find((n) => n.id === selectedNet.value) || null
);
const devOfSelected = computed(
  () => (draft.value?.devices || []).find((d) => d.id === selected.value) || null
);
const noteOfSelected = computed(
  () => (draft.value?.notes || []).find((n) => n.id === selectedNote.value) || null
);
const typeOfSelected = computed(() =>
  devOfSelected.value ? props.deviceTypes.find((t) => t.id === devOfSelected.value.type) : null
);
/** 框选元件的编号清单（多选面板展示用） */
const selectedDevLabels = computed(() =>
  selectedIds.value
    .map((id) => draft.value?.devices.find((d) => d.id === id))
    .filter(Boolean)
    .map((d) => d.label || d.id)
);

/**
 * 网络标号 / 线号编辑 —— 与「编号」同样必须「边输边生效」。
 * 旧实现是 :value + @change（失焦才提交），部分输入方式下值提交不稳定，
 * 表现就是用户反馈的「线号无法设置」。改为 @input 实时写入 + 失焦压历史。
 */
const netNameInput = ref(null);
const netTagInput = ref(null);
const netNameDraft = ref('');
const netTagDraft = ref('');
let netNameSnapshot = null;
let netTagSnapshot = null;

watch(
  () => netOfSelected.value?.id,
  () => {
    netNameDraft.value = netOfSelected.value?.name || '';
    netTagDraft.value = netOfSelected.value?.tag || '';
    netNameSnapshot = null;
    netTagSnapshot = null;
  },
  { immediate: true }
);

function pushHistoryIfChanged(before) {
  if (before !== null && before !== snap()) {
    history.value.push(before);
    if (history.value.length > 80) history.value.shift();
    future.value = [];
  }
}

function onNetNameInput(e) {
  const net = netOfSelected.value;
  if (!net) return;
  if (netNameSnapshot === null) netNameSnapshot = snap();
  netNameDraft.value = e.target.value;
  const v = String(e.target.value || '').trim();
  if (v) net.name = v;
  else delete net.name;
}
function onNetNameBlur() {
  pushHistoryIfChanged(netNameSnapshot);
  netNameSnapshot = null;
}

function onNetTagInput(e) {
  const net = netOfSelected.value;
  if (!net) return;
  if (netTagSnapshot === null) netTagSnapshot = snap();
  netTagDraft.value = e.target.value;
  const v = String(e.target.value || '').trim();
  if (v) net.tag = v;
  else delete net.tag;
}
function onNetTagBlur() {
  pushHistoryIfChanged(netTagSnapshot);
  netTagSnapshot = null;
}

/** 下一可用线号（纯数字顺序递增，如 1、2、3…），用于「添加线号」自动预填 */
function nextTagNo() {
  const nums = (draft.value?.nets || [])
    .map((n) => Number(String(n.tag ?? '').trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return String((nums.length ? Math.max(...nums) : 0) + 1);
}

/** 双击导线 / 属性面板「添加线号」：选中网络并把焦点落到线号输入框 */
function editNetTag(id) {
  if (!draft.value) return;
  const net = draft.value.nets.find((n) => n.id === id);
  if (!net) return;
  selectedNet.value = id;
  selected.value = null;
  selectedNote.value = null;
  selectedSeg.value = null;
  if (!net.tag) {
    // 注意：net 已处于选中状态时 watch 不会重跑，需要同步刷新输入框绑定值
    const v = nextTagNo();
    commit(() => {
      net.tag = v;
    });
    netTagDraft.value = v;
  }
  netNameDraft.value = net.name || '';
  nextTick(() => {
    const el = netTagInput.value;
    if (!el) return;
    el.focus();
    el.select?.();
  });
}

function setNetName(id, name) {
  const net = draft.value?.nets.find((n) => n.id === id);
  if (!net) return;
  commit(() => {
    const v = String(name || '').trim();
    if (v) net.name = v;
    else delete net.name;
  });
}
function setNetPhase(id, phase) {
  const net = draft.value?.nets.find((n) => n.id === id);
  if (!net) return;
  commit(() => {
    if (phase) net.phase = phase;
    else delete net.phase;
  });
}
/** 线号：显示在导线旁的编号（如 101、102），与网络标号小旗相互独立 */
function setNetTag(id, tag) {
  const net = draft.value?.nets.find((n) => n.id === id);
  if (!net) return;
  commit(() => {
    const v = String(tag || '').trim();
    if (v) net.tag = v;
    else delete net.tag;
  });
}
function deleteNet(id) {
  if (!draft.value) return;
  commit(() => {
    draft.value.nets = draft.value.nets.filter((n) => n.id !== id);
    if (selectedNet.value === id) selectedNet.value = null;
  });
}

/**
 * 段级删除导线（Delete 键触发）：
 *  - 若选中了具体的手工走线段（segIndex >= 0）：只删这一段 polyline。
 *    这样两根导线相接于同一节点时，删一段不会连带删掉另一段，也不会删掉节点/引脚。
 *  - 若该网络删段后已无任何几何与引脚：回收整条网络（避免留下空网）。
 *  - 若未指定段（segIndex 为空，如母线）：退回删除整条网络。
 */
function deleteWireSegment({ netId, segIndex }) {
  if (!draft.value) return;
  commit(() => {
    const net = draft.value.nets.find((n) => n.id === netId);
    if (!net) return;
    if (segIndex == null) {
      draft.value.nets = draft.value.nets.filter((n) => n.id !== netId);
    } else {
      const kept = (net.geometry || []).filter((_, i) => i !== segIndex);
      // 引脚仍挂在网络上时保留网络（几何删掉后仍可在属性面板处理引脚），否则连同空网回收。
      if (kept.length === 0 && (net.pins || []).length === 0) {
        draft.value.nets = draft.value.nets.filter((n) => n.id !== netId);
      } else {
        net.geometry = kept;
      }
    }
    selectedNet.value = null;
    selectedSeg.value = null;
  });
}

/** Backspace：定位到右侧「网络标号」输入框并全选，实现快速修改（不删除元件/导线） */
function editNetLabel(id) {
  if (selectedNet.value !== id) selectedNet.value = id;
  selected.value = null;
  selectedNote.value = null;
  nextTick(() => {
    const el = netNameInput.value;
    if (!el) return;
    el.focus();
    el.select?.();
  });
}

/**
 * 编号编辑 —— 联动唯一依据就是编号本身，且必须「边输边生效」。
 * ------------------------------------------------------------------
 * 旧实现用 :value + @change（失焦才提交），在输入法组合、全选键入等场景下
 * 值提交不稳定，用户会看到「编号改不了」。现改为 @input 实时写入 draft：
 *   - 输入即时反映到图上编号与联动（引擎 groupKeyOf 按 label 代号归组）；
 *   - 进入编辑时拍一份结构快照，失焦时若有变化才压入历史栈，撤销仍可用；
 *   - 同时清掉历史遗留的 props.group，避免 group 与编号不一致误导。
 */
const labelDraft = ref('');
let labelEditSnapshot = null;
watch(
  () => devOfSelected.value?.id,
  () => {
    labelDraft.value = devOfSelected.value?.label || '';
    labelEditSnapshot = null;
  },
  { immediate: true }
);

function onLabelInput(e) {
  const dev = devOfSelected.value;
  if (!dev) return;
  if (labelEditSnapshot === null) labelEditSnapshot = snap();
  labelDraft.value = e.target.value;
  const v = String(e.target.value || '').trim();
  dev.label = v || dev.id;
  if (dev.props && 'group' in dev.props) {
    const next = { ...dev.props };
    delete next.group;
    dev.props = next;
  }
  sim.rebuild();
}
function onLabelBlur() {
  if (labelEditSnapshot !== null && labelEditSnapshot !== snap()) {
    history.value.push(labelEditSnapshot);
    if (history.value.length > 80) history.value.shift();
    future.value = [];
  }
  labelEditSnapshot = null;
}

/* ------------------------------------------------------------ 说明文本（可配图片） */
const noteTextInput = ref(null);
const noteTextDraft = ref('');
let noteEditSnapshot = null;
watch(
  () => noteOfSelected.value?.id,
  () => {
    noteTextDraft.value = noteOfSelected.value?.text || '';
    noteEditSnapshot = null;
  },
  { immediate: true }
);

/** 放置说明卡片：默认空文本 + 占位提示，落点即选中并聚焦编辑框 */
function onPlaceNote(p) {
  if (!draft.value || running.value) return;
  if (!Array.isArray(draft.value.notes)) draft.value.notes = [];
  const seq = draft.value.notes.length + 1;
  const id = `N${Date.now().toString(36)}${seq}`;
  commit(() => {
    draft.value.notes.push({ id, text: '', x: p.x, y: p.y, w: 240 });
    selectedNote.value = id;
    selected.value = null;
    selectedNet.value = null;
  });
  armedNote.value = false;
  tool.value = 'select';
  nextTick(() => noteTextInput.value?.focus());
}

function onNoteMove(id, x, y) {
  const note = (draft.value?.notes || []).find((n) => n.id === id);
  if (!note) return;
  commit(() => {
    note.x = x;
    note.y = y;
  });
}

function deleteNote(id) {
  if (!draft.value) return;
  commit(() => {
    draft.value.notes = (draft.value.notes || []).filter((n) => n.id !== id);
    if (selectedNote.value === id) selectedNote.value = null;
  });
}

/** 说明文字实时编辑：边输边渲染，失焦时压入历史栈 */
function onNoteTextInput(e) {
  const note = noteOfSelected.value;
  if (!note) return;
  if (noteEditSnapshot === null) noteEditSnapshot = snap();
  noteTextDraft.value = e.target.value;
  note.text = e.target.value;
}
function onNoteTextBlur() {
  pushHistoryIfChanged(noteEditSnapshot);
  noteEditSnapshot = null;
}

function setNoteWidth(e) {
  const note = noteOfSelected.value;
  if (!note) return;
  const v = Math.max(90, Math.min(1200, Number(e.target.value) || 240));
  commit(() => {
    note.w = v;
  });
}
function setNoteFontSize(e) {
  const note = noteOfSelected.value;
  if (!note) return;
  const v = Math.max(10, Math.min(28, Number(e.target.value) || 13));
  commit(() => {
    note.fontSize = v;
  });
}
function setNoteImagePos(e) {
  const note = noteOfSelected.value;
  if (!note) return;
  commit(() => {
    note.imagePos = e.target.value;
  });
}
function setNoteImageWidth(e) {
  const note = noteOfSelected.value;
  if (!note) return;
  const v = Math.max(40, Math.min(800, Number(e.target.value) || 160));
  commit(() => {
    note.imageWidth = v;
  });
}
function removeNoteImage() {
  const note = noteOfSelected.value;
  if (!note) return;
  commit(() => {
    delete note.image;
    delete note.imageAspect;
  });
}

/** 图片压缩：最长边不超过 maxW，转 JPEG/PNG dataURL，避免撑爆本地存储 */
function fileToImage(file, maxW = 900) {
  return new Promise((resolve, reject) => {
    const rd = new FileReader();
    rd.onerror = () => reject(new Error('读取图片失败'));
    rd.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片解析失败'));
      img.onload = () => {
        const scale = Math.min(1, maxW / (img.width || maxW));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        const isPng = /png|svg/i.test(file.type);
        resolve({ dataUrl: cv.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.85), aspect: w / h });
      };
      img.src = rd.result;
    };
    rd.readAsDataURL(file);
  });
}

async function onNoteImagePick(e) {
  const file = e.target.files?.[0];
  const note = noteOfSelected.value;
  if (!file || !note) return;
  try {
    const { dataUrl, aspect } = await fileToImage(file, 900);
    commit(() => {
      note.image = dataUrl;
      note.imageAspect = aspect;
      if (!note.imageWidth) note.imageWidth = 180;
      if (!note.imagePos) note.imagePos = 'right';
    });
  } catch (err) {
    // 读取失败时保持原状即可，不打断编辑
    console.warn('说明图片读取失败', err);
  } finally {
    e.target.value = '';
  }
}

/** 双击说明卡片：聚焦文字编辑框 */
function editNote(id) {
  selectedNote.value = id;
  selected.value = null;
  selectedNet.value = null;
  nextTick(() => noteTextInput.value?.focus());
}
function setDelaySelected(e) {
  const dev = devOfSelected.value;
  if (!dev || typeOfSelected.value?.timer !== true) return;
  const v = Math.max(0.2, Number(e.target.value) || 3);
  commit(() => {
    dev.props = { ...(dev.props || {}), delay: v };
  });
}
function setLabelPosSelected(e) {
  const dev = devOfSelected.value;
  if (!dev) return;
  commit(() => {
    dev.labelPos = e.target.value;
    // 切换预设位置时清掉自由拖拽偏移，让预设位置立即生效
    if (dev.labelOffset) delete dev.labelOffset;
  });
}
/** 标号拖拽移动：把偏移写入元件，元件移动时标号自然跟随 */
function onLabelMove(id, x, y) {
  const dev = draft.value?.devices.find((d) => d.id === id);
  if (!dev) return;
  commit(() => {
    dev.labelOffset = { x, y };
  });
}
/** 重置标号位置：回到 labelPos 预设点位 */
function resetLabelPos() {
  const dev = devOfSelected.value;
  if (!dev || !dev.labelOffset) return;
  commit(() => {
    if (dev.labelOffset) delete dev.labelOffset;
  });
}

/* ------------------------------------------------------------ 母线 / 检查 */
/**
 * 插入电源母线：相线名、长度、间距均可自定义。
 * 相线名支持 U/V/W/L1/L2/L3/L/N/PE 以及任意自定义名（引擎统一识别为带电相）。
 * 每条母线沿线渲染接线点位，可从母线任意位置起线接到元件。
 */
function addPowerBus(kind) {
  if (!draft.value) return;
  const text = String(busPhases.value || '').trim() || defaultPhases(kind);
  const phases = parsePhases(text);
  if (!phases.length) return;
  const len = clamp(Number(busLength.value) || 1400, 200, 4000);
  const gap = clamp(Number(busGap.value) || 48, 28, 140);
  const x0 = 80;
  const yTop = 80;
  const ground = new Set(['N', 'PE', 'PEN', '0']);
  // 电拖标准格式：相线在顶部依次排开，N/PE 在底部，避免与元件重叠
  const live = phases.filter((p) => !ground.has(p));
  const neutral = phases.filter((p) => ground.has(p));
  const yBottom = (draft.value.canvas?.height || 1000) - 80;
  commit(() => {
    [...live.map((p, i) => ({ p, y: yTop + i * gap })),
      ...neutral.map((p, i) => ({ p, y: yBottom - (neutral.length - 1 - i) * gap }))].forEach(({ p: ph, y }) => {
      let id = ph;
      let seq = 2;
      while (draft.value.nets.some((n) => n.id === id)) id = `${ph}-${seq++}`;
      draft.value.nets.push({
        id,
        phase: ph,
        bus: true,
        geometry: [[[x0, y], [x0 + len, y]]],
        label: { text: ph, x: x0, y: y - 10 },
        pins: [],
      });
    });
  });
}

/** 修改某条母线的长度（选中导线后可用） */
function setNetLength(id, value) {
  const net = draft.value?.nets.find((n) => n.id === id);
  if (!net || !net.geometry?.length) return;
  const len = clamp(Number(value) || 1400, 200, 4000);
  commit(() => {
    const poly = net.geometry[0];
    if (!poly?.length) return;
    const x0 = poly[0][0];
    const y = poly[0][1];
    // 仅重写首段（主干），其余已接出的支线保留
    net.geometry[0] = [[x0, y], [x0 + len, y]];
  });
}

/** 相线下拉当前值：预设内直接返回，自定义值归到「自定义」项 */
const phaseSelectValue = computed(() => {
  const ph = String(devOfSelected.value?.props?.phase || '').trim().toUpperCase();
  return PHASE_OPTIONS.some(([v]) => v === ph) ? ph : '__custom__';
});
function onPhaseSelect(e) {
  const v = e.target.value;
  if (v === '__custom__') return; // 交由下方「相线名称」输入框处理
  setTerminalPhase({ target: { value: v } });
}

/**
 * 电源端子相线：相线与编号独立。
 *  - 相线写入 props.phase，并同步到所接导线的相别；
 *  - 编号（label）默认等于初始相名，仅当仍是「已知相名」（未被用户自定义）时才跟随更新；
 *    一旦用户把编号改成自定义文字，改相线不再覆盖编号。
 */
function setTerminalPhase(e) {
  const dev = devOfSelected.value;
  if (!dev || dev.type !== 'pwr_terminal') return;
  const ph = String(e.target.value ?? '').trim().toUpperCase();
  commit(() => {
    dev.props = { ...(dev.props || {}), phase: ph };
    const prevLabel = String(dev.label || '').trim().toUpperCase();
    if (KNOWN_PHASES.has(prevLabel)) dev.label = ph || dev.id;
    const net = draft.value.nets.find((n) =>
      (n.pins || []).some(([d]) => d === dev.id)
    );
    if (net) {
      if (ph) net.phase = ph;
      else delete net.phase;
    }
  });
}

const inspector = computed(() => {
  const c = draft.value;
  if (!c) return { unconnected: [], dangling: [], netCount: 0, named: 0 };
  const pinned = new Set();
  for (const n of c.nets || []) for (const [d, p] of n.pins || []) pinned.add(`${d}:${p}`);
  const unconnected = [];
  for (const d of c.devices || []) {
    const t = props.deviceTypes.find((x) => x.id === d.type);
    for (const p of t?.pins || []) {
      if (!pinned.has(`${d.id}:${p.id}`)) unconnected.push({ dev: d.label || d.id, pin: p.id });
    }
  }
  const dangling = (c.nets || []).filter((n) => (n.pins || []).length < 2 && !n.phase);
  const named = new Set((c.nets || []).map((n) => (n.name || '').trim()).filter(Boolean));
  return { unconnected, dangling, netCount: (c.nets || []).length, named: named.size };
});

/* ------------------------------------------------------------ 保存 */
async function save() {
  if (!draft.value || saving.value) return;
  saving.value = true;
  try {
    const doc = {
      ...JSON.parse(JSON.stringify(draft.value)),
      // 课程模式：保持课程身份，写回同一 id，绝不降级成「作品」或另建副本。
      kind: props.courseMode ? (draft.value.kind || 'course') : 'work',
      viewType: 'schematic',
      builtin: false,
      updatedAt: Date.now(),
    };
    const saved = await saveCircuit(doc);
    draft.value = JSON.parse(JSON.stringify(saved));
    sim.open(draft.value, props.deviceTypes);
    emit('saved', saved);
    return saved;
  } finally {
    saving.value = false;
  }
}

/** 课程模式「完成编辑」：先落盘再返回课程仿真，由上层用最新课程重新打开画布 */
async function finishCourseEdit() {
  const saved = await save();
  if (saved) emit('back');
}

/* ------------------------------------------------------------ 快捷键 */
function onKey(e) {
  if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
    return;
  }
  if (e.key.toLowerCase() === 'r' && !running.value && selected.value && !locked.value) rotateSelected();
}
</script>

<template>
  <div class="editor-shell" tabindex="0" @keydown="onKey">
    <!-- 顶部工具栏（对齐竞品：返回/名称/撤销重做/清空/缩放/网格/锁定/运行/保存） -->
    <header class="editor-toolbar">
      <button class="btn ghost" data-op="editor-back" @click="emit('back')">{{ courseMode ? '← 返回课程仿真' : '← 返回' }}</button>
      <input v-if="draft" v-model="draft.title" class="title-input" placeholder="未命名原理图" />
      <span v-if="courseMode && draft" class="run-badge course-mode-badge" data-course-mode>课程原理图 · 直接编辑原图（无副本）</span>
      <div class="spacer" />

      <template v-if="!running && draft">
        <div class="tool-group">
          <button class="btn small" :disabled="!history.length" title="撤销 (Ctrl+Z)" @click="undo">↶ 撤销</button>
          <button class="btn small" :disabled="!future.length" title="重做 (Ctrl+Y)" @click="redo">↷ 重做</button>
        </div>
        <div class="tool-group">
          <button class="btn small" :class="{ active: !libCollapsed }" :title="libCollapsed ? '展开元件库' : '折叠元件库'" @click="libCollapsed = !libCollapsed">折叠</button>
          <button class="btn small" :disabled="!selected" title="编辑选中元件的编号与属性" @click="focusDevEditor">编辑元件</button>
        </div>
        <div class="tool-group">
          <button class="btn small" :class="{ active: tool === 'select' }" @click="setTool('select')">↖ 选择</button>
          <button class="btn small" :class="{ active: tool === 'wire' }" @click="setTool('wire')">✏️ 走线</button>
          <button class="btn small" :class="{ active: armedNote }" title="添加说明文字（可配图片）" @click="armNote">💬 说明</button>
          <button class="btn small" :disabled="(!selected && !selectedIds.length) || locked" @click="rotateSelected">旋转</button>
          <button class="btn small" :disabled="(!selected && !selectedIds.length) || locked" @click="deleteSelected">删除</button>
        </div>
        <div class="tool-group">
          <button class="btn small" @click="canvasRef?.zoomIn()">＋</button>
          <button class="btn small" @click="canvasRef?.zoomOut()">－</button>
          <button class="btn small" @click="canvasRef?.fit()">自适应</button>
        </div>
        <div class="tool-group">
          <button class="btn small" :class="{ active: showGrid }" @click="showGrid = !showGrid">网格</button>
          <button class="btn small" :class="{ active: locked }" @click="locked = !locked">{{ locked ? '🔒 已锁定' : '🔓 锁定' }}</button>
          <button class="btn small" :disabled="locked" @click="clearDevices">清空元件</button>
        </div>
        <div class="tool-group">
          <button
            v-if="!courseMode"
            class="btn small"
            :title="`加入课程仿真 → ${publishTarget}（可编辑原理说明/操作步骤/考核要点）`"
            @click="publishToCourse"
          >📤 加入课程仿真</button>
          <button v-else class="btn small" data-op="course-save" title="保存当前修改（仍在编辑器中）" @click="save">💾 保存</button>
          <button class="btn" @click="running = true">▶ 运行仿真</button>
        </div>
      </template>

      <template v-else-if="draft">
        <span class="run-badge">● 仿真运行中 · 点击元件可操作</span>
        <button class="btn primary" @click="sim.demoSequence()">⚡ 一键演示</button>
        <button class="btn" @click="sim.reset(); canvasRef?.fit?.()">复位</button>
        <button class="btn" @click="running = false">■ 返回编辑</button>
      </template>

      <button class="btn ghost" @click="showTutorial = true">❓ 使用教程</button>
      <button
        class="btn primary"
        data-op="editor-save"
        :disabled="!draft || saving"
        @click="courseMode ? finishCourseEdit() : save()"
      >{{ courseMode ? '✓ 完成编辑' : '保存' }}</button>
    </header>

    <!-- 接线教程弹窗（对齐竞品「使用教程」） -->
    <div v-if="showTutorial" class="tutorial-mask" @click.self="closeTutorial">
      <div class="tutorial-card">
        <h3>接线教程</h3>
        <ol class="tutorial-steps">
          <li>点击左侧元件库中的元器件，再点击画布空白处放置。</li>
          <li>点击元器件<b>端子</b>或<b>母线上的接线点位</b>开始接线，需要转弯再点击一下。</li>
          <li>点击目标端子 / 另一条母线完成连线；两侧均可作为起点。</li>
          <li>按下<b>鼠标滚轮（中键）拖动</b>可平移画布，滚轮滚动缩放。</li>
          <li>左右面板边缘可拖动调整宽度；点击「运行仿真」观察通电效果。</li>
        </ol>
        <div class="tutorial-actions">
          <button class="btn primary" @click="closeTutorial">开始使用</button>
        </div>
      </div>
    </div>

    <div class="editor-body" :class="{ 'lib-collapsed': libCollapsed }" v-if="draft">
      <DeviceLibrary
        v-if="!running && !locked"
        v-show="!libCollapsed"
        class="editor-lib"
        :style="{ width: libW + 'px', flex: '0 0 ' + libW + 'px' }"
        :device-types="deviceTypes"
        :armed-type="armedType"
        @arm="armType"
      />
      <div
        v-if="!running && !locked && !libCollapsed"
        class="panel-resizer"
        title="左右拖动可调整元件库宽度"
        @pointerdown="startResize('lib', $event)"
      ><span></span></div>

      <div class="editor-canvas">
        <CanvasView
          ref="canvasRef"
          :circuit="draft"
          :device-types="deviceTypes"
          :snapshot="sim.snapshot.value"
          :mode="running ? 'course' : 'build'"
          :tool="tool"
          :selected="selected"
          :selected-ids="selectedIds"
          :selected-segs="selectedSegs"
          :selected-net="selectedNet"
          :selected-seg="selectedSeg"
          :selected-note="selectedNote"
          :armed-note="armedNote"
          :show-pins="!running"
          :armed-type="armedType"
          :wiring="tool === 'wire' && !running"
          :show-grid="showGrid"
          :locked="locked"
          @activate="sim.toggleDevice"
          @press="sim.press"
          @select="(id) => { selected = id; selectedIds = id ? [id] : []; selectedSegs = []; selectedNet = null; selectedSeg = null; selectedNote = null; }"
          @select-net="(id, seg) => { selectedNet = id; selectedSeg = seg; selected = null; selectedIds = []; selectedSegs = []; selectedNote = null; }"
          @select-note="(id) => { selectedNote = id; selected = null; selectedIds = []; selectedSegs = []; selectedNet = null; selectedSeg = null; }"
          @marquee-select="onMarqueeSelect"
          @devices-move="onDevicesMove"
          @bus-move="onBusMove"
          @tag-move="onTagMove"
          @note-move="onNoteMove"
          @note-delete="deleteNote"
          @place-note="onPlaceNote"
          @edit-note="editNote"
          @edit-net-tag="editNetTag"
          @pin-click="onPinClick"
          @place="onPlace"
          @device-move="onDeviceMove"
          @device-delete="deleteSelected"
          @label-move="onLabelMove"
          @wire-delete="deleteWireSegment"
          @edit-net-label="editNetLabel"
          @wire-finish="onWireFinish"
          @wire-to-net="onWireToNet"
          @wire-net-to-pin="onWireNetToPin"
          @wire-net-to-net="onWireNetToNet"
        />
      </div>

      <div
        class="panel-resizer"
        title="左右拖动可调整右侧属性/仿真面板宽度"
        @pointerdown="startResize('side', $event)"
      ><span></span></div>

      <!-- 右侧属性 / 检查 / 帮助 -->
      <aside class="editor-side" :style="{ width: sideW + 'px', flex: '0 0 ' + sideW + 'px' }">
        <div class="side-scroll">
          <div v-if="devOfSelected && !running" class="net-editor">
            <div class="net-editor-title">元件属性</div>
            <div class="field"><span>编号</span><input class="text-input" :value="labelDraft" @input="onLabelInput" @blur="onLabelBlur" @keydown.enter="$event.target.blur()" /></div>
            <div v-if="LINKAGE_PREFIX[devOfSelected.type]" class="field-hint">按编号自动联动：把线圈与触点的编号写成同一个（如都为 KM2），即自动关联，无需额外设置。</div>
            <div v-if="devOfSelected.type === 'pwr_terminal'" class="field">
              <span>相线（选择）</span>
              <select class="text-input phase-select" :value="phaseSelectValue" @change="onPhaseSelect">
                <option v-for="[val, name] in PHASE_OPTIONS" :key="val" :value="val">{{ name }}</option>
                <option value="__custom__">自定义（在下方输入）…</option>
              </select>
            </div>
            <div v-if="devOfSelected.type === 'pwr_terminal'" class="field">
              <span>相线名称</span>
              <input
                class="text-input"
                list="phase-presets"
                :value="devOfSelected.props?.phase || ''"
                placeholder="U / V / W / N / PE"
                @change="setTerminalPhase"
              />
              <datalist id="phase-presets">
                <option v-for="[val] in PHASE_OPTIONS" :key="val" :value="val"></option>
              </datalist>
            </div>
            <div v-if="devOfSelected.type === 'pwr_terminal'" class="field-hint">编号与相线独立：可单独改左侧「编号」，再用上方下拉或本输入框设置相线。</div>
            <div v-if="typeOfSelected?.timer" class="field"><span>延时(秒)</span><input class="text-input" type="number" step="0.5" min="0.2" :value="devOfSelected.props?.delay ?? typeOfSelected?.delay ?? 3" @change="setDelaySelected" /></div>
            <div class="field"><span>标签位置</span>
              <select class="text-input" :value="devOfSelected.labelPos || typeOfSelected?.labelPos || 'left'" @change="setLabelPosSelected">
                <option value="right">右侧</option>
                <option value="left">左侧</option>
                <option value="top">顶部居中</option>
                <option value="top-left">顶部左对齐</option>
              </select>
            </div>
            <div class="field-hint">可直接用鼠标拖动画布上的编号（如 KM1、SB1）到任意位置；下方按钮可复位。</div>
            <div v-if="devOfSelected.labelOffset" class="field-hint">标号已移动：{{ devOfSelected.labelOffset.x }}, {{ devOfSelected.labelOffset.y }}</div>
            <div v-if="devOfSelected.type === 'pwr_terminal'" class="field-hint">相线可自定义，如 U/V/W/N/PE；改后自动同步到所接导线。</div>
            <div class="net-editor-actions">
              <button class="btn small" @click="rotateSelected">旋转</button>
              <button v-if="devOfSelected.labelOffset" class="btn small" @click="resetLabelPos">复位标号</button>
              <button class="btn small danger" @click="deleteSelected">删除元件</button>
            </div>
          </div>

          <div v-else-if="noteOfSelected && !running" class="net-editor note-editor">
            <div class="net-editor-title">说明文本</div>
            <div class="net-editor-id">{{ noteOfSelected.id }}</div>
            <div class="field field-col">
              <span>说明文字</span>
              <textarea
                ref="noteTextInput"
                class="text-input note-textarea"
                rows="5"
                :value="noteTextDraft"
                placeholder="输入说明文字，可换行（例如：按下 SB2，KM1 线圈得电并自锁）"
                @input="onNoteTextInput"
                @blur="onNoteTextBlur"
              ></textarea>
            </div>
            <div class="field"><span>文字宽度</span><input class="text-input" type="number" min="90" max="1200" step="10" :value="noteOfSelected.w || 240" @change="setNoteWidth" /></div>
            <div class="field"><span>字号</span><input class="text-input" type="number" min="10" max="28" step="1" :value="noteOfSelected.fontSize || 13" @change="setNoteFontSize" /></div>
            <div class="field field-col">
              <span>配图</span>
              <div class="note-img-row">
                <label class="btn small note-file">
                  选择图片
                  <input type="file" accept="image/*" @change="onNoteImagePick" />
                </label>
                <button v-if="noteOfSelected.image" class="btn small danger" @click="removeNoteImage">移除图片</button>
              </div>
              <img v-if="noteOfSelected.image" class="note-thumb" :src="noteOfSelected.image" alt="说明配图" />
            </div>
            <template v-if="noteOfSelected.image">
              <div class="field"><span>图片位置</span>
                <select class="text-input" :value="noteOfSelected.imagePos || 'right'" @change="setNoteImagePos">
                  <option value="right">文字右侧</option>
                  <option value="left">文字左侧</option>
                  <option value="top">文字上方</option>
                </select>
              </div>
              <div class="field"><span>图片宽度</span><input class="text-input" type="number" min="40" max="800" step="10" :value="noteOfSelected.imageWidth || 180" @change="setNoteImageWidth" /></div>
            </template>
            <div class="field-hint">卡片可用鼠标拖动到任意位置；选中后按 Delete 可删除。说明文本在仿真运行时同样显示。</div>
            <div class="net-editor-actions">
              <button class="btn small danger" @click="deleteNote(noteOfSelected.id)">删除说明</button>
            </div>
          </div>

          <div v-else-if="selectedIds.length > 1 && !running" class="net-editor">
            <div class="net-editor-title">
              多选（{{ selectedIds.length }} 个元件<span v-if="selectedSegs.length"> + {{ selectedSegs.length }} 段导线</span>）
            </div>
            <div class="multi-chip-list">
              <span v-for="lb in selectedDevLabels" :key="lb" class="multi-chip">{{ lb }}</span>
            </div>
            <div class="field-hint">
              空白处按住左键拖动可框选元件与导线；拖动任一选中对象 = 整体移动（吸附网格，一次撤销）；
              Delete 删除全部元件；Esc 取消选择。
            </div>
            <div class="net-editor-actions">
              <button class="btn small" @click="rotateSelected">整体旋转</button>
              <button class="btn small danger" @click="deleteSelected">删除全部</button>
              <button class="btn small" @click="onMarqueeSelect([])">取消选择</button>
            </div>
          </div>

          <div v-else-if="netOfSelected && !running" class="net-editor">
            <div class="net-editor-title">导线属性</div>
            <div class="net-editor-id">{{ netOfSelected.id }}<span v-if="selectedSeg != null" class="seg-badge">第 {{ selectedSeg + 1 }} 段</span></div>
            <div class="field"><span>网络标号</span><input ref="netNameInput" class="text-input" :value="netNameDraft" placeholder="如 101 / L1（选中导线后按 Backspace 可快速修改）" @input="onNetNameInput" @blur="onNetNameBlur" @keydown.enter="$event.target.blur()" /></div>
            <div class="field"><span>线号</span><input ref="netTagInput" class="text-input" :value="netTagDraft" placeholder="如 1 / 3 / 5（显示在导线旁）" @input="onNetTagInput" @blur="onNetTagBlur" @keydown.enter="$event.target.blur()" /></div>
            <div class="field-hint">双击画布上的导线即可快速添加/修改线号；线号与网络标号相互独立（线号是导线编号，标号是等电位小旗）。</div>
            <div class="field"><span>相别</span>
              <input
                class="text-input"
                list="phase-presets-net"
                :value="netOfSelected.phase || ''"
                placeholder="U / V / W / N / PE / 自定义"
                @change="(e) => setNetPhase(netOfSelected.id, e.target.value)"
              />
              <datalist id="phase-presets-net">
                <option value="U"></option><option value="V"></option><option value="W"></option>
                <option value="L1"></option><option value="L2"></option><option value="L3"></option>
                <option value="L"></option><option value="N"></option><option value="PE"></option>
                <option value="PEN"></option><option value="0"></option>
              </datalist>
            </div>
            <div v-if="netOfSelected.bus && netOfSelected.geometry?.length" class="field">
              <span>长度</span>
              <input
                class="text-input"
                type="number" min="200" max="4000" step="50"
                :value="Math.abs((netOfSelected.geometry[0]?.[1]?.[0] || 0) - (netOfSelected.geometry[0]?.[0]?.[0] || 0)) || 1400"
                @change="(e) => setNetLength(netOfSelected.id, e.target.value)"
              />
            </div>
            <div class="field-hint">相别可用 U/V/W/N/PE 或自定义名称；选中导线后按 Backspace 改标号、Delete 只删选中段（接点处的其他导线不受影响）。</div>
            <div class="net-editor-actions">
              <button class="btn small" @click="editNetTag(netOfSelected.id)">添加线号</button>
              <button v-if="selectedSeg != null" class="btn small danger" @click="deleteWireSegment({ netId: netOfSelected.id, segIndex: selectedSeg })">删除选中段</button>
              <button class="btn small danger" @click="deleteNet(netOfSelected.id)">删除整条</button>
            </div>
          </div>

          <div v-else-if="!running" class="build-tip">
            {{ tool === 'wire' ? '走线：点母线接线点位或元件端子起线 → 空白处转弯 → 点端子/母线收线。中键拖动平移画布；双击导线可加线号。' : armedNote ? '说明文本：点击画布任意空白处放置说明卡片，可输入文字并配图。' : '从左侧元件库点击元件，再点击画布放置；双击导线可加线号；工具栏「💬 说明」可添加说明文字与图片。' }}
          </div>

          <template v-if="!running">
            <div class="palette-cat">电源母线</div>
            <div class="bus-config">
              <label class="bus-field">
                <span>相线（逗号分隔，可自定义）</span>
                <input v-model="busPhases" class="text-input" placeholder="留空=按类型默认：U,V,W,N,PE / L,N,PE" />
              </label>
              <div class="bus-row">
                <label class="bus-field"><span>长度(px)</span><input v-model.number="busLength" class="text-input" type="number" min="200" max="4000" step="50" /></label>
                <label class="bus-field"><span>间距(px)</span><input v-model.number="busGap" class="text-input" type="number" min="28" max="140" step="4" /></label>
              </div>
              <div class="build-actions">
                <button class="btn small" @click="busPhases = defaultPhases('3ph'); addPowerBus('3ph')">插入三相 U/V/W/N/PE</button>
                <button class="btn small" @click="busPhases = defaultPhases('1ph'); addPowerBus('1ph')">插入单相 L/N/PE</button>
                <button class="btn small primary" @click="addPowerBus('3ph')">按上面配置插入</button>
              </div>
              <div class="field-hint">母线沿线有接线点位：可从母线任意位置起线接到元件端子；选择工具下按住母线可整条拖动，支线会自动跟随，Ctrl+Z 可撤销。</div>
            </div>

            <div class="palette-cat">接线检查</div>
            <div class="check-summary">
              <div class="check-cell" :class="{ bad: inspector.unconnected.length }"><div class="check-num">{{ inspector.unconnected.length }}</div><div class="check-label">未接引脚</div></div>
              <div class="check-cell" :class="{ bad: inspector.dangling.length }"><div class="check-num">{{ inspector.dangling.length }}</div><div class="check-label">悬空导线</div></div>
              <div class="check-cell"><div class="check-num">{{ inspector.netCount }}</div><div class="check-label">网络</div></div>
              <div class="check-cell"><div class="check-num">{{ inspector.named }}</div><div class="check-label">标号</div></div>
            </div>
            <div v-if="inspector.unconnected.length" class="check-list">
              <div v-for="(u, i) in inspector.unconnected.slice(0, 8)" :key="i" class="check-row">
                <span class="check-dev">{{ u.dev }}</span><span class="check-pin">{{ u.pin }}</span>
              </div>
            </div>

            <div class="palette-cat">课程演示信息</div>
            <div class="course-editor">
              <div class="field-hint">
                点工具栏「📤 加入课程仿真」后，电路会加入 <b>{{ publishTarget }}</b>，
                这里的文字会作为课堂演示页的 <b>原理说明 / 操作步骤 / 考核要点</b> 显示，文本域内每行一条。
              </div>
              <label class="field"><span>演示摘要</span>
                <input
                  class="text-input"
                  :value="courseDrafts.summary"
                  placeholder="一句话介绍本电路（如：接触器自锁正转控制线路）"
                  @input="onCourseInput('summary', $event)"
                  @blur="onCourseBlur"
                />
              </label>
              <label class="field field-col"><span>原理说明（每行一段）</span>
                <textarea
                  rows="4"
                  :value="courseDrafts.theory"
                  placeholder="按下 SB2，KM1 线圈得电并自锁…&#10;松开 SB2 后 KM1 依靠自锁触点保持吸合…"
                  @input="onCourseInput('theory', $event)"
                  @blur="onCourseBlur"
                ></textarea>
              </label>
              <label class="field field-col"><span>操作步骤（每行一步）</span>
                <textarea
                  rows="4"
                  :value="courseDrafts.steps"
                  placeholder="1. 合上电源开关…&#10;2. 按下 SB2…"
                  @input="onCourseInput('steps', $event)"
                  @blur="onCourseBlur"
                ></textarea>
              </label>
              <label class="field field-col"><span>考核要点（每行一条）</span>
                <textarea
                  rows="3"
                  :value="courseDrafts.checkpoints"
                  placeholder="能独立完成自锁线路接线&#10;能说明 KM1 自锁触点的作用"
                  @input="onCourseInput('checkpoints', $event)"
                  @blur="onCourseBlur"
                ></textarea>
              </label>
            </div>
          </template>

          <template v-else>
            <div class="palette-cat">运行状态</div>
            <div class="state-list">
              <div v-for="(d, i) in sim.snapshot.value?.devices || {}" :key="i" class="state-card" :class="{ on: d.energized || d.closed, warn: d.tripped }">
                <span class="dot"></span>
                <span class="label">{{ i }}</span>
                <span class="desc">{{ d.energized ? '得电' : d.closed ? '闭合' : d.tripped ? '已脱扣' : '—' }}</span>
              </div>
            </div>
          </template>
        </div>
      </aside>
    </div>
  </div>
</template>
