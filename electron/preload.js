/**
 * 预加载脚本：以最小暴露面渲染进程提供资源库访问能力
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scjApi', {
  getBundle: () => ipcRenderer.invoke('resource:getBundle'),
  saveCircuit: (doc) => ipcRenderer.invoke('resource:saveCircuit', doc),
  deleteCircuit: (id) => ipcRenderer.invoke('resource:deleteCircuit', id),
  resetResources: () => ipcRenderer.invoke('resource:reset'),
});
