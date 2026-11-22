<script setup>
import { onMounted, ref, computed, onUnmounted } from 'vue';
import { loadBundle, saveCircuit, deleteCircuit, isDesktop } from './api.js';
import { useSimulator } from './composables/useSimulator.js';
import CanvasView from './components/CanvasView.vue';
import Sidebar from './components/Sidebar.vue';
import InfoPanel from './components/InfoPanel.vue';
import StatePanel from './components/StatePanel.vue';
import EventLog from './components/EventLog.vue';
import BuildPanel from './components/BuildPanel.vue';
import WorkbenchView from './components/WorkbenchView.vue';

const bundle = ref({ deviceTypes: [], circuits: [], meta: {} });
const sim = useSimulator();
const currentId = ref(null);
const buildMode = ref(false);
const draft = ref(null);
const armedType = ref(null);
const tool = ref('select'); // select | wire
const selected = ref(null);
const selectedNet = ref(null);
const rightTab = ref('info');
const saveName = ref('');
const canvasRef = ref(null);
const deviceCount = computed(() => sim.circuit.value?.devices.length || 0);

/* ------------------------------------------------------------ 视图与工作台 */
const view = ref('courses'); // courses | workbench
const courseCircuits = computed(() => bundle.value.circuits.filter((c) => c.kind !== 'work'));
const works = computed(() => bundle.value.circuits.filter((c) => c.kind === 'work'));

async function onWorkCreate(doc) {
  const saved = await saveCircuit(doc);
  bundle.value.circuits.push(saved);
}
function onWorkSaved(saved) {
  const idx = bundle.value.circuits.findIndex((c) => c.id === saved.id);
  if (idx >= 0) bundle.value.circuits.splice(idx, 1, saved);
  else bundle.value.circuits.push(saved);
}
async function onWorkDelete(id) {
  await deleteCircuit(id);
  bundle.value.circuits = bundle.value.circuits.filter((c) => c.id !== id);
}

/** 作品类型 → 课程仿真里「我的电路」所属的大类：工业=电力拖动控制，家庭=常用照明电路 */
function publishedCategoryOf(work) {
  const k = work.category;
  if (k === 'drive' || k === 'industrial') return 'drive';
  if (k === 'lighting' || k === 'home') return 'lighting';
  return work.supply?.system === '3ph' ? 'drive' : 'lighting';
}

/** 刚发布的课程 id：侧栏据此自动展开它所在大类与「我的电路」子分组 */
const revealId = ref(null);

/**
 * 工作台作品 → 加入课程仿真：
 * 以 sourceWorkId 关联，重复「加入」会更新同一门课程（不会越加越多）；
 * 课程只进入与作品类型对应的那个大类的「我的电路」；
 * 演示端显示的 原理说明/操作步骤/考核要点 来自作品里的「课程演示信息」。
 */
async function onWorkPublish(workDoc) {
  const src = JSON.parse(JSON.stringify(workDoc));
  const existing = bundle.value.circuits.find((c) => c.kind !== 'work' && c.sourceWorkId === src.id);
  // 作品还是默认名（未命名）时，用演示摘要或日期给课程起名，避免课程目录里一排「未命名」
  const defaultTitle = !src.title || /^未命名(工业|家庭)电路$/.test(String(src.title).trim());
  const category = publishedCategoryOf(src);
  const course = {
    ...src,
    id: existing ? existing.id : `course-${Date.now()}`,
    kind: 'course',
    builtin: false,
    title: defaultTitle
      ? String(src.summary || '').trim() || `${category === 'drive' ? '工业' : '家庭'}电路 ${new Date().toLocaleDateString('zh-CN')}`
      : src.title,
    // 强制写入目标大类：无论作品原本是 industrial/home 还是旧数据，发布后只归到对应的「我的电路」
    category,
    order: existing?.order ?? 90,
    difficulty: existing?.difficulty ?? 2,
    duration: existing?.duration ?? 15,
    sourceWorkId: src.id,
    updatedAt: Date.now(),
  };
  const saved = await saveCircuit(course);
  const idx = bundle.value.circuits.findIndex((c) => c.id === saved.id);
  if (idx >= 0) bundle.value.circuits.splice(idx, 1, saved);
  else bundle.value.circuits.push(saved);
  view.value = 'courses';
  openCourse(saved.id);
  // 触发侧栏展开（同一门课程重复发布时也要重新展开：先清空再置值）
  revealId.value = null;
  await Promise.resolve();
  revealId.value = saved.id;
}

