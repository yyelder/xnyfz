<script setup>
import { ref, watch } from 'vue';

/**
 * 课程演示信息面板：原理说明 / 操作步骤 / 考核要点。
 * - 内置课程：只读展示；
 * - 用户自建 / 从工作台「加入课程仿真」发布的课程：可点击「编辑」修改三要素
 *   （每行一条），保存后写入资源库。
 */
const props = defineProps({
  circuit: { type: Object, default: null },
  editable: { type: Boolean, default: false },
});
const emit = defineEmits(['save']);

const tab = ref('theory');
const editing = ref(false);
const form = ref({ summary: '', theory: '', steps: '', checkpoints: '' });

const linesOf = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
const joinOf = (arr) => (arr || []).join('\n');

watch(
  () => props.circuit?.id,
  () => {
    tab.value = 'theory';
    editing.value = false;
  }
);

function startEdit() {
  const c = props.circuit || {};
  form.value = {
    summary: c.summary || '',
    theory: joinOf(c.theory),
    steps: joinOf(c.steps),
    checkpoints: joinOf(c.checkpoints),
  };
  editing.value = true;
}
function cancelEdit() {
  editing.value = false;
}
function saveEdit() {
  emit('save', {
    summary: String(form.value.summary || '').trim(),
    theory: linesOf(form.value.theory),
    steps: linesOf(form.value.steps),
    checkpoints: linesOf(form.value.checkpoints),
  });
  editing.value = false;
}
</script>

<template>
  <div class="panel-root">
    <div class="panel-tabs">
      <div class="panel-tab" :class="{ active: tab === 'theory' }" @click="tab = 'theory'">原理说明</div>
      <div class="panel-tab" :class="{ active: tab === 'steps' }" @click="tab = 'steps'">操作步骤</div>
      <div class="panel-tab" :class="{ active: tab === 'checks' }" @click="tab = 'checks'">考核要点</div>
    </div>
    <div class="panel-body">
      <!-- 编辑入口：用户自建/发布的课程才显示 -->
      <div v-if="editable" class="course-edit-bar">
        <template v-if="editing">
          <button class="btn small" @click="cancelEdit">取消</button>
          <button class="btn small primary" @click="saveEdit">保存</button>
        </template>
        <button v-else class="btn small" @click="startEdit">✏️ 编辑演示信息</button>
      </div>
      <!-- 编辑态：三要素一起编辑，每行一条 -->
      <div v-if="editing" class="course-editor">
        <label class="field field-col"><span>演示摘要</span>
          <input class="text-input" v-model="form.summary" placeholder="一句话介绍本电路" />
        </label>
        <label class="field field-col"><span>原理说明（每行一段）</span>
          <textarea rows="5" v-model="form.theory" placeholder="每行一个自然段…"></textarea>
        </label>
        <label class="field field-col"><span>操作步骤（每行一步）</span>
          <textarea rows="5" v-model="form.steps" placeholder="每行一个操作步骤…"></textarea>
        </label>
        <label class="field field-col"><span>考核要点（每行一条）</span>
          <textarea rows="4" v-model="form.checkpoints" placeholder="每行一个考核要点…"></textarea>
        </label>
      </div>

      <div v-else-if="tab === 'theory'" class="theory">
        <h4>{{ circuit?.title }}</h4>
        <p v-for="(p, i) in circuit?.theory || []" :key="i">{{ p }}</p>
        <p v-if="!(circuit?.theory || []).length" class="empty-hint">
          {{ editable ? '还没有原理说明 —— 点上方「✏️ 编辑」补充，课堂演示时展示在这里。' : '暂无说明' }}
        </p>
      </div>
      <div v-else-if="tab === 'steps'">
        <h4>实训操作步骤</h4>
        <ol class="steps">
          <li v-for="(s, i) in circuit?.steps || []" :key="i">{{ s }}</li>
        </ol>
        <p v-if="!(circuit?.steps || []).length" class="empty-hint">
          {{ editable ? '还没有操作步骤 —— 点上方「✏️ 编辑」补充。' : '暂无步骤' }}
        </p>
      </div>
      <div v-else>
        <h4>考核要点</h4>
        <ul class="checkpoints">
          <li v-for="(s, i) in circuit?.checkpoints || []" :key="i">{{ s }}</li>
        </ul>
        <p v-if="!(circuit?.checkpoints || []).length" class="empty-hint">
          {{ editable ? '还没有考核要点 —— 点上方「✏️ 编辑」补充。' : '暂无要点' }}
        </p>
      </div>
    </div>
  </div>
</template>
