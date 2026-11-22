<script setup>
const props = defineProps({
  events: { type: Array, default: () => [] },
});
const fmt = (d) => {
  const t = new Date(d);
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
};
</script>

<template>
  <div class="panel-root">
    <div class="panel-tabs">
      <div class="panel-tab active">运行日志</div>
      <div class="panel-tab" style="pointer-events: none; opacity: 0.45">事件记录</div>
    </div>
    <div class="panel-body">
      <div v-if="!events.length" class="log-empty">操作电路后，动作事件将在这里实时记录</div>
      <div class="log-list">
        <div v-for="(e, i) in events" :key="i" class="log-item" :class="e.kind">
          <span class="t">{{ fmt(e.at) }}</span>
          <span>{{ e.text }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