/** 删除「我的电路」中的课程（仅用户课程可删，内置课程不受影响） */
async function onCourseDelete(id) {
  const c = bundle.value.circuits.find((x) => x.id === id);
  if (!c || c.builtin) return;
  await deleteCircuit(id);
  bundle.value.circuits = bundle.value.circuits.filter((x) => x.id !== id);
  if (revealId.value === id) revealId.value = null;
  // 正在演示该课程时，切到第一门内置课程，避免画布停留在已删除的电路上
  if (currentId.value === id) {
    const first = bundle.value.circuits
      .filter((x) => x.kind !== 'work' && x.builtin)
      .sort((a, b) => (a.order || 99) - (b.order || 99))[0];
    if (first) openCourse(first.id);
    else {
      currentId.value = null;
      rightTab.value = 'info';
    }
  }
}

/** 课程端编辑「原理说明/操作步骤/考核要点」（仅用户自建/发布的课程可编辑） */
function onCourseInfoSave(data) {
  const c = bundle.value.circuits.find((x) => x.id === currentId.value);
  if (!c) return;
  Object.assign(c, data);
  const simc = sim.circuit.value;
  if (simc && simc.id === c.id) Object.assign(simc, data);
  saveCircuit(JSON.parse(JSON.stringify(c)));
}

onMounted(async () => {
  bundle.value = await loadBundle();
  const first = bundle.value.circuits
    .filter((c) => c.builtin)
    .sort((a, b) => (a.order || 99) - (b.order || 99))[0];
  if (first) openCourse(first.id);
  const q = new URLSearchParams(window.location.search);
  const direct = q.get('course');
  if (direct && bundle.value.circuits.some((c) => c.id === direct)) openCourse(direct);
  if (q.get('view') === 'workbench') view.value = 'workbench';
  if (q.get('autostart')) setTimeout(() => sim.demoSequence(), 1200);
  if (q.get('build')) setTimeout(() => openBuild(), 300);
});

function openCourse(id) {
  const c = bundle.value.circuits.find((x) => x.id === id);
  if (!c) return;
  buildMode.value = false;
  armedType.value = null;
  tool.value = 'select';
  selected.value = null;
  selectedNet.value = null;
  currentId.value = id;
  sim.clearActiveFaults();
  sim.open(JSON.parse(JSON.stringify(c)), bundle.value.deviceTypes);
  rightTab.value = 'info';
}

/* ------------------------------------------------------------ 搭建模式 */
function blankCircuit() {
  return {
    id: `user-${Date.now()}`,
    title: '未命名电路',
    category: 'user',
    builtin: false,
    canvas: { width: 2400, height: 1500 },
    supply: { system: '1ph', voltage: 220 },
    devices: [],
    nets: [
      { id: 'L', phase: 'L', bus: true, geometry: [[[120, 90], [1880, 90]]], label: { text: 'L 220V', x: 120, y: 80 }, pins: [] },
      { id: 'N', phase: 'N', bus: true, geometry: [[[120, 1220], [1880, 1220]]], label: { text: 'N', x: 120, y: 1242 }, pins: [] },
    ],
    faults: [],
    theory: ['这是一个自制电路，可在搭建模式下自由编辑。'],
    steps: [],
    checkpoints: [],
  };
}

function openBuild() {
  buildMode.value = true;
  if (!draft.value) draft.value = blankCircuit();
  selected.value = null;
  selectedNet.value = null;
  armedType.value = null;
  tool.value = 'select';
  sim.clearActiveFaults();
  sim.open(draft.value, bundle.value.deviceTypes);
  rightTab.value = 'build';
}

/** 把内置课程复制一份进入搭建模式：方便在现成电路上改（保留全部元件与接线） */
function editAsCopy() {
  const src = sim.circuit.value;
  if (!src) return;
  draft.value = {
    ...JSON.parse(JSON.stringify(src)),
    id: `user-${Date.now()}`,
    title: `${src.title}（副本）`,
    builtin: false,
    category: 'user',
  };
  buildMode.value = true;
  selected.value = null;
  selectedNet.value = null;
  armedType.value = null;
  tool.value = 'select';
  sim.open(draft.value, bundle.value.deviceTypes);
  rightTab.value = 'build';
}

function toggleBuild() {
  if (buildMode.value) {
    const back = currentId.value && bundle.value.circuits.find((c) => c.id === currentId.value);
    if (back && back.builtin) openCourse(back.id);
    else buildMode.value = false;
    return;
  }
  openBuild();
}

