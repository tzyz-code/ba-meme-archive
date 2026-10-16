/* ba表情档案 · 后端服务
   Express + SQLite（node:sqlite）
   阶段2：静态托管 + 搜索 API + 排序权重落地 */
process.env.NODE_NO_WARNINGS = '1';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { db, hydrate } = require('./db');
const classifier = require('./lib/classifier');
const avatar = require('./lib/avatar');

const app = express();
const PORT = process.env.PORT || 3000;

/* 站点基准 URL（SEO 用，og:image/canonical 需绝对地址） */
function siteBase(req) {
  return (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- 上传存储 ---------- */
const UPLOAD_DIR = path.join(__dirname, 'data', 'uploads');
const UPLOAD_META = path.join(__dirname, 'data', 'uploads.json');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function loadQueue() {
  try { return JSON.parse(fs.readFileSync(UPLOAD_META, 'utf8')); } catch { return {}; }
}
function saveQueue(q) { fs.writeFileSync(UPLOAD_META, JSON.stringify(q, null, 2)); }

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    cb(null, Date.now().toString(36) + crypto.randomBytes(4).toString('hex') + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => cb(null, /\.(jpe?g|png|gif|webp)$/i.test(file.originalname)),
});

/* 稳定色相（与 data.js/seed.js 一致） */
function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 360;
}

