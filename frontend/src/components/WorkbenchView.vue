<script setup>
/**
 * 仿真工作台（对齐 simgrap「仿真工作台」页）
 * ------------------------------------------------------------------
 * 按用户要求只保留两个创建入口：工业电路仿真 / 家庭电路仿真。
 * 两者均创建原理图仿真作品（工业=三相骨架，家庭=单相骨架）并进入编辑器，
 * 不再区分「原理图 / 实物」入口。作品数据走资源数据库。
 */
import { ref, computed } from 'vue';
import SchematicEditor from './SchematicEditor.vue';

const props = defineProps({
  works: { type: Array, default: () => [] },
  deviceTypes: { type: Array, default: () => [] },
});
const emit = defineEmits(['create', 'open', 'delete', 'saved', 'publish']);

const currentId = ref(null);
const currentWork = computed(() => props.works.find((w) => w.id === currentId.value) || null);

const ENTRIES = [
  { id: 'industrial-sim', title: '工业电路仿真', sub: '电力拖动 · 三相', mode: 'industrial', icon: '⚙️' },
  { id: 'home-sim', title: '家庭电路仿真', sub: '常用照明 · 单相', mode: 'home', icon: '💡' },
];

/* 新作品默认骨架（对齐竞品：新建即有可接线的示例元件组）
 * 元件默认靠画布左侧排布，右侧留出大片空间用于扩展接线/说明文本。
 * 画布默认 2400×1500（用户要求「大一点」）。 */
function skeletonDevices(threePhase) {
  const T = (id, ph, x) => ({
    id, type: 'pwr_terminal', label: ph, labelPos: 'top', x, y: 160, rot: 0, props: { phase: ph },
  });
  if (threePhase) {
    return [
      T('XT_U', 'U', 120), T('XT_V', 'V', 200), T('XT_W', 'W', 280),
      T('XT_N', 'N', 360), T('XT_PE', 'PE', 440),
      // 联动 = 名称：KM1 主触点 / 辅助常开 / 线圈编号同为 KM1 → 自动联动吸合、自锁成立
      { id: 'KM1', type: 'km_no_3p', label: 'KM1', labelPos: 'left', x: 220, y: 470, rot: 0, props: {} },
      { id: 'SB1', type: 'sb_nc', label: 'SB1', labelPos: 'left', x: 550, y: 320, rot: 0, props: {} },
      { id: 'SB2', type: 'sb_no', label: 'SB2', labelPos: 'left', x: 670, y: 470, rot: 0, props: {} },
      { id: 'KM1NO', type: 'km_no', label: 'KM1', labelPos: 'left', x: 790, y: 470, rot: 0, props: {} },
      { id: 'M1', type: 'm_3ph', label: 'M1', labelPos: 'left', x: 280, y: 700, rot: 0, props: {} },
      { id: 'KM1C', type: 'km_coil', label: 'KM1', labelPos: 'left', x: 690, y: 720, rot: 0, props: {} },
    ];
  }
  return [
    T('XT_L', 'L', 160), T('XT_N', 'N', 300), T('XT_PE', 'PE', 440),
    { id: 'SA2', type: 'sa_2way', label: 'SA2', labelPos: 'left', x: 270, y: 400, rot: 0, props: {} },
    { id: 'EL1', type: 'el_lamp', label: 'EL1', labelPos: 'left', x: 545, y: 500, rot: 0, props: {} },
    { id: 'SA1', type: 'sa_2way', label: 'SA1', labelPos: 'left', x: 270, y: 660, rot: 0, props: {} },
  ];
}

function blankWork(entry) {
  const threePhase = entry.mode === 'industrial';
  return {
    id: `work-${Date.now()}`,
    kind: 'work',
    viewType: 'schematic',
    category: entry.mode,
    entry: entry.id,
    title: entry.mode === 'industrial' ? '未命名工业电路' : '未命名家庭电路',
    builtin: false,
    canvas: { width: 2400, height: 1500 },
    supply: threePhase ? { system: '3ph', voltage: 380 } : { system: '1ph', voltage: 220 },
    devices: skeletonDevices(threePhase),
    nets: [],
    annotations: [],
    faults: [],
    theory: [],
    steps: [],
    checkpoints: [],
  };
}

