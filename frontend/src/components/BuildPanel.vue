<script setup>
/**
 * 搭建面板：元件库 + 网络清单（网络标号）+ 接线检查。
 * 与画布的分工：画布负责「画」，这里负责「填参数」。
 */
import { ref, computed } from 'vue';

const props = defineProps({
  deviceTypes: { type: Array, default: () => [] },
  armedType: { type: String, default: null },
  tool: { type: String, default: 'select' },
  selected: { type: String, default: null },
  selectedNet: { type: String, default: null },
  netOfSelected: { type: Object, default: null },
  netList: { type: Array, default: () => [] },
  inspector: { type: Object, default: () => ({ unconnected: [], dangling: [], netCount: 0, named: 0 }) },
  canSave: { type: Boolean, default: false },
});
const emit = defineEmits([
  'arm', 'tool', 'select-net', 'rename-net', 'phase-net', 'delete-net',
  'delete', 'clear', 'save', 'add-three-phase',
]);

const tab = ref('palette');
const nameDraft = ref('');

const groups = computed(() => {
  const by = { protection: [], switch: [], control: [], load: [], power: [], other: [] };
  for (const t of props.deviceTypes) {
    if (!by[t.category]) continue;
    by[t.category].push(t);
  }
  const meta = {
    protection: { name: '保护元件', icon: '🛡️' },
    switch: { name: '开关电器', icon: '🔀' },
    control: { name: '控制电器', icon: '🔘' },
    load: { name: '负载与用电器', icon: '💡' },
    power: { name: '主电路元件', icon: '⚡' },
    other: { name: '其他', icon: '🔧' },
  };
  return Object.entries(by)
    .filter(([, list]) => list.length)
    .map(([key, list]) => ({ key, ...meta[key], list }));
});

const shortName = (t) => t.name.replace(/（.*?）/g, '');
const icon = (t) => {
  const s = t.symbol || '';
  if (s === 'coil') return '🧲';
  if (s.includes('motor')) return '🔄';
  if (s.includes('lamp')) return '💡';
  if (s === 'tube') return '🔆';
  if (s.includes('breaker') || s === 'rcd2') return '🛡️';
  if (s.includes('switch')) return '🔀';
  if (s.includes('contact')) return '▤';
  if (s === 'thermal_nc' || s === 'thermal3') return '🌡️';
  if (s.includes('button')) return '🔘';
  return '◆';
};

const copied = ref(false);
async function copySolution() {
  const lines = props.netList.map((n) => `${n.id}${n.name ? ` [${n.name}]` : ''} · ${n.pinCount} 个接点`);
  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    alert(lines.join('\n'));
  }
}

function commitName() {
  if (!props.netOfSelected) return;
  emit('rename-net', props.netOfSelected.id, nameDraft.value);
}

function openNet(n) {
  emit('select-net', n.id);
  nameDraft.value = n.name || '';
}
</script>

