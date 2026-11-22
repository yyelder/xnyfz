<script>
/**
 * 侧栏折叠状态放在模块级单例里（而非组件实例），
 * 这样在「课程仿真 ⇄ 仿真工作台」切换、Sidebar 被 v-if 销毁重建后仍能保留用户的折叠偏好。
 */
import { reactive } from 'vue';
export const foldState = reactive({
  cat: { lighting: false, drive: false },  // true = 已折叠
  mine: { lighting: false, drive: false }, // 每个大类下「我的电路」子分组
});
</script>

<script setup>
import { ref, computed, watch } from 'vue';

const props = defineProps({
  circuits: { type: Array, default: () => [] },
  currentId: { type: String, default: null },
  buildMode: { type: Boolean, default: false },
  /** 刚从工作台发布的课程 id：自动展开它所属的分类与「我的电路」子分组 */
  revealId: { type: String, default: null },
});
const emit = defineEmits(['open', 'open-build', 'delete']);

/* 课程仿真只有两个大类，每个大类内部各自包含一节「我的电路」 */
const categories = [
  { key: 'lighting', name: '常用照明电路', icon: '💡' },
  { key: 'drive', name: '电力拖动控制', icon: '⚙️' },
];

/**
 * 判断一条课程归属哪个大类。
 * - 内置课程：category = lighting / drive
 * - 工作台作品发布出来的课程：category = lighting / drive（发布时按作品类型写入）
 * - 历史数据兼容：home→照明、industrial→拖动、user/缺失→按供电制式兜底（三相归拖动）
 */
function groupOf(c) {
  const k = c.category;
  if (k === 'drive' || k === 'industrial') return 'drive';
  if (k === 'lighting' || k === 'home') return 'lighting';
  return c.supply?.system === '3ph' ? 'drive' : 'lighting';
}

/** 某大类下的内置课程（按 order 排序） */
function builtinList(key) {
  return props.circuits
    .filter((c) => c.builtin && groupOf(c) === key)
    .sort((a, b) => (a.order || 99) - (b.order || 99));
}
/** 某大类下「我的电路」的内容（用户发布 / 搭建模式保存的课程，按更新时间倒序） */
function mineList(key) {
  return props.circuits
    .filter((c) => !c.builtin && groupOf(c) === key)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

const collapsed = foldState;
function toggleCat(key) { collapsed.cat[key] = !collapsed.cat[key]; }
function toggleMine(key) { collapsed.mine[key] = !collapsed.mine[key]; }

/** 工作台发布后自动展开目标分组，让「添加进对应的我的电路」立刻可见 */
function applyReveal() {
  const c = props.circuits.find((x) => x.id === props.revealId);
  if (!c) return;
  const key = groupOf(c);
  collapsed.cat[key] = false;
  if (!c.builtin) collapsed.mine[key] = false;
}
// 重复「加入课程仿真」时 revealId 不变，用课程列表变化兜底重新展开
watch([() => props.revealId, () => props.circuits], applyReveal, { immediate: true });

/* 删除采用内联二次确认，避免误删，也不弹原生对话框 */
const pendingDelete = ref(null);
function askDelete(id) { pendingDelete.value = id; }
function cancelDelete() { pendingDelete.value = null; }
function confirmDelete(id) {
  pendingDelete.value = null;
  emit('delete', id);
}

const difficultyLabel = ['入门', '基础', '进阶', '综合'];
const totalCount = computed(() => props.circuits.length);
</script>

<template>
  <aside class="sidebar">
    <div class="cat">课程目录</div>
    <div class="course-list">
      <section v-for="cat in categories" :key="cat.key" class="cat-group">
        <!-- 一级：大类标题，可折叠 -->
        <div
          class="cat-head"
          :class="{ collapsed: collapsed.cat[cat.key] }"
          :data-cat="cat.key"
          @click="toggleCat(cat.key)"
        >
          <span class="caret">▾</span>
          <span class="cat-head-name">{{ cat.icon }} {{ cat.name }}</span>
          <span class="cat-count">{{ builtinList(cat.key).length + mineList(cat.key).length }}</span>
        </div>

        <div v-show="!collapsed.cat[cat.key]" class="cat-body" :data-cat-body="cat.key">
          <!-- 内置课程 -->
          <div
            v-for="c in builtinList(cat.key)"
            :key="c.id"
            class="course-item"
            :class="{ active: !buildMode && c.id === currentId }"
            @click="emit('open', c.id)"
          >
            <div class="no">{{ c.order || '•' }}</div>
            <div class="course-text">
              <div class="name">{{ c.title }}</div>
              <div class="meta">{{ difficultyLabel[(c.difficulty || 1) - 1] }} · 约 {{ c.duration || 15 }} 分钟</div>
            </div>
          </div>

          <!-- 二级：该大类下的「我的电路」，同样可折叠 -->
          <div
            class="mine-head"
            :class="{ collapsed: collapsed.mine[cat.key] }"
            :data-mine="cat.key"
            @click="toggleMine(cat.key)"
          >
            <span class="caret">▾</span>
            <span class="mine-name">✏️ 我的电路</span>
            <span class="cat-count">{{ mineList(cat.key).length }}</span>
          </div>

          <div v-show="!collapsed.mine[cat.key]" class="mine-body" :data-mine-body="cat.key">
            <template v-if="mineList(cat.key).length">
              <div
                v-for="c in mineList(cat.key)"
                :key="c.id"
                class="course-item user"
                :class="{ active: !buildMode && c.id === currentId, reveal: c.id === revealId }"
                :data-course-id="c.id"
                @click="emit('open', c.id)"
              >
                <div class="no">我</div>
                <div class="course-text">
                  <div class="name">{{ c.title }}</div>
                  <div class="meta">{{ difficultyLabel[(c.difficulty || 1) - 1] }} · 约 {{ c.duration || 15 }} 分钟</div>
                </div>
                <div class="item-actions" @click.stop>
                  <template v-if="pendingDelete === c.id">
                    <button class="del-confirm" title="确认删除该电路" @click="confirmDelete(c.id)">删除?</button>
                    <button class="del-cancel" title="取消" @click="cancelDelete">取消</button>
                  </template>
                  <button v-else class="del-btn" title="从我的电路中删除" @click="askDelete(c.id)">🗑</button>
                </div>
              </div>
            </template>
            <div v-else class="mine-empty">暂无自制电路 · 在「仿真工作台」发布后会出现在这里</div>
          </div>
        </div>
      </section>
    </div>
    <div class="sidebar-footer">
      <button class="btn primary" style="width: 100%" @click="emit('open-build')">
        {{ buildMode ? '返回课程模式' : '进入电路搭建模式' }}
      </button>
      <div style="margin-top: 8px">资源库：{{ totalCount }} 个电路 · 独立数据包</div>
    </div>
  </aside>
</template>
