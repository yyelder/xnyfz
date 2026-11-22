<script setup>
/**
 * 元件库面板（对齐竞品布局：顶部搜索 + 左侧分类导航 + 符号网格）
 * 点击元件进入「放置」状态，在画布空白处点击落位。
 */
import { ref, computed } from 'vue';
import { drawSymbol } from '../../../shared/render/symbols.js';

const props = defineProps({
  deviceTypes: { type: Array, default: () => [] },
  armedType: { type: String, default: null },
});
const emit = defineEmits(['arm']);

/* 分类对齐竞品：开关按钮 / 用电元件 / 保护元件 / 控制元件 / 传感元件 / 电源仪表 / 其他 */
const CATEGORIES = [
  { id: 'switch', name: '开关按钮', test: (t) => t.category === 'switch' || t.role === 'button' },
  { id: 'load', name: '用电元件', test: (t) => t.category === 'load' },
  { id: 'protection', name: '保护元件', test: (t) => t.category === 'protection' || t.id.startsWith('fr_') },
  {
    id: 'control',
    name: '控制元件',
    test: (t) => ['km_coil', 'kt_coil', 'km_no', 'km_nc', 'km_no_3p', 'kt_no', 'kt_nc', 'ka_coil', 'ka_no', 'ka_nc'].includes(t.id),
  },
  { id: 'sensor', name: '传感元件', test: (t) => t.category === 'sensor' },
  { id: 'instrument', name: '电源仪表', test: (t) => t.category === 'instrument' },
  { id: 'other', name: '其他', test: (t) => t.category === 'other' || t.category === 'power' },
];

const activeCat = ref('switch');
const search = ref('');

const grouped = computed(() => {
  const q = search.value.trim();
  const hit = (t) => !q || t.name.includes(q) || t.id.toLowerCase().includes(q.toLowerCase());
  return CATEGORIES.map((c) => ({
    ...c,
    types: props.deviceTypes.filter((t) => c.test(t) && hit(t)),
  })).filter((c) => c.types.length > 0);
});

const shown = computed(() => {
  if (search.value.trim()) return grouped.value; // 搜索时展示所有命中分类
  return grouped.value.filter((c) => c.id === activeCat.value);
});

/** 符号缩略图：按引脚坐标推断 viewBox，保持元件完整可见 */
function preview(type) {
  const body = drawSymbol(type, { closed: false, state: 'a', lit: false, pressed: false });
  const xs = (type.pins || []).map((p) => p.x);
  const ys = (type.pins || []).map((p) => p.y);
  const minX = Math.min(0, ...xs) - 16;
  const maxX = Math.max(0, ...xs) + 16;
  const minY = Math.min(0, ...ys) - 16;
  const maxY = Math.max(0, ...ys) + 16;
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
          <div class="devlib-grid">
            <button
              v-for="t in c.types"
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
        <div v-if="!shown.length" class="devlib-empty">没有匹配的元件</div>
      </div>
    </div>
    <div class="devlib-tip">点击元件 → 在画布空白处点击放置（Esc 取消）</div>
  </div>
</template>
