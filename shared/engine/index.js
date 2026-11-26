/**
 * 省常技电气仿真 — 拓扑逻辑仿真引擎
 * ------------------------------------------------------------------
 * 设计要点：
 * 1. 数据与算法分离：电路（circuit）与元件类型（deviceTypes）都是纯数据，
 *    引擎不含任何几何/绘图逻辑，可在 Node、浏览器、Electron 中直接运行与单测。
 * 2. 拓扑逻辑仿真：
 *    - 导线 → 网络（net），闭合的开关/触点把网络「短路合并」为等电位节点；
 *    - 负载（线圈、灯、电机绕组）不参与合并，只判断两端节点是否存在电位差；
 *    - 线圈得电 → 驱动同组触点动作 → 重新求节点 → 迭代至收敛（自锁、互锁由此涌现）。
 * 3. 保护逻辑：检测 L-N 短路与相间短路，可自动使断路器跳闸并记录事件。
 */
import { DSU } from './dsu.js';

/** 非带电相：中性线 N / 保护地 PE / 保护接零 PEN / 0（控制回路公共端） */
const NEUTRAL_PHASES = new Set(['N', 'PE', 'PEN', '0']);
/**
 * 相线别名归一：不同教材/现场习惯对同一相的叫法不同，
 * 归一到 L1/L2/L3 后，U 与 L1 同接一个节点不会被误判为「相间短路」，
 * 同时保留相序信息用于电机正反转判定。
 * 未在表中的名称（用户自定义相线，如 +24V / X1）原样保留，均按带电相处理。
 */
const PHASE_ALIASES = {
  L: 'L', L1: 'L1', L2: 'L2', L3: 'L3',
  U: 'L1', V: 'L2', W: 'L3',
  A: 'L1', B: 'L2', C: 'L3',
  R: 'L1', S: 'L2', T: 'L3',
};
/** 相序索引，用于判断电机正反转 */
const PHASE_INDEX = { L: 0, L1: 0, L2: 1, L3: 2 };
/** 收敛迭代上限，超过视为振荡（竞争电路） */
const MAX_ITER = 24;

/** 把相别字符串归类为 live / neutral / pe；空值返回 null */
function classifyPhase(raw) {
  if (raw == null) return null;
  const up = String(raw).trim().toUpperCase();
  if (!up) return null;
  if (NEUTRAL_PHASES.has(up)) return { type: up === 'PE' ? 'pe' : 'neutral', key: up };
  return { type: 'live', key: PHASE_ALIASES[up] || up };
}

/**
 * 联动分组键 —— 名称即联动（本轮需求：去掉联动组，纯按编号名称自动关联）。
 * ------------------------------------------------------------------
 * 唯一依据是元件编号（label）里的电器代号：
 *   - 「KM1 常开」「KM1」→ KM1；「SB2 正转」→ SB2；「KMY」「KM△」→ KMY/KM△；
 *   - 改编号 KM1→KM2，触点立刻改归 KM2 组，与 KM2 线圈联动，无需任何额外设置。
 * 因此用户只要把线圈和触点写成同一个编号，就自动联动；改编号即改联动。
 *
 * 兼容兜底：编号不是标准电器代号（如改成中文备注「主接触器」）时，
 * 才退回历史数据里遗留的 props.group，最后才是 dev.id（彼此独立）。
 * 新数据不再写 group，这条兜底只为保证老作品升级后不失效。
 *
 * 电器代号前缀（KM/SB/KT…）只用于联动类元件；灯(EL)/电机(M)/端子(X)等不带这些前缀，
 * 不会被误归组。代号后缀允许数字与字母（兼容 KMY/KM△/KM1B 等写法）。
 */
const DEVICE_CODE_RE = /^\s*((?:KM|KT|KA|SB|FR|QF|SA|SQ|ST)\s*[0-9A-Za-z\u0394\u25b3]*)/i;
function groupKeyOf(dev) {
  const m = DEVICE_CODE_RE.exec(String(dev.label || ''));
  if (m) return m[1].replace(/\s+/g, '').toUpperCase();
  if (dev.props?.group) return String(dev.props.group).toUpperCase();
  return dev.id;
}

function toTypeMap(deviceTypes) {
  if (Array.isArray(deviceTypes)) {
    const map = {};
    for (const t of deviceTypes) map[t.id] = t;
    return map;
  }
  return deviceTypes || {};
}

