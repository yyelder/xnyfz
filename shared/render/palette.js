/**
 * 统一色板（浅色工业风）。所有图形显式着色，避免依赖主题变量导致导出/打印失真。
 */
export const C = {
  ink: '#182635',
  inkSoft: '#41556b',
  muted: '#8798aa',
  wire: '#33475e',
  wireLive: '#d63a3a',
  neutral: '#2f6fb5',
  pe: '#1f9d55',
  grid: '#dfe9f6',
  gridStrong: '#cddcf0',
  canvas: '#f9fbff',
  panel: '#ffffff',
  border: '#d9e2ec',
  accent: '#1a5fb4',
  accentSoft: '#e8f0fb',
  amber: '#d98218',
  danger: '#d63a3a',
  ok: '#1f9d55',
  lampOn: '#f5c33b',
  lampGlow: 'rgba(245,195,59,.45)',
  motorOn: '#1f9d55',
  coilOn: '#d98218',
  cold: '#5a6f86',
  /* 元件编号标签配色：相线按国标相色（加深保证浅底可读），元件按类别区分 */
  phaseU: '#b8860b',   // U/L1 黄
  phaseV: '#1f9d55',   // V/L2 绿
  phaseW: '#d63a3a',   // W/L3 红
  phaseN: '#2f6fb5',   // N 蓝
  phasePE: '#6b9e1f',  // PE 黄绿
  labelKM: '#1a5fb4',  // 接触器
  labelKT: '#7b3fbf',  // 时间继电器
  labelKA: '#0e8a8a',  // 中间继电器（青）
  labelSB: '#d98218',  // 按钮
  labelFR: '#c0392b',  // 热继电器
  labelMotor: '#1f9d55', // 电机
  /* 线号（导线编号）：与网络标号小旗区分，用深青底白字 */
  wireTag: '#0b6e99',
  /* 说明文本卡片 */
  noteBg: '#fffdf3',
  noteBorder: '#d9c48a',
  noteText: '#3d3320',
  noteTitle: '#8a6d3b',
};

export default C;
