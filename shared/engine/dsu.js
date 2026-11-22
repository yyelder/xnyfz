/**
 * 并查集（Union-Find）：用于把「导线（网络）」按闭合触点合并成电气节点。
 * 电气仿真的第一步就是把物理连线归约成等电位节点集合。
 */
export class DSU {
  constructor(ids = []) {
    this.parent = new Map();
    this.rank = new Map();
    for (const id of ids) this.add(id);
  }

  add(id) {
    if (!this.parent.has(id)) {
      this.parent.set(id, id);
      this.rank.set(id, 0);
    }
    return id;
  }

  find(id) {
    if (!this.parent.has(id)) this.add(id);
    let root = id;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    // 路径压缩
    let cur = id;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur);
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    const ka = this.rank.get(ra) ?? 0;
    const kb = this.rank.get(rb) ?? 0;
    if (ka < kb) this.parent.set(ra, rb);
    else if (ka > kb) this.parent.set(rb, ra);
    else {
      this.parent.set(rb, ra);
      this.rank.set(ra, ka + 1);
    }
    return true;
  }
}

export default DSU;