/* 档案编号：IP 前缀 + 自增序号 */
function nextCode(ipId) {
  const ipRow = db.prepare('SELECT short FROM ips WHERE id=?').get(ipId);
  const prefix = (ipRow && ipRow.short ? ipRow.short : 'GEN').toUpperCase();
  const rows = db.prepare("SELECT code FROM memes WHERE code LIKE ?").all(prefix + '-%');
  let max = 0;
  for (const r of rows) {
    const n = parseInt(r.code.split('-')[1], 10);
    if (n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

/* ---------- 查询工具 ---------- */
// 关联 IP/角色，返回完整字段
const SELECT_MEME = `
  SELECT m.*, i.weight AS ip_weight, i.name AS ip_name,
         c.name AS char_name, c.en AS char_en, c.avatar AS char_avatar, c.hue AS char_hue
  FROM memes m
  LEFT JOIN ips i ON i.id = m.ip
  LEFT JOIN characters c ON c.id = m.char
`;

function allMemes() {
  return db.prepare(SELECT_MEME + ' ORDER BY m.id').all().map(hydrate);
}
function getMeme(code) {
  return hydrate(db.prepare(SELECT_MEME + ' WHERE m.code = ?').get(code));
}

/* ---------- 核心排序权重（服务端落地）----------
   文本相关性 = 多字段匹配分（决定是否命中搜索）
   最终分   = 文本相关性 + 0.35×IP权重 + 0.20×热度归一 + 0.15×时效归一 + 0.03×置信度
   蔚蓝档案 ipWeight=1.0 → 贡献 0.35 分，天然压过其它 IP
-------------------------------------------------- */
function textScore(m, query) {
  if (!query) return 0;
  let s = 0;
  const q = String(query).toLowerCase();
  const fields = [
    { t: m.title,     w: 3.0 },
    { t: m.char_name || '', w: 2.5 },
    { t: m.char_en   || '', w: 1.5 },
    { t: m.text      || '', w: 1.2 },
    { t: m.code,      w: 1.0 },
  ];
  for (const f of fields) {
    if (!f.t) continue;
    const hay = f.t.toLowerCase();
    if (hay === q) s += f.w * 3;
    else if (hay.includes(q)) s += f.w * 1.6;
    else if (q.length >= 2 && [...q].every(ch => hay.includes(ch))) s += f.w * 0.25;
  }
  return s;
}

function scoreMeme(m, query) {
  let s = textScore(m, query);
  s += 0.35 * (m.ip_weight ?? 0.3);                 // IP 权重
  s += 0.20 * Math.log10((m.views || 0) + 1) / Math.log10(20000); // 热度
  s += 0.15 * Math.exp(-(m.age_days || 0) / 45);    // 时效
  s += 0.03 * ((m.conf || 0) / 100);                // 置信度
  return s;
}

/* ---------- API ---------- */

// 搜索
app.get('/api/search', (req, res) => {
  const q    = String(req.query.q || '');
  const ip   = String(req.query.ip  || 'all');
  const ch   = String(req.query.char || 'all');
  const emo  = String(req.query.emo  || 'all');
  const sort = String(req.query.sort || 'relevance');
  const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;

  let list = allMemes();

  if (ip  !== 'all') list = list.filter(m => m.ip === ip);
  if (ch  !== 'all') list = list.filter(m => m.char === ch);
  if (emo !== 'all') list = list.filter(m => m.emo.includes(emo));

  if (q) {
    list = list.filter(m => textScore(m, q) > 0);   // 命中门槛只看文本相关性
    list.sort((a, b) => scoreMeme(b, q) - scoreMeme(a, q));
  } else {
    list.sort((a, b) => scoreMeme(b, '') - scoreMeme(a, ''));
  }

  if (sort === 'hot')  list.sort((a, b) => b.views - a.views);
  if (sort === 'new')  list.sort((a, b) => a.age_days - b.age_days);
  if (sort === 'conf') list.sort((a, b) => b.conf - a.conf);

  const total = list.length;
  res.json({ total, list: list.slice(offset, offset + limit) });
});

// 角色目录（由表情包动态派生，出现即建）
app.get('/api/chars', (req, res) => {
  const chars = db.prepare(`
    SELECT c.*, COUNT(m.id) AS count
    FROM characters c
    LEFT JOIN memes m ON m.char = c.id
    GROUP BY c.id
    ORDER BY count DESC, c.is_new DESC, c.id
  `).all().map(hydrate);
  res.json(chars);
});

// 单条详情 + 相关
app.get('/api/meme/:code', (req, res) => {
  const m = getMeme(req.params.code);
  if (!m) return res.status(404).json({ error: 'not found' });
  const related = allMemes().filter(x => x.code !== m.code && (
    (m.char && x.char === m.char) || x.emo.some(e => m.emo.includes(e))
  )).slice(0, 8);
  res.json({ meme: m, related });
});

// 元数据（IP/情绪/角色目录），供筛选器
app.get('/api/meta', (req, res) => {
  const ips = db.prepare('SELECT * FROM ips ORDER BY priority').all();
  const emotions = db.prepare('SELECT * FROM emotions').all();
  const chars = db.prepare(`
    SELECT c.*, COUNT(m.id) AS count
    FROM characters c LEFT JOIN memes m ON m.char = c.id
    GROUP BY c.id ORDER BY count DESC, c.is_new DESC, c.id
  `).all().map(hydrate);
  res.json({ ips, emotions, chars });
});

// ---------- 上传：接收图片 → 识图 → 暂存（未入库） ----------
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传 jpg/png/gif/webp 图片（≤10MB）' });
  const id = 'u' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
  const result = await classifier.classify(req.file.path, req.file.originalname, req.body.hint || '');
  const queue = loadQueue();
  queue[id] = {
    id,
    orig: req.file.originalname,
    file: req.file.filename,
    url: '/uploads/' + req.file.filename,
    result,
    createdAt: new Date().toISOString(),
  };
  saveQueue(queue);
  res.json({ uploadId: id, url: queue[id].url, orig: queue[id].orig, result });
});

// 删除暂存（放弃这张）
app.delete('/api/upload/:id', (req, res) => {
  const queue = loadQueue();
  const item = queue[req.params.id];
  if (!item) return res.status(404).json({ error: 'not found' });
  fs.promises.unlink(path.join(UPLOAD_DIR, item.file)).catch(() => {});
  delete queue[req.params.id];
  saveQueue(queue);
  res.json({ ok: true });
});

// 暂存队列（用于页面恢复）
app.get('/api/upload', (req, res) => {
  const queue = loadQueue();
  res.json(Object.values(queue).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
});

// ---------- 确认入库：人工校正后落库（新角色自动建目录） ----------
app.post('/api/memes', express.json(), (req, res) => {
  const { uploadId, title, ip, char, emo, text, auto, conf } = req.body || {};
  const queue = loadQueue();
  const item = queue[uploadId];
  if (!item) return res.status(404).json({ error: '上传记录不存在' });
  if (!title || !String(title).trim()) return res.status(400).json({ error: '请填写档案标题' });
  if (!db.prepare('SELECT id FROM ips WHERE id=?').get(ip)) return res.status(400).json({ error: 'IP 无效' });

  // 情绪：未知标签（自定义）自动注册进 emotions
  const emoArr = Array.isArray(emo) ? emo : [];
  const finalEmo = [];
  for (const e of emoArr) {
    const id = String(e).trim();
    if (!id) continue;
    if (!db.prepare('SELECT id FROM emotions WHERE id=?').get(id)) {
      db.prepare('INSERT INTO emotions (id,name) VALUES (?,?)').run(id, id);
    }
    finalEmo.push(id);
  }
  if (!finalEmo.length) finalEmo.push('doge');

  // 出现即建目录：角色不在库中 → 自动 INSERT（新角色标记待确认）
  if (char && !db.prepare('SELECT id FROM characters WHERE id=?').get(char)) {
    db.prepare('INSERT INTO characters (id,name,en,ip,hue,avatar,is_new) VALUES (?,?,?,?,?,?,1)')
      .run(char, char, '', ip, hashHue(char), '');
  }

  const code = nextCode(ip);
  db.prepare(
    'INSERT INTO memes (code,title,ip,char,emo,views,age_days,auto,conf,text,image_url) VALUES (?,?,?,?,?,0,0,?,?,?,?)'
  ).run(code, String(title).trim(), ip, char || null, JSON.stringify(finalEmo), auto ? 1 : 0, conf || 0, text || '', item.url);

  // 移除暂存
  delete queue[uploadId];
  saveQueue(queue);
  classifier.refreshDict();

  // 新角色自动获取头像（kivo 匹配，异步不阻塞入库响应）
  if (char) avatar.ensureAvatar(char).catch(() => {});

  const meme = hydrate(db.prepare(SELECT_MEME + ' WHERE m.code=?').get(code));
  res.json({ ok: true, meme });
});

/* ---------- 编辑档案：改标题/IP/角色/关键词（新角色自动建档） ---------- */
app.patch('/api/meme/:code', express.json(), (req, res) => {
  const code = req.params.code;
  if (!db.prepare('SELECT id FROM memes WHERE code=?').get(code)) return res.status(404).json({ error: '档案不存在' });

  const { title, ip, char, emo, text } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: '标题不能为空' });
  if (!db.prepare('SELECT id FROM ips WHERE id=?').get(ip)) return res.status(400).json({ error: 'IP 无效' });

  const existing = db.prepare('SELECT * FROM memes WHERE code=?').get(code);

  // emo 未传时保留原值（情绪维度已从界面移除，由搜索关键词承担）
  let finalEmo;
  if (Array.isArray(emo)) {
    finalEmo = [];
    for (const e of emo) {
      const id = String(e).trim();
      if (!id) continue;
      if (!db.prepare('SELECT id FROM emotions WHERE id=?').get(id)) {
        db.prepare('INSERT INTO emotions (id,name) VALUES (?,?)').run(id, id);
      }
      finalEmo.push(id);
    }
    if (!finalEmo.length) finalEmo.push('doge');
  } else {
    try { finalEmo = JSON.parse(existing.emo || '[]'); } catch { finalEmo = ['doge']; }
    if (!finalEmo.length) finalEmo.push('doge');
  }

  if (char && !db.prepare('SELECT id FROM characters WHERE id=?').get(char)) {
    db.prepare('INSERT INTO characters (id,name,en,ip,hue,avatar,is_new) VALUES (?,?,?,?,?,?,1)')
      .run(char, char, '', ip, hashHue(char), '');
  }

  db.prepare('UPDATE memes SET title=?, ip=?, char=?, emo=?, text=? WHERE code=?')
    .run(String(title).trim(), ip, char || null, JSON.stringify(finalEmo), text || '', code);
  classifier.refreshDict();

  // 编辑引入的新角色：自动获取头像
  if (char) avatar.ensureAvatar(char).catch(() => {});

  res.json({ ok: true, meme: hydrate(db.prepare(SELECT_MEME + ' WHERE m.code=?').get(code)) });
});