function create(entry) {
  const w = blankWork(entry);
  emit('create', w);
  currentId.value = w.id;
}

function open(id) {
  currentId.value = id;
}
function back() {
  currentId.value = null;
}
function onSaved(doc) {
  emit('saved', doc);
}
function remove(id) {
  if (!window.confirm('删除该作品？')) return;
  if (currentId.value === id) currentId.value = null;
  emit('delete', id);
}
const fmt = (ts) => {
  const d = ts ? new Date(ts) : null;
  return d ? d.toLocaleString('zh-CN', { hour12: false }) : '—';
};
</script>

<template>
  <!-- 编辑态 -->
  <SchematicEditor
    v-if="currentWork"
    :key="currentWork.id"
    :work="currentWork"
    :device-types="deviceTypes"
    @back="back"
    @saved="onSaved"
    @publish="(doc) => emit('publish', doc)"
  />

  <!-- 工作台 -->
  <div v-else class="workbench">
    <div class="wb-entries">
      <button v-for="e in ENTRIES" :key="e.id" class="wb-entry" @click="create(e)">
        <span class="wb-icon">{{ e.icon }}</span>
        <span class="wb-entry-text">
          <span class="wb-entry-title">{{ e.title }}</span>
          <span class="wb-entry-sub">{{ e.sub }} · 原理图仿真</span>
          <span class="wb-entry-tag">{{ e.mode === 'industrial' ? '三相 380V' : '单相 220V' }}</span>
        </span>
        <span class="wb-plus">＋</span>
      </button>
    </div>

    <div class="wb-list-head">
      <span class="wb-title">我的作品</span>
      <span class="wb-count">{{ works.length }} 个</span>
    </div>

    <div v-if="!works.length" class="wb-empty">
      还没有作品 —— 点击上方入口，从空白原理图或元件库开始搭建你的第一个电路。
    </div>
    <div class="wb-grid">
      <div v-for="w in works" :key="w.id" class="wb-card" @click="open(w.id)">
        <div class="wb-thumb" :class="w.category">
          <span class="wb-thumb-badge">{{ w.category === 'industrial' ? '工业' : '家庭' }}</span>
          <svg viewBox="0 0 120 68" class="wb-thumb-svg">
            <rect x="0" y="0" width="120" height="68" fill="#f9fbff" />
            <path d="M 10 12 H 110 M 10 22 H 110 M 10 56 H 110" stroke="#cddcf0" stroke-width="1" />
            <circle cx="30" cy="34" r="10" fill="none" stroke="#182635" stroke-width="2" />
            <text x="30" y="38" font-size="9" text-anchor="middle" fill="#182635">M</text>
            <rect x="62" y="26" width="22" height="14" fill="none" stroke="#182635" stroke-width="2" />
            <line x1="40" y1="34" x2="62" y2="34" stroke="#33475e" stroke-width="1.6" />
            <line x1="84" y1="34" x2="110" y2="34" stroke="#33475e" stroke-width="1.6" />
            <line x1="30" y1="24" x2="30" y2="12" stroke="#33475e" stroke-width="1.6" />
          </svg>
        </div>
        <div class="wb-card-body">
          <div class="wb-card-title">{{ w.title }}</div>
          <div class="wb-card-meta">
            <span class="wb-time">{{ fmt(w.updatedAt) }}</span>
            <span class="wb-tag">{{ w.viewType === 'schematic' ? '原理图' : '实物' }}</span>
          </div>
        </div>
        <button class="wb-del" title="删除作品" @click.stop="remove(w.id)">🗑</button>
      </div>
    </div>
  </div>
</template>