/** 数组是否相等 */
function sameArray(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** 判断三相相序：偶排列为正转 */
function permParity(order) {
  let inv = 0;
  for (let i = 0; i < order.length; i += 1) {
    for (let j = i + 1; j < order.length; j += 1) {
      if (order[i] > order[j]) inv += 1;
    }
  }
  return inv % 2 === 0 ? 1 : -1;
}

export class SimulationEngine {
  /**
   * @param {{circuit: object, deviceTypes: object[]|object}} options
   */
  constructor({ circuit, deviceTypes }) {
    if (!circuit) throw new Error('电路数据缺失');
    this.circuit = circuit;
    this.types = toTypeMap(deviceTypes);
    this.nets = new Map((circuit.nets || []).map((n) => [n.id, n]));
    this.devices = new Map((circuit.devices || []).map((d) => [d.id, d]));

    /** `${deviceId}:${pinId}` → netId */
    this.pinNet = new Map();
    for (const net of this.nets.values()) {
      for (const [devId, pinId] of net.pins || []) {
        this.pinNet.set(`${devId}:${pinId}`, net.id);
      }
    }
    /** 网络标号 → 网络集合。同名标号在电气上视为同一点（原理图标准做法）。 */
    this.namedNets = new Map();
    for (const net of this.nets.values()) {
      const name = (net.name || '').trim();
      if (!name) continue;
      if (!this.namedNets.has(name)) this.namedNets.set(name, []);
      this.namedNets.get(name).push(net.id);
    }
    this.reset();
  }

  // ---------------------------------------------------------------- 生命周期
  reset() {
    this.rt = {};
    for (const dev of this.devices.values()) {
      const type = this.types[dev.type] || {};
      const initial = dev.props?.initial || type.initial || 'open';
      this.rt[dev.id] = {
        state: initial, // 'open' | 'closed' | 'a' | 'b'（双控开关）
        pressed: false,
        tripped: false,
        blown: false,
        energized: false,
        lit: false,
        done: false, // 延时触点是否已动作
        since: null, // 定时器起点
      };
    }
    /** 触点组状态（线圈得电 / 按钮按下），跨 compute 调用保持，是「自锁」成立的前提 */
    this.groups = {};
    for (const dev of this.devices.values()) this.groups[groupKeyOf(dev)] = { energized: false, pressed: false };
    /** 通电延时：线圈得电计时 → done；断电延时：线圈失电计时 → active */
    this.timerDone = {};
    this.offTimer = {};
    this.faults = [];
    this.protection = { tripped: [], at: null };
    this.snapshot = null;
    this.stable = true;
  }

  /** 手动操作开关 / 断路器：state = 'closed' | 'open' | 'a' | 'b' */
  setState(devId, state) {
    const rt = this.rt[devId];
    if (!rt) return false;
    rt.state = state;
    if (state === 'closed') rt.tripped = false;
    return true;
  }

  /** 切换两态元件（开关、断路器） */
  toggle(devId) {
    const rt = this.rt[devId];
    const type = this.types[this.devices.get(devId)?.type];
    if (!rt || !type) return false;
    if (type.variant === '2way') {
      rt.state = rt.state === 'a' ? 'b' : 'a';
      return true;
    }
    rt.state = rt.state === 'closed' ? 'open' : 'closed';
    if (rt.state === 'closed') rt.tripped = false;
    return true;
  }

  /** 按钮按下 / 松开（复合按钮同组联动） */
  press(devId, down) {
    const dev = this.devices.get(devId);
    if (!dev) return false;
    const key = groupKeyOf(dev);
    const rt = this.rt[devId];
    rt.pressed = !!down;
    this.groups[key] = { ...(this.groups[key] || { energized: false }), pressed: !!down };
    return true;
  }

  /** 热继电器/断路器人为脱扣（故障注入） */
  setTripped(devId, tripped) {
    const rt = this.rt[devId];
    if (!rt) return false;
    rt.tripped = !!tripped;
    return true;
  }

  /** 熔断器熔断（故障注入） */
  setBlown(devId, blown) {
    const rt = this.rt[devId];
    if (!rt) return false;
    rt.blown = !!blown;
    return true;
  }

  /**
   * 故障注入。目前支持 type = 'short'（两点短接），between = [netA, netB]
   */
  injectFault(fault) {
    if (!fault || fault.type !== 'short') return false;
    const [a, b] = fault.between || [];
    if (!this.nets.has(a) || !this.nets.has(b)) return false;
    this.faults.push({ id: fault.id || `fault-${this.faults.length + 1}`, ...fault });
    return true;
  }

  clearFaults() {
    this.faults = [];
    this.protection = { tripped: [], at: null };
  }

  // ---------------------------------------------------------------- 导电判定
  /** 返回该元件当前导通的引脚对（空数组表示断开） */
  conductionPairs(dev, type, groupStates, timerDone, offTimer) {
    const rt = this.rt[dev.id];
    const role = type.role;
    const poles = type.poles || [];

    const activeOf = () => {
      const key = groupKeyOf(dev);
      // timerMode：on=通电延时（旧数据无此字段但有 timer/delay 时按 on 处理，保持兼容）；
      // off=断电延时（线圈失电后延时复位）；instant=瞬动（随线圈立即动作）。
      const mode = type.timerMode || (type.timer || type.delay ? 'on' : 'instant');
      if (mode === 'off') return !!(offTimer?.[key]?.active);
      if (mode === 'instant') return !!groupStates[key]?.energized;
      const timer = timerDone[key];
      return !!(timer && timer.done);
    };

    switch (role) {
      case 'contact': {
        const active = activeOf();
        const closed = type.nc ? !active : active;
        return closed ? poles : [];
      }
      case 'button': {
        const pressed = !!groupStates[groupKeyOf(dev)]?.pressed;
        // 复合按钮（一常开 + 一常闭，共用推杆）：按下时 NO 闭合、NC 断开
        if (type.polesNO || type.polesNC) {
          const out = [];
          if (pressed && Array.isArray(type.polesNO)) out.push(...type.polesNO);
          if (!pressed && Array.isArray(type.polesNC)) out.push(...type.polesNC);
          return out;
        }
        const closed = type.nc ? !pressed : pressed;
        return closed ? poles : [];
      }
      case 'switch': {
        if (type.variant === '2way') {
          const sel = rt.state === 'b' ? type.polesB : type.polesA;
          return sel || [];
        }
        const on = rt.state === 'closed';
        // 复合行程开关：撞块压下（closed）时 NO 闭合、NC 断开
        if (type.polesNO || type.polesNC) {
          const out = [];
          if (on && Array.isArray(type.polesNO)) out.push(...type.polesNO);
          if (!on && Array.isArray(type.polesNC)) out.push(...type.polesNC);
          return out;
        }
        return on ? poles : [];
      }
      case 'breaker':
        return rt.state === 'closed' && !rt.tripped ? poles : [];
      case 'fuse':
        return rt.blown ? [] : poles;
      case 'thermal':
        // 热继电器触点：常闭过载后断开（切断控制回路），常开（报警）过载后闭合
        if (type.nc) return rt.tripped ? [] : poles;
        return rt.tripped ? poles : [];
      case 'passive':
        // 端子、镇流器、热元件、电流表等在逻辑上始终导通
        return poles;
      case 'load':
      case 'motor':
        return []; // 负载不并入等电位节点，只判断电位差
      default:
        return poles;
    }
  }

  // ---------------------------------------------------------------- 求解主干
  /**
   * 给定一组触点状态，求解一次电路
   */
  solve(groupStates, timerDone, offTimer) {
    const dsu = new DSU([...this.nets.keys()]);

    // 网络标号：同名网络等电位（与导线直连等效）
    for (const ids of this.namedNets.values()) {
      for (let i = 1; i < ids.length; i += 1) dsu.union(ids[0], ids[i]);
    }

    // 故障注入：两点短接
    for (const f of this.faults) {
      if (f.type === 'short') dsu.union(f.between[0], f.between[1]);
    }

    const deviceRuntime = {};
    for (const dev of this.devices.values()) {
      const type = this.types[dev.type] || {};
      const pairs = this.conductionPairs(dev, type, groupStates, timerDone, offTimer);
      deviceRuntime[dev.id] = { closed: pairs.length > 0, role: type.role };
      for (const [pa, pb] of pairs) {
        const na = this.pinNet.get(`${dev.id}:${pa}`);
        const nb = this.pinNet.get(`${dev.id}:${pb}`);
        if (na && nb) dsu.union(na, nb);
      }
    }

    // 汇总各等电位节点的电位信息
    const comps = new Map();
    for (const [netId, net] of this.nets) {
      const root = dsu.find(netId);
      let comp = comps.get(root);
      if (!comp) {
        comp = { root, nets: [], live: new Set(), neutral: false, pe: false };
        comps.set(root, comp);
      }
      comp.nets.push(netId);
      const cls = classifyPhase(net.phase);
      if (cls?.type === 'live') comp.live.add(cls.key);
      else if (cls?.type === 'neutral') comp.neutral = true;
      else if (cls?.type === 'pe') comp.pe = true;
    }

    const compOfPin = (devId, pinId) => {
      const netId = this.pinNet.get(`${devId}:${pinId}`);
      if (!netId) return null;
      return comps.get(dsu.find(netId)) || null;
    };

    // 负载得电判定：一端带相电位，另一端为中性线或不同相
    const loadStates = {};
    for (const dev of this.devices.values()) {
      const type = this.types[dev.type] || {};
      if (type.role === 'load') {
        const [p1, p2] = type.loadPins || type.pins?.map((p) => p.id) || [];
        const ca = compOfPin(dev.id, p1);
        const cb = compOfPin(dev.id, p2);
        let energized = false;
        if (ca && cb && ca.root !== cb.root) {
          const aLive = ca.live.size > 0;
          const bReturn = cb.neutral || [...cb.live].some((p) => !ca.live.has(p));
          energized = aLive && bReturn;
        }
        loadStates[dev.id] = { energized };
      }
      if (type.role === 'motor') {
        loadStates[dev.id] = this.solveMotor(dev, type, compOfPin);
      }
    }

    // 短路检测
    const shorted = [];
    for (const comp of comps.values()) {
      const phaseCount = comp.live.size;
      if (phaseCount >= 2 || (phaseCount >= 1 && comp.neutral)) {
        shorted.push({ nets: comp.nets.slice(), phases: [...comp.live], neutral: comp.neutral });
      }
    }

    // 节点带电信息
    const nets = {};
    for (const [netId, net] of this.nets) {
      const comp = comps.get(dsu.find(netId));
      nets[netId] = {
        live: comp ? comp.live.size > 0 : false,
        neutral: comp ? comp.neutral : false,
        phases: comp ? [...comp.live] : [],
        component: comp ? comp.root : null,
        name: net.name || null,
      };
    }

    return { nets, loads: loadStates, devices: deviceRuntime, shorts: shorted, comps };
  }

  /** 电机状态：三相是否齐备、Y/Δ 接法、正反转 */
  solveMotor(dev, type, compOfPin) {
    const pins = (type.pins || []).map((p) => p.id);
    const groups = {
      main: pins.filter((p) => /^[UVW]1$/i.test(p)),
      tail: pins.filter((p) => /^[UVW]2$/i.test(p)),
    };
    const phaseOf = (pinId) => {
      const comp = compOfPin(dev.id, pinId);
      if (!comp || comp.live.size === 0) return null;
      // 取第一个相作为标识（同一节点不应同时带两相，否则已判为短路）
      return [...comp.live][0];
    };

    const mainPhases = groups.main.map(phaseOf);
    const present = mainPhases.filter(Boolean);
    const distinct = new Set(present);
    const complete = groups.main.length === 3 && distinct.size === 3;
    const singlePhase = groups.main.length === 1 && present.length === 1;

    let mode = null;
    if (groups.tail.length === 3) {
      // 六端子电机：绕组末端必须被接成星形（同一点）或三角形（各带一相）才能构成回路
      const tailComps = groups.tail.map((p) => compOfPin(dev.id, p));
      const roots = tailComps.map((c) => (c ? c.root : null));
      const tailPhases = groups.tail.map(phaseOf);
      if (roots.every(Boolean) && new Set(roots).size === 1 && !tailPhases.some(Boolean)) mode = 'Y';
      else if (tailPhases.every(Boolean) && new Set(tailPhases).size === 3) mode = 'Δ';
      else mode = null;
    } else {
      mode = 'Δ'; // 三端子电机按内部已接成三角形处理
    }

    const running = groups.tail.length === 3 ? complete && mode !== null : complete || singlePhase;
    let direction = 'stopped';
    if (complete && running) {
      const order = mainPhases.map((p) => PHASE_INDEX[p] ?? 0);
      direction = permParity(order) > 0 ? 'forward' : 'reverse';
    } else if (singlePhase) {
      direction = 'forward';
    }

    const lineVoltage = this.circuit.supply?.voltage ?? 380;
    const windingVoltage = !running ? 0 : mode === 'Y' ? Math.round(lineVoltage / Math.sqrt(3)) : lineVoltage;

    return {
      energized: running,
      running,
      direction,
      mode,
      phaseLoss: groups.main.length === 3 && present.length > 0 && distinct.size < 3,
      phases: mainPhases,
      windingVoltage,
    };
  }

  // ---------------------------------------------------------------- 迭代
  /**
   * 计算当前时刻的电路状态。
   * @param {number} now 毫秒时间戳（用于时间继电器）
   */
  compute(now = Date.now()) {
    let iter = 0;
    let stable = false;
    let solution = null;

    while (iter < MAX_ITER) {
      solution = this.solve(this.groups, this.timerDone, this.offTimer);
      let changed = false;

      // 1) 线圈得电 → 触点组动作
      for (const dev of this.devices.values()) {
        const type = this.types[dev.type] || {};
        if (type.role !== 'load') continue;
        const key = groupKeyOf(dev);
        const energized = !!solution.loads[dev.id]?.energized;
        const prev = this.groups[key]?.energized;
        if (prev !== energized) {
          this.groups[key] = { ...(this.groups[key] || { pressed: false }), energized };
          changed = true;
        }
        // 2) 时间继电器计时（延时秒数可由元件数据或设备属性指定）
        if (type.timer) {
          const delay = Number(dev.props?.delay ?? type.delay ?? 3) * 1000;
          const mode = type.timerMode || 'on';
          if (mode === 'off') {
            // 断电延时（缓放）：线圈得电触点立即动作；失电后开始计时，到整定时间才复位
            const t = this.offTimer[key] || { since: null, active: false };
            if (energized) {
              if (!t.active) { t.active = true; changed = true; }
              if (t.since !== null) { t.since = null; changed = true; }
            } else if (t.active) {
              if (t.since === null) t.since = now;
              if (now - t.since >= delay) {
                t.active = false;
                t.since = null;
                changed = true;
              }
            }
            this.offTimer[key] = t;
          } else {
            // 通电延时（缓吸）：线圈得电计时，到整定时间动作；失电立即复位
            const timer = this.timerDone[key] || { since: null, done: false };
            if (energized) {
              if (timer.since === null) {
                timer.since = now;
                timer.done = false;
              }
              const reached = now - timer.since >= delay;
              if (reached && !timer.done) {
                timer.done = true;
                changed = true;
              }
            } else if (timer.since !== null || timer.done) {
              timer.since = null;
              timer.done = false;
              changed = true;
            }
            this.timerDone[key] = timer;
          }
        }
      }

      if (!changed) {
        stable = true;
        break;
      }
      iter += 1;
    }

    // 保护动作：短路 → 断路器跳闸
    const protectionTrips = [];
    if (solution.shorts.length > 0) {
      for (const dev of this.devices.values()) {
        const type = this.types[dev.type] || {};
        if (type.role !== 'breaker') continue;
        const rt = this.rt[dev.id];
        if (rt.state === 'closed' && !rt.tripped && dev.props?.tripOnShort !== false) {
          rt.tripped = true;
          protectionTrips.push(dev.id);
        }
      }
    }

    const snapshot = {
      time: now,
      stable,
      iterations: iter,
      nets: solution.nets,
      loads: solution.loads,
      devices: {},
      groups: JSON.parse(JSON.stringify(this.groups)),
      shorts: solution.shorts,
      protection: { tripped: protectionTrips },
    };

    for (const dev of this.devices.values()) {
      const type = this.types[dev.type] || {};
      const rt = this.rt[dev.id];
      const dr = solution.devices[dev.id] || {};
      snapshot.devices[dev.id] = {
        state: rt.state,
        pressed: rt.pressed,
        tripped: rt.tripped,
        blown: rt.blown,
        closed: !!dr.closed,
        energized: !!solution.loads[dev.id]?.energized,
        lit: type.role === 'load' && /lamp|light|tube/i.test(type.symbol || '') ? !!solution.loads[dev.id]?.energized : false,
        motor: solution.loads[dev.id]?.running !== undefined ? solution.loads[dev.id] : undefined,
        done:
          type.timerMode === 'off'
            ? !!this.offTimer[groupKeyOf(dev)]?.active
            : !!this.timerDone[groupKeyOf(dev)]?.done,
        delay: type.delay ?? null,
        timerLeft: (() => {
          const key = groupKeyOf(dev);
          const d = Number(dev.props?.delay ?? type.delay ?? 3) * 1000;
          if (type.timerMode === 'off') {
            const t = this.offTimer[key];
            return t?.active && t.since != null ? Math.max(0, d - (now - t.since)) : null;
          }
          const t = this.timerDone[key];
          return t?.since != null && !t.done ? Math.max(0, d - (now - t.since)) : null;
        })(),
      };
    }

    // 主电机（用于总览面板）
    const motorDev = this.circuit.devices.find((d) => this.types[d.type]?.role === 'motor');
    if (motorDev) {
      snapshot.motor = {
        id: motorDev.id,
        label: motorDev.label || motorDev.id,
        ...solution.loads[motorDev.id],
        ...snapshot.devices[motorDev.id],
      };
    }

    this.snapshot = snapshot;
    this.stable = stable;
    return snapshot;
  }

  /**
   * 复位并回到初始状态
   */
  shutdown() {
    this.reset();
    return this.compute(Date.now());
  }
}

export default SimulationEngine;
