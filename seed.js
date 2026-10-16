/* 种子脚本：从 data.js（单一数据源）把模拟数据落库 */
const path = require('path');

// mock window 后加载前端数据层，复用同一份数据源
global.window = {};
require(path.join(__dirname, 'public', 'assets', 'js', 'data.js'));
const { IP_DB, CHARS, EMOTIONS, MEMES } = global.window.DB;

const { db } = require('./db');

// 与 data.js 一致的稳定色相
function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 360;
}

db.exec('BEGIN');

// 清空
db.exec('DELETE FROM memes; DELETE FROM characters; DELETE FROM emotions; DELETE FROM ips;');

// IP
const insIp = db.prepare('INSERT INTO ips (id,name,short,weight,cls,priority) VALUES (?,?,?,?,?,?)');
for (const [id, ip] of Object.entries(IP_DB)) {
  insIp.run(id, ip.name, ip.short || null, ip.weight, ip.cls || null, ip.priority || 0);
}

// 情绪
const insEmo = db.prepare('INSERT INTO emotions (id,name) VALUES (?,?)');
for (const e of EMOTIONS) insEmo.run(e.id, e.name);

// 角色：已知字典（新角色由上传入库时自动建档，不在这里造数据）
const insChar = db.prepare('INSERT INTO characters (id,name,en,ip,hue,avatar,is_new) VALUES (?,?,?,?,?,?,?)');
for (const c of CHARS) {
  insChar.run(c.id, c.name, c.en || null, c.ip || null, c.hue || 210, c.avatar || null, 0);
}

db.exec('COMMIT');

const stats = {
  ips: db.prepare('SELECT COUNT(*) n FROM ips').get().n,
  characters: db.prepare('SELECT COUNT(*) n FROM characters').get().n,
  emotions: db.prepare('SELECT COUNT(*) n FROM emotions').get().n,
  memes: db.prepare('SELECT COUNT(*) n FROM memes').get().n,
};
console.log('字典落库完成（档案库为空，等待真实上传）:', JSON.stringify(stats));
