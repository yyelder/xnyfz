<script setup>
import { computed } from 'vue';

const props = defineProps({
  circuit: { type: Object, default: null },
  deviceTypes: { type: Array, default: () => [] },
  snapshot: { type: Object, default: null },
  activeFaults: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['toggle-fault']);

/** 需要在状态面板展示的关键元件：线圈、灯、电机、断路器、时间继电器触点 */
const states = computed(() => {
  if (!props.snapshot || !props.circuit) return [];
  const out = [];
  for (const dev of props.circuit.devices) {
    const t = props.deviceTypes.find((x) => x.id === dev.type);
    const rt = props.snapshot.devices[dev.id];
    if (!t || !rt) continue;
    let desc = '';
    let on = false;
    let warn = false;

    if (t.role === 'load' && t.symbol === 'coil') {
      on = rt.energized;
      desc = on ? '线圈得电，触点已联动' : '线圈失电';
      if (t.timer && rt.done) desc = '计时完成，延时触点已动作';
      else if (t.timer && rt.timerLeft != null) desc = `计时中，剩余 ${(rt.timerLeft / 1000).toFixed(1)} s`;
    } else if (t.role === 'load') {
      on = rt.energized;
      desc = on ? '通电工作' : '断电';
    } else if (t.role === 'motor') {
      const m = rt.motor || {};
      on = m.running;
      desc = m.running
        ? `${m.direction === 'reverse' ? '反转' : '正转'} · ${m.mode === 'Y' ? 'Y 形接法' : 'Δ 形接法'} · 绕组 ${m.windingVoltage}V`
        : '停转';
      if (m.phaseLoss) { warn = true; desc = '缺相运行！'; }
    } else if (t.role === 'breaker') {
      on = rt.state === 'closed' && !rt.tripped;
      warn = !!rt.tripped;
      desc = rt.tripped ? '已脱扣（保护动作）' : rt.state === 'closed' ? '合闸运行' : '分闸';
    } else if (t.role === 'thermal') {
      warn = !!rt.tripped;
      on = !rt.tripped;
      desc = rt.tripped ? '过载脱扣，触点断开' : '正常（常闭闭合）';
    } else {
      continue;
    }
    out.push({ id: dev.id, label: dev.label, desc, on, warn });
  }
  return out;
});
</script>

<template>
  <div class="panel-root">
    <div class="panel-tabs">
      <div class="panel-tab active">元件状态</div>
      <div class="panel-tab" style="pointer-events: none; opacity: 0.45">故障注入 ↓</div>
    </div>
  <div class="panel-body">
    <div v-if="snapshot?.shorts?.length" class="build-tip" style="background: #fdecec; border-color: #f1c4c4; color: #b91c1c">
      ⚠ 检测到短路，保护元件已脱扣。请复位后排除故障。
    </div>
    <div v-for="s in states" :key="s.id" class="state-card" :class="{ on: s.on, warn: s.warn }">
      <div class="dot" />
      <div class="label">{{ s.label }}</div>
      <div class="desc">{{ s.desc }}</div>
    </div>

    <div v-if="circuit?.faults?.length" class="fault-section">
      <h4>故障注入（教学演示）</h4>
      <button
        v-for="f in circuit.faults"
        :key="f.id"
        class="btn fault-btn"
        :class="{ active: activeFaults[f.id] }"
        :title="f.desc"
        @click="emit('toggle-fault', f)"
      >
        {{ activeFaults[f.id] ? '● ' : '○ ' }}{{ f.name }}
      </button>
    </div>
    </div>
  </div>
</template>
