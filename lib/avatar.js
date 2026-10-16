/* 角色头像自动获取
   蔚蓝档案角色：从 kivo.wiki 的学生头像库匹配（用户指定素材源）
   匹配策略：短名精确/后缀匹配学生全名（如「日奈」→「空崎 日奈」）
   其它 IP 角色或 kivo 匹配失败：从网上搜索（维基百科 REST 缩略图）兜底
   仍失败：由用户在编辑面板手动上传头像 */
const fs = require('fs');
const path = require('path');
const { db } = require('../db');

const SITEMAP = path.join(__dirname, '..', 'docs', 'kivo-sitemap.xml');
const CHARS_DIR = path.join(__dirname, '..', 'public', 'assets', 'img', 'chars');
let _students = null;

/* 从 sitemap 提取全部有头像的学生名（kivo 头像 URL 规律：/students/<名>/avatar.png） */
function kivoStudents() {
  if (_students) return _students;
  try {
    const xml = fs.readFileSync(SITEMAP, 'utf8');
    const locs = [...xml.matchAll(/<image:loc>(.*?)<\/image:loc>/g)].map(m => decodeURIComponent(m[1]));
    const names = new Set();
    for (const u of locs) {
      const m = u.match(/\/students\/(.+?)\/avatar/);
      if (m) names.add(m[1].trim());
    }
    _students = [...names];
  } catch { _students = []; }
  return _students;
}

const norm = s => String(s || '').replace(/\s+/g, '');

/* 短名 → 学生全名匹配（≥2 字，精确或后缀） */
function matchKivo(name) {
  const q = norm(name);
  if (!q || q.length < 2) return null;
  const students = kivoStudents();
  let hit = students.find(s => norm(s) === q);                  // 精确
  if (!hit) hit = students.find(s => norm(s).endsWith(q));      // 后缀（短名 ⊂ 全名）
  return hit || null;
}

/* 下载头像图片并落盘 + 更新 DB；自动识别 PNG/JPEG/WebP 格式 */
async function downloadAvatar(url, charId) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) return null;
    let ext = '.png';
    if (buf[0] === 0xFF && buf[1] === 0xD8) ext = '.jpg';
    else if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') ext = '.webp';
    fs.mkdirSync(CHARS_DIR, { recursive: true });
    const file = path.join(CHARS_DIR, charId + ext);
    fs.writeFileSync(file, buf);
    const rel = 'assets/img/chars/' + charId + ext;
    db.prepare('UPDATE characters SET avatar=?, is_new=0 WHERE id=?').run(rel, charId);
    return rel;
  } catch { return null; }
}

/* 网上搜索头像：维基百科 REST 摘要缩略图（zh → en 兜底） */
async function findWebImage(name) {
  const langs = ['zh', 'en'];
  for (const lang of langs) {
    try {
      const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(String(name).trim())}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'ba-meme-archive/1.0 (meme index; non-commercial)' },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      const j = await res.json();
      const img = (j.thumbnail && j.thumbnail.source) || (j.originalimage && j.originalimage.source);
      if (img) return img;
    } catch { /* 尝试下一个语言 */ }
  }
  return null;
}

/* 确保角色有头像：已有则跳过；无则依次尝试 kivo（BA）→ 网上搜索 */
async function ensureAvatar(charId) {
  const c = db.prepare('SELECT * FROM characters WHERE id=?').get(charId);
  if (!c) return null;
  if (c.avatar && fs.existsSync(path.join(__dirname, '..', 'public', c.avatar))) return c.avatar;

  // 1) BA 角色优先走 kivo 学生头像库
  if (!c.ip || c.ip === 'ba') {
    const student = matchKivo(c.name);
    if (student) {
      const url = 'https://static.kivo.wiki/images/students/' + encodeURIComponent(student) + '/avatar.png';
      const got = await downloadAvatar(url, charId);
      if (got) return got;
    }
  }

  // 2) 其它 IP / kivo 失败 → 网上搜索兜底
  const web = await findWebImage(c.name);
  if (web) {
    const got = await downloadAvatar(web, charId);
    if (got) return got;
  }
  return null;
}

/* 启动补跑：给所有无头像角色尝试获取 */
async function ensureAllAvatars() {
  const missing = db.prepare("SELECT id FROM characters WHERE avatar IS NULL OR avatar=''").all();
  const done = [];
  for (const c of missing) {
    const a = await ensureAvatar(c.id).catch(() => null);
    if (a) done.push(c.id);
  }
  return done;
}

module.exports = { ensureAvatar, ensureAllAvatars, matchKivo };