/* ---------- 手动上传角色头像（kivo 匹配不到时兜底，任何 IP 均可） ---------- */
const avatarStorage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, path.join(__dirname, 'public', 'assets', 'img', 'chars')),
  filename: (req, __, cb) => {
    const ext = (path.extname(req.file?.originalname || '') || '.png').toLowerCase();
    cb(null, req.params.id + ext);
  },
});
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => cb(null, /\.(jpe?g|png|webp)$/i.test(file.originalname)),
});

app.post('/api/chars/:id/avatar', avatarUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传 jpg/png/webp 图片（≤5MB）' });
  const c = db.prepare('SELECT id FROM characters WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '角色不存在' });
  const rel = 'assets/img/chars/' + req.file.filename;
  db.prepare('UPDATE characters SET avatar=?, is_new=0 WHERE id=?').run(rel, req.params.id);
  classifier.refreshDict();
  res.json({ ok: true, avatar: rel });
});

/* ---------- SSR 详情页（SEO：爬虫不执行 JS 也能拿到完整内容） ---------- */
const emoName = id => (db.prepare('SELECT name FROM emotions WHERE id=?').get(id) || {}).name || id;
const ipRow = id => db.prepare('SELECT * FROM ips WHERE id=?').get(id) || { name: id, weight: 0.3 };