function onPlace(p) {
  if (!armedType.value || !draft.value) return;
  const t = bundle.value.deviceTypes.find((x) => x.id === armedType.value);
  if (!t) return;
  const n = draft.value.devices.filter((d) => d.type === t.id).length + 1;
  const id = `${t.short || 'X'}${n}_${Math.random().toString(36).slice(2, 5)}`;
  draft.value.devices.push({
    id,
    type: t.id,
    label: `${t.short || 'X'}${n}`,
    x: p.x,
    y: p.y,
    rot: 0,
    props: {},
  });
  armedType.value = null;
  selected.value = id;
  selectedNet.value = null;
}

/** 拖拽移动：直接改坐标，几何由渲染层按引脚位置重算，无需重建引擎 */
function onDeviceMove(id, x, y) {
  const dev = draft.value?.devices.find((d) => d.id === id);
  if (!dev) return;
  dev.x = x;
  dev.y = y;
}

function rotateSelected() {
  const dev = draft.value?.devices.find((d) => d.id === selected.value);
  if (!dev) return;
  dev.rot = ((dev.rot || 0) + 90) % 360;
}

const pinNetOf = (ref) => {
  const [d, p] = String(ref).split(':');
  return (draft.value?.nets || []).find((n) => (n.pins || []).some(([dn, pn]) => dn === d && pn === p));
};

/** 手工走线完成：把用户画出的折线写进网络（可新建、可追加、可合并） */
function onWireFinish({ from, to, points }) {
  if (!draft.value) return;
  const geom = points.map((p) => [Math.round(p.x), Math.round(p.y)]);
  const netA = pinNetOf(from);
  const netB = pinNetOf(to);
  const pushPin = (net, ref) => {
    const [d, p] = ref.split(':');
    if (!(net.pins || []).some(([dn, pn]) => dn === d && pn === p)) net.pins = [...(net.pins || []), [d, p]];
  };

  if (netA && netB && netA.id !== netB.id) {
    // 两根导线接在一起 → 合并成一个网络
    netB.pins.forEach((pin) => pushPin(netA, `${pin[0]}:${pin[1]}`));
    netA.geometry = [...(netA.geometry || []), ...(netB.geometry || []), geom];
    netA.label = netA.label || netB.label;
    netA.name = netA.name || netB.name;
    draft.value.nets = draft.value.nets.filter((n) => n.id !== netB.id);
    selectedNet.value = netA.id;
  } else if (netA) {
    pushPin(netA, to);
    netA.geometry = [...(netA.geometry || []), geom];
    selectedNet.value = netA.id;
  } else if (netB) {
    pushPin(netB, from);
    netB.geometry = [...(netB.geometry || []), geom];
    selectedNet.value = netB.id;
  } else {
    const net = {
      id: `n-${Math.random().toString(36).slice(2, 7)}`,
      pins: [],
      geometry: [geom],
    };
    pushPin(net, from);
    pushPin(net, to);
    draft.value.nets.push(net);
    selectedNet.value = net.id;
  }
  selected.value = null;
  sim.rebuild();
}

/* ------------------------------------------------------------ 网络编辑 */
const netOfSelected = computed(() => (draft.value?.nets || []).find((n) => n.id === selectedNet.value) || null);
const netList = computed(() =>
  (draft.value?.nets || []).map((n) => ({
    id: n.id,
    name: n.name || '',
    phase: n.phase || '',
    pinCount: (n.pins || []).length,
    bus: !!n.bus,
  }))
);

function setNetName(id, name) {
  const net = draft.value?.nets.find((n) => n.id === id);
  if (!net) return;
  const v = String(name || '').trim();
  if (v) net.name = v;
  else delete net.name;
  sim.rebuild();
}

function setNetPhase(id, phase) {
  const net = draft.value?.nets.find((n) => n.id === id);
  if (!net) return;
  if (phase) net.phase = phase;
  else delete net.phase;
  sim.rebuild();
}

function deleteNet(id) {
  if (!draft.value) return;
  draft.value.nets = draft.value.nets.filter((n) => n.id !== id);
  if (selectedNet.value === id) selectedNet.value = null;
  sim.rebuild();
}

/** 网络清单里双击定位：选中该网络 */
function focusNet(id) {
  selectedNet.value = id;
  selected.value = null;
}

