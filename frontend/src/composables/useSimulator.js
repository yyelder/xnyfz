/**
 * 仿真器组合式函数：引擎实例管理、交互动作、事件日志、计时器心跳
 */
import { reactive, ref, computed, onUnmounted } from 'vue';
import { SimulationEngine } from '../../../shared/engine/index.js';

export function useSimulator() {
  const circuit = ref(null);
  const deviceTypes = ref([]);
  const snapshot = ref(null);
  const events = ref([]);
  const shorted = computed(() => (snapshot.value?.shorts?.length || 0) > 0);
  const stable = computed(() => snapshot.value?.stable !== false);

  let engine = null;
  let timer = null;
  let prevSnap = null;

  const typeOf = (devId) => {
    const dev = circuit.value?.devices.find((d) => d.id === devId);
    return dev ? deviceTypes.value.find((t) => t.id === dev.type) : null;
  };

  function log(kind, text) {
    events.value.unshift({ kind, text, at: new Date() });
    if (events.value.length > 120) events.value.pop();
  }

  /** 与上一次快照对比，生成可读事件 */
  function diffEvents(next) {
    if (!prevSnap || !circuit.value) return;
    const labelOf = (id) => circuit.value.devices.find((d) => d.id === id)?.label || id;

    for (const dev of circuit.value.devices) {
      const type = typeOf(dev.id);
      if (!type) continue;
      const now = next.devices[dev.id] || {};
      const before = prevSnap.devices[dev.id] || {};

      if (type.role === 'load' && type.symbol === 'coil') {
        if (now.energized && !before.energized) log('on', `${labelOf(dev.id)} 线圈得电吸合`);
        if (!now.energized && before.energized) log('off', `${labelOf(dev.id)} 线圈失电释放`);
        if (now.timerLeft != null && Math.floor(now.timerLeft / 1000) !== Math.floor((before.timerLeft ?? 0) / 1000)) {
          // 倒计时整秒提示（仅记录关键节点，避免刷屏）
        }
      }
      if (type.role === 'load' && /lamp|tube|socket/.test(type.symbol || '')) {
        if (now.energized && !before.energized) log('on', `${labelOf(dev.id)} 通电工作`);
        if (!now.energized && before.energized) log('off', `${labelOf(dev.id)} 断电停止`);
      }
      if (type.role === 'motor') {
        const m1 = now.motor || {};
        const m0 = before.motor || {};
        if (m1.running && !m0.running) log('on', `${labelOf(dev.id)} 电动机启动（${m1.direction === 'reverse' ? '反转' : '正转'}，${m1.mode === 'Y' ? 'Y 形' : 'Δ 形'} ${m1.windingVoltage}V）`);
        if (!m1.running && m0.running) log('off', `${labelOf(dev.id)} 电动机停转`);
        if (m1.running && m0.running && m1.direction !== m0.direction) log('warn', `${labelOf(dev.id)} 旋转换向`);
        if (m1.running && m0.running && m1.mode !== m0.mode) {
          log('info', `${labelOf(dev.id)} 绕组切换为${m1.mode === 'Y' ? '星形（Y）' : '三角形（Δ）'}，每相电压 ${m1.windingVoltage}V`);
        }
      }
      if ((type.role === 'breaker' || type.role === 'thermal') && now.tripped && !before.tripped) {
        log('warn', `${labelOf(dev.id)} 保护动作（脱扣）`);
      }
    }

    if (next.shorts.length > 0 && prevSnap.shorts.length === 0) {
      const kinds = next.shorts.map((s) => (s.neutral ? '相线对零线短路' : '相间短路')).join('、');
      log('warn', `⚠ 检测到${kinds}，断路器保护动作`);
    }
  }

  function compute() {
    if (!engine) return;
    const next = engine.compute(Date.now());
    diffEvents(next);
    prevSnap = next;
    snapshot.value = next;
  }

  function open(newCircuit, types) {
    circuit.value = newCircuit;
    if (types) deviceTypes.value = types;
    events.value = [];
    prevSnap = null;
    engine = new SimulationEngine({ circuit: newCircuit, deviceTypes: deviceTypes.value });
    compute();
    log('info', `已加载课程：${newCircuit.title}`);
    if (!timer) {
      timer = setInterval(compute, 200); // 心跳：驱动时间继电器与动画
    }
  }

  /**
   * 电路结构被编辑（增删网络、改标号）后重建引擎。
   * 与 open 的区别：不清空事件日志，保留当前操作上下文。
   */
  function rebuild() {
    if (!circuit.value) return;
    const keepEvents = events.value;
    engine = new SimulationEngine({ circuit: circuit.value, deviceTypes: deviceTypes.value });
    prevSnap = null;
    compute();
    events.value = keepEvents;
  }

  function reset() {
    if (!engine || !circuit.value) return;
    engine.reset();
    events.value = [];
    prevSnap = null;
    compute();
    log('info', '电路已复位，全部开关回到初始状态');
  }

  function toggleDevice(id) {
    if (!engine) return;
    engine.toggle(id);
    const type = typeOf(id);
    const label = circuit.value?.devices.find((d) => d.id === id)?.label || id;
    const rt = snapshot.value?.devices[id];
    compute();
    const after = snapshot.value?.devices[id];
    if (type?.role === 'breaker') {
      log(after?.state === 'closed' && !after?.tripped ? 'on' : 'off', `${label} ${after?.state === 'closed' ? '合闸' : '分闸'}`);
    } else if (type?.role === 'switch') {
      log(after?.closed ? 'on' : 'off', `${label} ${after?.closed ? '闭合' : '断开'}`);
    }
  }

  function press(id, down) {
    if (!engine) return;
    engine.press(id, down);
    compute();
  }

  function setTripped(id, tripped) {
    if (!engine) return;
    engine.setTripped(id, tripped);
    compute();
  }

  /** 故障注入（来自课程数据 faults 定义） */
  const activeFaults = reactive({});
  function toggleFault(fault) {
    if (!engine) return;
    const key = fault.id;
    if (activeFaults[key]) {
      if (fault.type === 'short') engine.clearFaults();
      if (fault.type === 'trip') (fault.devices || []).forEach((d) => engine.setTripped(d, false));
      activeFaults[key] = false;
      log('info', `故障「${fault.name}」已解除`);
    } else {
      if (fault.type === 'short') engine.injectFault(fault);
      if (fault.type === 'trip') (fault.devices || []).forEach((d) => engine.setTripped(d, true));
      activeFaults[key] = true;
      log('warn', `注入故障：${fault.name}`);
    }
    compute();
  }

  function clearActiveFaults() {
    for (const k of Object.keys(activeFaults)) activeFaults[k] = false;
  }

  /** 一键演示：合上全部电源开关，并触发一次启动按钮（用于课堂快速演示） */
  function demoSequence() {
    if (!engine || !circuit.value) return;
    for (const dev of circuit.value.devices) {
      const t = typeOf(dev.id);
      if (!t) continue;
      if (t.role === 'breaker') engine.setState(dev.id, 'closed');
      if (t.role === 'switch' && t.variant !== '2way') engine.setState(dev.id, 'closed');
    }
    compute();
    log('info', '一键演示：主开关已全部合闸');
    const startBtn = circuit.value.devices.find((d) => {
      const t = typeOf(d.id);
      return t?.role === 'button' && !t.nc;
    });
    if (startBtn) {
      press(startBtn.id, true);
      setTimeout(() => {
        press(startBtn.id, false);
      }, 1800);
    }
  }

  onUnmounted(() => {
    if (timer) clearInterval(timer);
    timer = null;
  });

  return {
    circuit, deviceTypes, snapshot, events, shorted, stable, activeFaults,
    open, rebuild, reset, toggleDevice, press, setTripped, toggleFault, clearActiveFaults, compute, demoSequence,
  };
}