function renderSSR(m, base) {
  const ip = ipRow(m.ip);
  const desc = `${m.title}｜${ip.name}${m.char_name ? ' · ' + m.char_name : ''}表情包。蔚蓝档案玩家共建 ba表情档案，${m.emo.map(emoName).join('、')}类表情，可直接下载使用。`;
  const absImg = m.image_url ? base + m.image_url : base + '/assets/img/logo.png';
  const related = allMemes().filter(x => x.code !== m.code && ((m.char && x.char === m.char) || x.emo.some(e => m.emo.includes(e)))).slice(0, 8);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(m.title)} - ${esc(m.char_name ? m.char_name + ' ' : '')}${esc(ip.name)}表情包 - ba表情档案</title>
<meta name="description" content="${esc(desc)}">
<meta name="keywords" content="${esc((m.text || '') + ',' + ip.name + ',蔚蓝档案表情包')}">
<link rel="canonical" href="${base}/meme/${esc(m.code)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(m.title)} - ba表情档案">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${absImg}">
<meta property="og:url" content="${base}/meme/${esc(m.code)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${absImg}">
<link rel="icon" type="image/png" href="/assets/img/favicon.png">
<link rel="stylesheet" href="/assets/css/tokens.css">
<link rel="stylesheet" href="/assets/css/components.css">
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'ImageObject',
    name: m.title, description: desc,
    contentUrl: absImg, thumbnailUrl: absImg,
    keywords: `${m.text || ''},${ip.name},蔚蓝档案表情包`,
    datePublished: (m.created_at || '').slice(0, 10),
    license: '仅供个人学习与交流使用',
  })}</script>
</head>
<body>
<header class="header"><div class="container header__inner">
  <a href="/" class="logo"><img class="logo__mark" src="/assets/img/logo.png" alt="ba表情档案" style="object-fit:cover"><span class="logo__text"><span class="logo__zh">ba表情档案</span><span class="logo__en">BA Meme Archive</span></span></a>
  <nav class="nav"><a href="/" class="nav__link">档案大厅</a><a href="/#chars" class="nav__link">角色馆</a></nav>
  <div class="header__search"></div>
  <div class="header__actions"><a href="/upload.html" class="btn btn--ghost">+ 上传表情</a></div>
</div></header>

