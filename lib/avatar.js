/* 角色头像自动获取
   蔚蓝档案角色：从 kivo.wiki 的学生头像库匹配（用户指定素材源）
   匹配策略：短名精确/后缀匹配学生全名（如「日奈」→「空崎 日奈」）
   非 BA 角色或匹配失败：由用户在编辑面板手动上传头像 */
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

/* 确保角色有头像：已有则跳过；无则尝试 kivo 匹配下载 */
async function ensureAvatar(charId) {
  const c = db.prepare('SELECT * FROM characters WHERE id=?').get(charId);
  if (!c) return null;
  if (c.avatar && fs.existsSync(path.join(__dirname, '..', 'public', c.avatar))) return c.avatar;

  const student = matchKivo(c.name);
  if (!student) return null;

  const url = 'https://static.kivo.wiki/images/students/' + encodeURIComponent(student) + '/avatar.png';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000 || buf[0] !== 0x89) return null;   // 非 PNG 或异常小
    fs.mkdirSync(CHARS_DIR, { recursive: true });
    const file = path.join(CHARS_DIR, charId + '.png');
    fs.writeFileSync(file, buf);
    const rel = 'assets/img/chars/' + charId + '.png';
    db.prepare('UPDATE characters SET avatar=?, is_new=0 WHERE id=?').run(rel, charId);
    return rel;
  } catch { return null; }
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
