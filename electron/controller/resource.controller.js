/**
 * 资源控制器：将渲染进程的 IPC 请求转发给资源数据库服务。
 * 保持 controller 薄、service 厚的分层（对齐 electron-egg 的目录约定）。
 */
const { ipcMain } = require('electron');

function registerResourceController(db) {
  ipcMain.handle('resource:getBundle', () => db.getBundle());
  ipcMain.handle('resource:saveCircuit', (_e, doc) => db.saveCircuit(doc));
  ipcMain.handle('resource:deleteCircuit', (_e, id) => db.deleteCircuit(id));
  ipcMain.handle('resource:reset', () => db.reset());
}

module.exports = { registerResourceController };