<main class="section section--tight"><div class="container">
  <nav class="crumb"><a href="/">档案大厅</a><span class="crumb__sep">/</span><a href="/search.html?ip=${m.ip}">${esc(ip.name)}</a>${m.char_name ? `<span class="crumb__sep">/</span><a href="/search.html?char=${esc(m.char)}">${esc(m.char_name)}</a>` : ''}</nav>
  <div class="detail">
    <div>
      <div class="detail__stage"><div class="detail__img">${m.image_url ? `<img src="${m.image_url}" alt="${esc(m.title)}" style="width:100%;height:100%;object-fit:contain">` : `<img src="/assets/img/logo.png" alt="" style="width:100%;height:100%;object-fit:contain">`}</div></div>
      <div class="action-row mt-4"><a class="btn btn--primary" href="${m.image_url || '#'}" download><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;vertical-align:-3px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg> 下载原图</a></div>
    </div>
    <aside class="detail__side"><div class="panel">
      <div class="panel__title">档案信息</div>
      <h1 style="font-size:var(--fs-h2);font-weight:var(--fw-black);line-height:1.25;margin-bottom:var(--sp-3)">${esc(m.title)}</h1>
      <div class="flex gap-2 wrap">
        <span class="ip-badge ${esc(ip.cls || 'ip-badge--other')}">${esc(ip.name)}</span>
        ${m.char_name ? `<span class="tag tag--char">${esc(m.char_name)}</span>` : ''}
      </div>
      <div class="meta-list mt-5">
        <div class="meta-list__row"><span class="meta-list__key">所属 IP</span><span class="meta-list__val">${esc(ip.name)}</span></div>
        <div class="meta-list__row"><span class="meta-list__key">角色</span><span class="meta-list__val">${esc(m.char_name || '— 无角色 —')}</span></div>
        <div class="meta-list__row"><span class="meta-list__key">搜索关键词</span><span class="meta-list__val">${esc(m.text || '—')}</span></div>
      </div>
    </div></aside>
  </div>
  ${related.length ? `<section class="section section--tight"><div class="section__head"><h2 class="section__title">相关档案</h2></div><div class="grid">${related.map(r => `
    <a class="card ${r.ip === 'ba' ? 'card--ba' : ''}" href="/meme/${esc(r.code)}">
      <div class="card__media">${r.image_url ? `<img class="card__img" src="${r.image_url}" alt="${esc(r.title)}">` : ''}</div>
      <div class="card__body"><h3 class="card__title">${esc(r.title)}</h3></div>
    </a>`).join('')}</div></section>` : ''}
</div></main>

<footer class="footer"><div class="container footer__inner"><p class="footer__note">本站为玩家自建的非官方蔚蓝档案表情索引站，与 Yostar 无隶属关系。图片版权归原作者所有。</p><div class="footer__links"><a class="footer__link" href="/about.html">关于</a><a class="footer__link" href="/">返回档案大厅</a></div></div></footer>
</body>
</html>`;
}

app.get('/meme/:code', (req, res) => {
  const m = getMeme(req.params.code);
  if (!m) return res.status(404).send('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>档案不存在 - ba表情档案</title></head><body><div style="padding:60px;text-align:center;font-family:sans-serif"><h1>这份档案不存在</h1><p><a href="/">返回档案大厅</a></p></div></body></html>');
  res.send(renderSSR(m, siteBase(req)));
});

/* ---------- sitemap.xml + robots.txt（SEO） ---------- */
app.get('/sitemap.xml', (req, res) => {
  const base = siteBase(req);
  const memes = db.prepare('SELECT code, created_at FROM memes').all();
  const chars = db.prepare('SELECT DISTINCT m.char AS id FROM memes m WHERE m.char IS NOT NULL').all();
  const urls = [
    { loc: '/', lastmod: new Date().toISOString().slice(0, 10), priority: 1.0 },
    { loc: '/search.html', lastmod: new Date().toISOString().slice(0, 10), priority: 0.8 },
    { loc: '/about.html', lastmod: new Date().toISOString().slice(0, 10), priority: 0.5 },
    ...memes.map(m => ({ loc: '/meme/' + m.code, lastmod: (m.created_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10), priority: 0.7 })),
    ...chars.map(c => ({ loc: '/search.html?char=' + encodeURIComponent(c.id), lastmod: new Date().toISOString().slice(0, 10), priority: 0.6 })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(u => `  <url><loc>${base}${u.loc}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.priority}</priority></url>`).join('\n') +
    `\n</urlset>`;
  res.type('application/xml').send(xml);
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /upload.html\nDisallow: /api/\n\nSitemap: ${siteBase(req)}/sitemap.xml`);
});

/* ---------- 静态托管 ---------- */
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ba表情档案 后端已启动: http://localhost:${PORT}`);
  // 后台补跑：给无头像角色自动获取头像
  avatar.ensureAllAvatars().then(done => {
    if (done.length) console.log('已自动补全角色头像:', done.join(', '));
  }).catch(() => {});
});