/* ------------------------------------------------------------ 检查 */
const inspector = computed(() => {
  const c = sim.circuit.value;
  if (!c) return { unconnected: [], dangling: [], netCount: 0, named: 0 };
  const pinned = new Set();
  for (const n of c.nets || []) for (const [d, p] of n.pins || []) pinned.add(`${d}:${p}`);
  const unconnected = [];
  for (const d of c.devices || []) {
    const t = bundle.value.deviceTypes.find((x) => x.id === d.type);
    for (const p of t?.pins || []) {
      if (!pinned.has(`${d.id}:${p.id}`)) unconnected.push({ dev: d.label || d.id, pin: p.id });
    }
  }
  const dangling = (c.nets || []).filter((n) => (n.pins || []).length < 2 && !n.phase);
  const named = new Set((c.nets || []).map((n) => (n.name || '').trim()).filter(Boolean));
  return { unconnected, dangling, netCount: (c.nets || []).length, named: named.size };
});

function addThreePhase() {
  if (!draft.value) return;
  const n = draft.value.nets.filter((x) => x.id.startsWith('L1')).length + 1;
  const x0 = 160 + (n - 1) * 300;
  ['L1', 'L2', 'L3'].forEach((ph, i) => {
    draft.value.nets.push({
      id: `${ph}-${n}`,
      phase: ph,
      bus: true,
      geometry: [[[x0 + i * 80, 70], [x0 + i * 80, 760]]],
      label: { text: ph, x: x0 + i * 80 - 12, y: 60, anchor: 'end' },
      pins: [],
    });
  });
  sim.rebuild();
}

function deleteSelected() {
  if (!draft.value || !selected.value) return;
  draft.value.devices = draft.value.devices.filter((d) => d.id !== selected.value);
  draft.value.nets = draft.value.nets
    .map((n) => ({ ...n, pins: (n.pins || []).filter(([d]) => d !== selected.value) }))
    .filter((n) => (n.pins || []).length > 0);
  selected.value = null;
  sim.rebuild();
}

function clearDraft() {
  if (!draft.value) return;
  draft.value.devices = [];
  draft.value.nets = draft.value.nets.filter((n) => n.phase);
  selected.value = null;
  selectedNet.value = null;
  sim.rebuild();
}

async function saveDraft() {
  if (!draft.value) return;
  const name = saveName.value.trim() || draft.value.title || `自制电路 ${new Date().toLocaleDateString('zh-CN')}`;
  draft.value.title = name;
  const saved = await saveCircuit(JSON.parse(JSON.stringify(draft.value)));
  const idx = bundle.value.circuits.findIndex((c) => c.id === saved.id);
  if (idx >= 0) bundle.value.circuits.splice(idx, 1, saved);
  else bundle.value.circuits.push(saved);
  draft.value = saved;
  currentId.value = saved.id;
  saveName.value = '';
  sim.open(draft.value, bundle.value.deviceTypes);
  alert(`已保存：${name}`);
}

function armType(t) {
  armedType.value = armedType.value === t ? null : t;
  tool.value = armedType.value ? 'place' : 'select';
  selectedNet.value = null;
}

function setTool(t) {
  tool.value = t;
  armedType.value = null;
}

function onPinClick(ref) {
  // 走线中的第一个引脚由画布处理，这里只做提示
  if (!buildMode.value) return;
  const net = pinNetOf(ref);
  if (net) selectedNet.value = net.id;
}

function onEsc(e) {
  if (e.key === 'Escape') {
    armedType.value = null;
    tool.value = 'select';
  }
  if (buildMode.value && e.key.toLowerCase() === 'r' && selected.value) rotateSelected();
}
onMounted(() => window.addEventListener('keydown', onEsc));
onUnmounted(() => window.removeEventListener('keydown', onEsc));

