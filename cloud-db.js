/* 云数据库访问层：把本地 SQLite 换成 WorkBuddy 云服务 PostgreSQL（服务器端 SDK，匿名角色） */
const { createWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk');

const cloud = createWorkBuddyCloud({
  endpoint: process.env.CLOUD_ENDPOINT || 'https://ba-meme-archive.app.workbuddy.host',
  publishableKey: process.env.CLOUD_PUBLISHABLE_KEY || 'wbpk_CeRvzxc7xDHjDRDyhY5QaR_KMepXZZP1LIkHGaNUzT0EAJRyRx6w0G2',
});

const db = cloud.database;

/* 稳定色相（与 data.js/seed.js 一致） */
function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 360;
}

/* 把 emo 的 JSON 字符串还原成数组，统一输出形状（与原 hydrate 一致） */
function hydrate(row) {
  if (!row) return null;
  const r = { ...row };
  try { r.emo = JSON.parse(r.emo || '[]'); } catch { r.emo = []; }
  r.auto = !!r.auto;
  r.is_new = !!r.is_new;
  return r;
}

/* 统一解包 { data, error }，有错即抛 */
function unwrap(res) {
  if (res && res.error) throw res.error;
  return res && res.data;
}

/* ---------- 基础查询 ---------- */
const allIps      = async () => unwrap(await db.from('ips').select('*').order('priority', { ascending: true })) || [];
const allChars    = async () => unwrap(await db.from('characters').select('*')) || [];
const allEmotions = async () => unwrap(await db.from('emotions').select('*')) || [];

async function getIp(id) {
  return unwrap(await db.from('ips').select('*').eq('id', id).maybeSingle());
}
async function getChar(id) {
  return unwrap(await db.from('characters').select('*').eq('id', id).maybeSingle());
}

/* 表情列表：加载全部 + JS 端关联 IP/角色（数据量小，等价于原 SQL JOIN） */
async function allMemes() {
  const [memes, ips, chars] = await Promise.all([
    unwrap(await db.from('memes').select('*').order('id', { ascending: true })) || [],
    allIps(),
    allChars(),
  ]);
  const ipMap = Object.fromEntries(ips.map(i => [i.id, i]));
  const charMap = Object.fromEntries(chars.map(c => [c.id, c]));
  return memes.map(m => {
    const ip = ipMap[m.ip] || {};
    const ch = charMap[m.char] || {};
    return hydrate({
      ...m,
      ip_weight: ip.weight,
      ip_name: ip.name,
      char_name: ch.name,
      char_en: ch.en,
      char_avatar: ch.avatar,
      char_hue: ch.hue,
    });
  });
}

async function getMeme(code) {
  const m = unwrap(await db.from('memes').select('*').eq('code', code).maybeSingle());
  if (!m) return null;
  const ip = await getIp(m.ip);
  const ch = await getChar(m.char);
  return hydrate({
    ...m,
    ip_weight: (ip && ip.weight),
    ip_name: (ip && ip.name),
    char_name: (ch && ch.name),
    char_en: (ch && ch.en),
    char_avatar: (ch && ch.avatar),
    char_hue: (ch && ch.hue),
  });
}

/* 角色目录（含表情计数） */
async function charsWithCount() {
  const [chars, memes] = await Promise.all([allChars(), unwrap(await db.from('memes').select('char').not('char', 'is', null)) || []]);
  const count = {};
  for (const m of memes) if (m.char) count[m.char] = (count[m.char] || 0) + 1;
  return chars
    .map(c => hydrate({ ...c, count: count[c.id] || 0 }))
    .sort((a, b) => (b.count - a.count) || (a.is_new ? 1 : 0) - (b.is_new ? 1 : 0) || (a.id < b.id ? -1 : 1));
}

/* ---------- 写入 ---------- */
async function insertIp(row) {
  return unwrap(await db.from('ips').insert(row));
}
async function insertChar(row) {
  return unwrap(await db.from('characters').insert(row));
}
async function ensureEmotion(id) {
  const e = unwrap(await db.from('emotions').select('id').eq('id', id).maybeSingle());
  if (!e) await db.from('emotions').insert({ id, name: id });
}

/* 档案编号：IP 前缀 + 自增序号 */
async function nextCode(ipId) {
  const ipRow = await getIp(ipId);
  const prefix = (ipRow && ipRow.short ? ipRow.short : 'GEN').toUpperCase();
  const rows = unwrap(await db.from('memes').select('code').like('code', prefix + '-%')) || [];
  let max = 0;
  for (const r of rows) {
    const n = parseInt(String(r.code).split('-')[1], 10);
    if (n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

/* 自定义 IP 建档：按名称生成稳定 id，返回 id */
async function ensureIp(name) {
  const n = String(name).trim();
  let id = n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!id || /^\d+$/.test(id)) id = 'ip-' + hashHue(n).toString(36);
  if (await getIp(id)) id += '-' + hashHue(n).toString(36).slice(0, 2);
  await insertIp({ id, name: n, short: (id.replace(/-/g, '').slice(0, 4) || 'IP').toUpperCase(), weight: 0.3, cls: 'ip-badge--other', priority: 9 });
  return id;
}

/* 角色名自动识别角色：匹配 → 命中返回 id；未命中新建角色目录（出现即建） */
async function resolveCharacter(name, ipId) {
  const q = String(name).trim();
  if (!q) return null;
  const ql = q.toLowerCase();
  const rows = await allChars();
  let hit = rows.find(r => r.name === q || (r.en || '').toLowerCase() === ql || r.id === q);
  if (!hit && q.length >= 2) {
    hit = rows.find(r =>
      (r.en && ql.includes((r.en || '').toLowerCase())) ||
      (r.name && (q.includes(r.name) || r.name.includes(q))));
  }
  if (hit) return hit.id;
  const id = q;
  await insertChar({ id, name: q, en: '', ip: ipId || 'ba', hue: hashHue(q), avatar: '', is_new: 1 });
  return id;
}

/* 新增档案 */
async function insertMeme(row) {
  return unwrap(await db.from('memes').insert(row).select());
}

/* 管理员更新档案（SECURITY DEFINER RPC，函数内校验口令，绕过 RLS 更新） */
async function adminUpdateMeme(adminKey, code, title, ipId, charId, emoJson, text) {
  return unwrap(await db.rpc('admin_update_meme', {
    p_admin_key: adminKey,
    p_code: code,
    p_title: title,
    p_ip: ipId,
    p_char: charId,
    p_emo: emoJson,
    p_text: text,
  }));
}

/* 管理员删除档案（SECURITY DEFINER RPC，函数内校验口令，绕过 RLS 删除） */
async function adminDeleteMeme(adminKey, code) {
  return unwrap(await db.rpc('admin_delete_meme', { p_admin_key: adminKey, p_code: code }));
}

/* 更新角色头像 */
async function updateCharAvatar(id, avatar) {
  return unwrap(await db.from('characters').update({ avatar, is_new: 0 }).eq('id', id).select());
}

module.exports = {
  hashHue, hydrate,
  allIps, allChars, allEmotions, getIp, getChar,
  allMemes, getMeme, charsWithCount,
  insertIp, insertChar, ensureEmotion, nextCode, ensureIp, resolveCharacter,
  insertMeme, adminUpdateMeme, adminDeleteMeme, updateCharAvatar,
};
