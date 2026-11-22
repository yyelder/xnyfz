/**
 * 资源数据访问层
 * - 桌面模式：通过 Electron 预加载桥（window.scjApi）访问主进程的独立资源库；
 * - 网页模式：加载打包内置的资源包（构建时由 resources/packs 生成），用户电路存 localStorage。
 * 两端接口一致，页面代码无需感知运行环境。
 */

const bridge = typeof window !== 'undefined' ? window.scjApi : null;

import deviceTypesPack from '../../resources/packs/device-types.json';
const builtinCircuitModules = import.meta.glob('../../resources/packs/circuits/*.json', { eager: true });

const LS_KEY = 'scj.user-circuits.v1';

function readLocalUserCircuits() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeLocalUserCircuits(list) {
  localStorage.setItem(LS_KEY, JSON.stringify(list));
}

export const isDesktop = !!bridge;

export async function loadBundle() {
  if (bridge) {
    const bundle = await bridge.getBundle();
    return bundle;
  }
  const builtin = Object.values(builtinCircuitModules).map((m) => ({ ...(m.default || m), builtin: true }));
  return {
    deviceTypes: deviceTypesPack.types,
    circuits: [...builtin, ...readLocalUserCircuits()],
    meta: { source: 'web', seedVersion: deviceTypesPack.version },
    __debug: builtin.slice(0,2).map(c=>({id:c.id, builtin:c.builtin, keys:Object.keys(c).slice(0,8)})),
  };
}

export async function saveCircuit(circuit) {
  const doc = { ...circuit, builtin: false, updatedAt: Date.now() };
  if (bridge) {
    await bridge.saveCircuit(doc);
    return doc;
  }
  const list = readLocalUserCircuits().filter((c) => c.id !== doc.id);
  list.push(doc);
  writeLocalUserCircuits(list);
  return doc;
}

export async function deleteCircuit(id) {
  if (bridge) {
    await bridge.deleteCircuit(id);
    return;
  }
  writeLocalUserCircuits(readLocalUserCircuits().filter((c) => c.id !== id));
}

export async function resetResources() {
  if (bridge) {
    await bridge.resetResources();
    return loadBundle();
  }
  return loadBundle();
}
