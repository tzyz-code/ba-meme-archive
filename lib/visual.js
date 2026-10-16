/* 视觉相似度匹配：pHash 对比角色头像库
   上传图与角色头像计算感知哈希，汉明距离近 → 识别为该角色。
   对「同一张图重复上传/同源裁切」命中率高；对画风差异大的表情包
   命中率有限——识别不了会降级到低置信度，由人工校正兜底。 */
const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

const { db } = require('../db');

const HASH_CACHE = path.join(__dirname, '..', 'data', 'charhash.json');
const _cache = fs.existsSync(HASH_CACHE) ? JSON.parse(fs.readFileSync(HASH_CACHE, 'utf8')) : {};
const _mem = new Map(); // filePath → hash（上传图临时缓存）

/* 32x32 灰度 → DCT → 左上 8x8 中位数二值化 → 64bit hash（十六进制串） */
async function phash(filePath) {
  if (_mem.has(filePath)) return _mem.get(filePath);
  const img = await Jimp.read(filePath);
  img.resize({ w: 32, h: 32 });
  const N = 32;
  const px = new Float64Array(N * N);
  const d = img.bitmap.data;
  for (let i = 0; i < N * N; i++) {
    px[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; // 手动灰度
  }
  // 行列 DCT-II
  const cos = (u, v) => {
    const t = Math.PI * (2 * v + 1) * u / (2 * N);
    return Math.cos(t) * (u === 0 ? Math.SQRT1_2 : 1);
  };
  const rows = new Float64Array(N * N);
  for (let y = 0; y < N; y++) for (let u = 0; u < N; u++) {
    let sum = 0;
    for (let x = 0; x < N; x++) sum += px[y * N + x] * cos(u, x);
    rows[y * N + u] = sum;
  }
  const dct = new Float64Array(64);
  for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) {
    let sum = 0;
    for (let y = 0; y < N; y++) sum += rows[y * N + v] * cos(u, y);
    dct[u * 8 + v] = sum;
  }
  // 中位数（跳过 DC 分量）
  const ac = Array.from(dct.slice(1)).sort((a, b) => a - b);
  const mid = ac[ac.length >> 1];
  let bits = '';
  for (let i = 0; i < 64; i++) bits += dct[i] > mid ? '1' : '0';
  const hex = bits.match(/.{4}/g).map(b => parseInt(b, 2).toString(16)).join('');
  _mem.set(filePath, hex);
  return hex;
}

function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    let x = parseInt(a[i] || '0', 16) ^ parseInt(b[i] || '0', 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

/* 角色头像哈希索引（懒构建 + 持久化） */
async function charIndex() {
  const chars = db.prepare('SELECT id, avatar FROM characters WHERE avatar IS NOT NULL AND avatar != \'\'').all();
  let dirty = false;
  for (const c of chars) {
    if (_cache[c.id]) continue;
    const abs = path.join(__dirname, '..', 'public', c.avatar);
    if (!fs.existsSync(abs)) continue;
    try { _cache[c.id] = await phash(abs); dirty = true; } catch {}
  }
  if (dirty) fs.writeFileSync(HASH_CACHE, JSON.stringify(_cache));
  return _cache;
}

/* 返回 { char, distance } 或 null；distance ≤ 24 视为可信 */
async function matchChar(filePath) {
  const idx = await charIndex();
  if (!Object.keys(idx).length) return null;
  const h = await phash(filePath);
  let best = null;
  for (const [id, ch] of Object.entries(idx)) {
    const d = hamming(h, ch);
    if (!best || d < best.distance) best = { char: id, distance: d };
  }
  return best && best.distance <= 16 ? best : null;   // 阈值收紧：弱相似宁可交给人工校正
}

module.exports = { phash, hamming, matchChar };
