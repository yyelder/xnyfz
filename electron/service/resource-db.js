/**
 * 资源数据库（独立于业务代码的数据层）
 * ------------------------------------------------------------------
 * 设计：
 * 1. 全部「资源」——元件类型库、电路课程——保存在独立的数据文件中，
 *    不参与打包进前端代码，可随包内置资源包（resources/packs）热升级；
 * 2. 内置资源按 seedVersion 版本导入：升级程序后自动刷新内置课程，
 *    而用户自建的电路（id 以 user- 开头）始终保留；
 * 3. 写入采用「临时文件 + 原子替换」，避免断电/崩溃导致库损坏；
 * 4. 本文件为 JSON 文档库驱动（零原生依赖、跨平台可靠）。
 *    如需切换为 SQLite，仅需按相同接口实现 SqliteDriver 并注入（见 README）。
 */
const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;

class ResourceDb {
  /**
   * @param {{file: string, seeds: {seedVersion: string, deviceTypes: object[], circuits: object[]}}} options
   */
  constructor({ file, seeds }) {
    this.file = file;
    this.seeds = seeds;
    this.data = null;
  }

  init() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.data = this.load();
    const needsSeed =
      !this.data ||
      this.data.schemaVersion !== SCHEMA_VERSION ||
      this.data.seedVersion !== this.seeds.seedVersion;

    if (needsSeed) {
      this.importBuiltin();
    }
  }

  load() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return null;
    }
  }

  persist() {
    this.data.updatedAt = Date.now();
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  /** 导入内置资源包（保留用户电路） */
  importBuiltin() {
    const previous = this.data || {};
    const userCircuits = (previous.circuits || []).filter((c) => !c.builtin);
    this.data = {
      schemaVersion: SCHEMA_VERSION,
      seedVersion: this.seeds.seedVersion,
      device_types: this.seeds.deviceTypes,
      circuits: [...this.seeds.circuits.map((c) => ({ ...c, builtin: true })), ...userCircuits],
      createdAt: previous.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    this.persist();
  }

  getBundle() {
    return {
      deviceTypes: this.data.device_types,
      circuits: this.data.circuits,
      meta: {
        seedVersion: this.data.seedVersion,
        updatedAt: this.data.updatedAt,
        counts: { circuits: this.data.circuits.length, deviceTypes: this.data.device_types.length },
      },
    };
  }

  saveCircuit(doc) {
    if (!doc || !doc.id) throw new Error('电路数据缺少 id');
    const idx = this.data.circuits.findIndex((c) => c.id === doc.id);
    if (idx >= 0) this.data.circuits[idx] = doc;
    else this.data.circuits.push(doc);
    this.persist();
    return doc;
  }

  deleteCircuit(id) {
    const before = this.data.circuits.length;
    this.data.circuits = this.data.circuits.filter((c) => c.id !== id);
    this.persist();
    return before !== this.data.circuits.length;
  }

  reset() {
    this.importBuiltin();
    return this.getBundle();
  }
}

module.exports = { ResourceDb };
