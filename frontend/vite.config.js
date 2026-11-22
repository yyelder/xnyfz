import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import fs from 'node:fs';

const projectRoot = path.resolve(__dirname, '..');

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [
    vue(),
    {
      // 打包时把资源包复制进 dist，网页模式可离线加载
      name: 'copy-resources',
      closeBundle() {
        const src = path.join(projectRoot, 'resources', 'packs');
        const dest = path.resolve(__dirname, 'dist', 'resources');
        fs.cpSync(src, dest, { recursive: true });
      },
    },
  ],
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [projectRoot] },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1024,
  },
});