const currentTitle = computed(() => (buildMode.value ? draft.value?.title || '电路搭建模式' : sim.circuit.value?.title || ''));
const currentMeta = computed(() =>
  buildMode.value
    ? `自由搭建 · 元件 ${deviceCount.value} 个 · 网络 ${inspector.value.netCount} 个`
    : `${sim.circuit.value?.summary || ''}`
);
/* 用户自建/从工作台发布的课程可编辑演示信息（内置课程只读） */
const currentCourseEditable = computed(() => {
  const c = bundle.value.circuits.find((x) => x.id === currentId.value);
  return !!(c && c.builtin === false && !buildMode.value);
});
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="logo">⚡</div>
      <div>
        <div class="title">省常技电气仿真</div>
        <div class="subtitle">常用照明电路 · 电力拖动 · 交互式仿真教学平台</div>
      </div>
      <div class="spacer" />
      <div class="view-tabs">
        <button class="view-tab" :class="{ active: view === 'courses' }" @click="view = 'courses'">课程仿真</button>
        <button class="view-tab" :class="{ active: view === 'workbench' }" @click="view = 'workbench'">仿真工作台</button>
      </div>
      <div class="badge" :class="{ live: isDesktop }">{{ isDesktop ? '桌面版 · 资源库已就绪' : '网页版 · 内置资源包' }}</div>
    </header>

    <WorkbenchView
      v-if="view === 'workbench'"
      :works="works"
      :device-types="bundle.deviceTypes"
      @create="onWorkCreate"
      @saved="onWorkSaved"
      @delete="onWorkDelete"
      @publish="onWorkPublish"
    />

    <div v-else class="app-body">
      <Sidebar
        :circuits="courseCircuits"
        :current-id="currentId"
        :build-mode="buildMode"
        :reveal-id="revealId"
        @open="openCourse"
        @open-build="openBuild"
        @delete="onCourseDelete"
      />

      <div class="main-area">
        <div class="toolbar">
          <div>
            <div class="course-title">{{ currentTitle }}</div>
            <div class="course-meta">{{ currentMeta }}</div>
          </div>
          <div class="spacer" />
          <template v-if="!buildMode">
            <button class="btn primary" @click="sim.demoSequence()">⚡ 一键演示</button>
            <button class="btn" @click="sim.reset(); canvasRef?.fit?.()">复位电路</button>
            <button class="btn" @click="rightTab = 'state'">元件状态</button>
            <button class="btn" @click="rightTab = 'log'">运行日志</button>
            <button class="btn" @click="editAsCopy">编辑副本</button>
          </template>
          <template v-else>
            <div class="tool-group">
              <button class="btn small" :class="{ primary: tool === 'select' }" @click="setTool('select')">↖ 选择</button>
              <button class="btn small" :class="{ primary: tool === 'wire' }" @click="setTool('wire')">✏️ 走线</button>
              <button class="btn small" :disabled="!selected" @click="rotateSelected">旋转</button>
              <button class="btn small danger" :disabled="!selected" @click="deleteSelected">删除</button>
            </div>
            <input v-model="saveName" class="text-input" style="width: 170px" placeholder="电路名称…" @keydown.enter="saveDraft" />
            <button class="btn primary" @click="saveDraft">保存</button>
          </template>
        </div>

        <CanvasView
          ref="canvasRef"
          :circuit="sim.circuit.value"
          :device-types="bundle.deviceTypes"
          :snapshot="sim.snapshot.value"
          :mode="buildMode ? 'build' : 'course'"
          :tool="tool"
          :selected="selected"
          :selected-net="selectedNet"
          :show-pins="buildMode"
          :armed-type="armedType"
          :wiring="tool === 'wire'"
          @activate="sim.toggleDevice"
          @press="sim.press"
          @select="(id) => { selected = id; selectedNet = null; }"
          @select-net="(id) => { selectedNet = id; selected = null; }"
          @pin-click="onPinClick"
          @place="onPlace"
          @device-move="onDeviceMove"
          @device-delete="deleteSelected"
          @wire-finish="onWireFinish"
        />
      </div>

      <div class="right-panel">
        <template v-if="buildMode">
          <BuildPanel
            :device-types="bundle.deviceTypes"
            :armed-type="armedType"
            :tool="tool"
            :selected="selected"
            :selected-net="selectedNet"
            :net-of-selected="netOfSelected"
            :net-list="netList"
            :inspector="inspector"
            :can-save="!!draft"
            @arm="armType"
            @tool="setTool"
            @select-net="focusNet"
            @rename-net="setNetName"
            @phase-net="setNetPhase"
            @delete-net="deleteNet"
            @delete="deleteSelected"
            @clear="clearDraft"
            @save="saveDraft"
            @add-three-phase="addThreePhase"
          />
        </template>
        <template v-else>
          <InfoPanel
            v-show="rightTab === 'info'"
            :circuit="sim.circuit.value"
            :editable="currentCourseEditable"
            @save="onCourseInfoSave"
          />
          <div v-show="rightTab === 'state'" style="display: flex; flex-direction: column; flex: 1; min-height: 0">
            <StatePanel
              :circuit="sim.circuit.value"
              :device-types="bundle.deviceTypes"
              :snapshot="sim.snapshot.value"
              :active-faults="sim.activeFaults"
              @toggle-fault="sim.toggleFault"
            />
          </div>
          <div v-show="rightTab === 'log'" style="display: flex; flex-direction: column; flex: 1; min-height: 0">
            <EventLog :events="sim.events.value" />
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