<template>
  <div class="panel-root">
    <div class="panel-tabs">
      <div class="panel-tab" :class="{ active: tab === 'palette' }" @click="tab = 'palette'">元件库</div>
      <div class="panel-tab" :class="{ active: tab === 'nets' }" @click="tab = 'nets'">网络标号</div>
      <div class="panel-tab" :class="{ active: tab === 'check' }" @click="tab = 'check'">
        接线检查<span v-if="inspector.unconnected.length" class="tab-dot" />
      </div>
    </div>

    <!-- ------------------------------------------------ 元件库 -->
    <div v-if="tab === 'palette'" class="panel-body">
      <div class="build-tip">
        ① 点选元件后到画布上点击放置；② 切换「走线」，点起点引脚 → 点拐点 → 点终点引脚；
        <br />③ 拖动元件可移动，按 <kbd>R</kbd> 旋转、<kbd>Delete</kbd> 删除。
      </div>

      <div class="build-actions">
        <button class="btn small" :class="{ primary: tool === 'select' }" @click="emit('tool', 'select')">↖ 选择/移动</button>
        <button class="btn small" :class="{ primary: tool === 'wire' }" @click="emit('tool', 'wire')">✏️ 手工走线</button>
        <button class="btn small" @click="emit('add-three-phase')">⚡ 三相母线</button>
        <button class="btn small danger" @click="emit('clear')">清空</button>
      </div>

      <template v-for="g in groups" :key="g.key">
        <div class="palette-cat">{{ g.icon }} {{ g.name }}</div>
        <div class="palette-grid">
          <div
            v-for="t in g.list"
            :key="t.id"
            class="palette-item"
            :class="{ active: armedType === t.id }"
            @click="emit('arm', t.id)"
          >
            <span class="sym">{{ icon(t) }}</span>
            {{ shortName(t) }}
          </div>
        </div>
      </template>

      <div style="margin-top: 16px">
        <button class="btn primary" style="width: 100%" :disabled="!canSave" @click="emit('save')">
          保存到「我的电路」
        </button>
      </div>
    </div>

    <!-- ------------------------------------------------ 网络标号 -->
    <div v-else-if="tab === 'nets'" class="panel-body">
      <div class="build-tip">
        同名标号的导线在电气上是<b>同一点</b>，相当于用导线直接连起来 —— 可减少长距离走线。
        <br />点击画布上的导线即可选中，再改名。
      </div>

      <div v-if="netOfSelected" class="net-editor">
        <div class="net-editor-title">选中网络</div>
        <div class="net-editor-id">{{ netOfSelected.id }} · {{ (netOfSelected.pins || []).length }} 个接点</div>
        <label class="field">
          <span>网络标号</span>
          <input
            v-model="nameDraft"
            class="text-input"
            :placeholder="netOfSelected.name || '如 L1、N、101、KM1-A1'"
            @change="commitName"
            @keydown.enter="commitName"
          />
        </label>
        <label class="field">
          <span>相别 / 电位</span>
          <select
            class="text-input"
            :value="netOfSelected.phase || ''"
            @change="(e) => emit('phase-net', netOfSelected.id, e.target.value)"
          >
            <option value="">（普通导线）</option>
            <option value="L1">L1 相</option>
            <option value="L2">L2 相</option>
            <option value="L3">L3 相</option>
            <option value="L">L（单相火线）</option>
            <option value="N">N 零线</option>
            <option value="PE">PE 保护线</option>
          </select>
        </label>
        <div class="net-editor-actions">
          <button class="btn small" @click="commitName">应用标号</button>
          <button class="btn small danger" @click="emit('delete-net', netOfSelected.id)">删除网络</button>
        </div>
      </div>
      <div v-else class="net-editor empty">在画布上点击一根导线以编辑它的网络标号</div>

      <div class="palette-cat" style="margin-top: 14px">
        📋 网络清单（{{ netList.length }}）
        <button class="mini-link" @click="copySolution">{{ copied ? '已复制' : '复制' }}</button>
      </div>
      <div class="net-list">
        <div
          v-for="n in netList"
          :key="n.id"
          class="net-row"
          :class="{ active: selectedNet === n.id }"
          @click="openNet(n)"
        >
          <span class="net-badge" :class="n.phase ? 'phase' : ''">{{ n.name || n.phase || '—' }}</span>
          <span class="net-id">{{ n.id }}</span>
          <span class="net-count">{{ n.pinCount }}</span>
        </div>
      </div>
    </div>

    <!-- ------------------------------------------------ 检查 -->
    <div v-else class="panel-body">
      <div class="check-summary">
        <div class="check-cell">
          <div class="check-num">{{ inspector.netCount }}</div>
          <div class="check-label">网络</div>
        </div>
        <div class="check-cell">
          <div class="check-num">{{ inspector.named }}</div>
          <div class="check-label">标号</div>
        </div>
        <div class="check-cell" :class="{ bad: inspector.unconnected.length }">
          <div class="check-num">{{ inspector.unconnected.length }}</div>
          <div class="check-label">未接引脚</div>
        </div>
        <div class="check-cell" :class="{ bad: inspector.dangling.length }">
          <div class="check-num">{{ inspector.dangling.length }}</div>
          <div class="check-label">悬空网络</div>
        </div>
      </div>

      <div v-if="!inspector.unconnected.length && !inspector.dangling.length" class="check-ok">
        ✓ 接线完整：所有引脚均已连接，没有悬空网络
      </div>

      <div v-if="inspector.unconnected.length" class="palette-cat">⚠ 未连接的引脚</div>
      <div class="check-list">
        <div v-for="(u, i) in inspector.unconnected" :key="i" class="check-row">
          <span class="check-dev">{{ u.dev }}</span>
          <span class="check-pin">{{ u.pin }}</span>
        </div>
      </div>

      <div v-if="inspector.dangling.length" class="palette-cat">⚠ 悬空网络（只有一个接点）</div>
      <div class="check-list">
        <div v-for="n in inspector.dangling" :key="n.id" class="check-row">
          <span class="check-dev">{{ n.name || n.id }}</span>
          <span class="check-pin">1 点</span>
        </div>
      </div>
    </div>
  </div>
</template>
