<script setup>
/**
 * 元件库面板（对齐竞品布局：顶部搜索 + 左侧分类导航 + 符号网格）
 * 点击元件进入「放置」状态，在画布空白处点击落位。
 */
import { ref, computed } from 'vue';
import { drawSymbol } from '../../../shared/render/symbols.js';
import { typeBounds } from '../../../shared/render/layout.js';

const props = defineProps({
  deviceTypes: { type: Array, default: () => [] },
  armedType: { type: String, default: null },
});
const emit = defineEmits(['arm']);

/**
 * 分类按用户清单的 14 类组织，与 device-types.json 的 group 字段一一对应；
 * 末尾「其他」收纳断路器、仪表、接近开关等未列入清单的元件。
 */
const CATEGORIES = [
  { id: 'switch', name: '常用开关' },
  { id: 'limit', name: '行程开关' },
  { id: 'button', name: '按钮' },
  { id: 'contactor', name: '接触器' },
  { id: 'thermal', name: '热继电器' },
  { id: 'timer', name: '时间继电器' },
  { id: 'relay', name: '中间继电器' },
  { id: 'fuse', name: '熔断器' },
  { id: 'motor', name: '常用电动机' },
  { id: 'transformer', name: '变压器' },
  { id: 'signal', name: '信号灯' },
  { id: 'lighting', name: '照明灯' },
  { id: 'socket', name: '插头和插座' },
  { id: 'terminal', name: '接线端子' },
  { id: 'other', name: '其他' },
];

/**
 * 部分大类内部再按国标功能分小节（时间继电器：线圈 / 延时闭合 / 延时断开 / 瞬动）。
 * 与 device-types.json 的 subgroup 字段对应；未配置小节的大类仍是单一网格。
 */
const SUBGROUPS = {
  timer: [
    { id: 'coil', name: '线圈' },
    { id: 'delay-close', name: '延时闭合触点' },
    { id: 'delay-open', name: '延时断开触点' },
    { id: 'instant', name: '瞬动触点' },
  ],
};

const activeCat = ref('switch');
const search = ref('');

const grouped = computed(() => {
  const q = search.value.trim();
  const hit = (t) => !q || t.name.includes(q) || t.id.toLowerCase().includes(q.toLowerCase());
  return CATEGORIES.map((c) => {
    const types = props.deviceTypes.filter((t) => (t.group || 'other') === c.id && hit(t));
    const defs = SUBGROUPS[c.id];
    const sections = defs
      ? defs
          .map((s) => ({ ...s, types: types.filter((t) => (t.subgroup || 'coil') === s.id) }))
          .filter((s) => s.types.length > 0)
      : [{ id: 'all', name: '', types }];
    return { ...c, types, sections };
  }).filter((c) => c.types.length > 0);
});

const shown = computed(() => {
  if (search.value.trim()) return grouped.value; // 搜索时展示所有命中分类
  return grouped.value.filter((c) => c.id === activeCat.value);
});

/**
 * 符号缩略图：用图形包围盒（含 bbox 覆盖）取景，避免 FR 的侧向标记被裁掉；
 * 再与引脚范围求并集，并保证最小画幅，圆形线圈等也不会被切边。
 */
function preview(type) {
  const body = drawSymbol(type, { closed: false, state: 'a', lit: false, pressed: false });
  const b = typeBounds(type);
  const xs = (type.pins || []).map((p) => p.x);
  const ys = (type.pins || []).map((p) => p.y);
  let minX = Math.min(b.minX, ...xs, 0) - 6;
  let maxX = Math.max(b.maxX, ...xs, 0) + 6;
  let minY = Math.min(b.minY, ...ys, 0) - 6;
  let maxY = Math.max(b.maxY, ...ys, 0) + 6;
  const MIN = 60;
  if (maxX - minX < MIN) {
    const c = (minX + maxX) / 2;
    minX = c - MIN / 2;
    maxX = c + MIN / 2;
  }
  if (maxY - minY < MIN) {
    const c = (minY + maxY) / 2;
    minY = c - MIN / 2;
    maxY = c + MIN / 2;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  return {
    body,
    viewBox: `${minX} ${minY} ${w} ${h}`,
    ratio: w / h,
  };
}

function pick(type) {
  emit('arm', type.id);
}
</script>

<template>
  <div class="devlib">
    <div class="devlib-search">
      <input v-model="search" class="text-input" placeholder="搜索元器件名称" />
    </div>
    <div class="devlib-body">
      <div class="devlib-cats">
        <div
          v-for="c in CATEGORIES"
          :key="c.id"
          class="devlib-cat"
          :class="{ active: !search && activeCat === c.id }"
          @click="activeCat = c.id; search = ''"
        >
          {{ c.name }}
        </div>
      </div>
      <div class="devlib-grid-wrap">
        <div v-for="c in shown" :key="c.id" class="devlib-group">
          <div class="devlib-group-title">{{ c.name }}</div>
          <div v-for="s in c.sections" :key="s.id" class="devlib-section">
            <div v-if="s.name" class="devlib-section-title">{{ s.name }}</div>
            <div class="devlib-grid">
              <button
                v-for="t in s.types"
                :key="t.id"
                class="devlib-item"
                :class="{ active: armedType === t.id }"
                :title="`${t.name}（${t.desc || ''}）`"
                @click="pick(t)"
              >
                <svg class="devlib-sym" :viewBox="preview(t).viewBox" preserveAspectRatio="xMidYMid meet" v-html="preview(t).body" />
                <span class="devlib-name">{{ t.name }}</span>
              </button>
            </div>
          </div>
        </div>
        <div v-if="!shown.length" class="devlib-empty">没有匹配的元件</div>
      </div>
    </div>
    <div class="devlib-tip">点击元件 → 在画布空白处点击放置（Esc 取消）</div>
  </div>
</template>
