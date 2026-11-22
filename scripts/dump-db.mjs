/**
 * 资源库查看工具：打印资源数据库的概况（桌面端 JSON 文档库）。
 * 用法：node scripts/dump-db.mjs [资源库文件路径]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const file =
  process.argv[2] ||
  path.join(os.homedir(), 'AppData', 'Roaming', 'scj-elec-sim', 'scj-resource-db.json');

if (!fs.existsSync(file)) {
  console.error(`资源库不存在：${file}`);
  process.exit(1);
}

const db = JSON.parse(fs.readFileSync(file, 'utf8'));
console.log(`资源库：${file}`);
console.log(`schemaVersion: ${db.schemaVersion}   seedVersion: ${db.seedVersion}`);
console.log(`元件类型：${db.device_types.length} 个`);
for (const t of db.device_types) {
  console.log(`  - ${t.id.padEnd(12)} ${t.name}  [${t.role}]`);
}
console.log(`电路课程：${db.circuits.length} 个`);
for (const c of db.circuits) {
  console.log(
    `  - ${c.id.padEnd(28)} ${c.title}  [${c.category}${c.builtin ? '' : ' / 用户'}] 元件 ${c.devices.length} · 网络 ${c.nets.length}`
  );
}
