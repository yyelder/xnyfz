/**
 * 省常技电气仿真 — Electron 主进程
 * 启动：npm start（生产，加载 frontend/dist）
 * 开发：npm run dev（渲染层走 Vite 热更新）
 */
const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { ResourceDb } = require('./service/resource-db');
const { registerResourceController } = require('./controller/resource.controller');

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';

/** 加载内置资源包（元件库 + 课程） */
function loadSeeds() {
  const packDir = path.join(__dirname, '..', 'resources', 'packs');
  const devicePack = JSON.parse(fs.readFileSync(path.join(packDir, 'device-types.json'), 'utf8'));
  const circuitDir = path.join(packDir, 'circuits');
  const circuits = fs
    .readdirSync(circuitDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(circuitDir, f), 'utf8')));
  return {
    seedVersion: `${devicePack.version}#${circuits.length}`,
    deviceTypes: devicePack.types,
    circuits,
  };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1200,
    minHeight: 760,
    show: false,
    backgroundColor: '#e9eef5',
    title: '省常技电气仿真',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // 外部链接交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
  }
  return win;
}

app.whenReady().then(() => {
  // 初始化独立资源库（位于用户数据目录，不随代码覆盖丢失）
  const db = new ResourceDb({
    file: path.join(app.getPath('userData'), 'scj-resource-db.json'),
    seeds: loadSeeds(),
  });
  db.init();
  registerResourceController(db);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
