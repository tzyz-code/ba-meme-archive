/* ba表情档案 · 后端服务
   Express + WorkBuddy 云服务（PostgreSQL）+ 图片对象存储（COS）
   数据层见 cloud-db.js；图片存储见 lib/storage.js */
process.env.NODE_NO_WARNINGS = '1';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const cdb = require('./cloud-db');
const storage = require('./lib/storage');
const avatar = require('./lib/avatar');

const app = express();
const PORT = process.env.PORT || 3000;

/* 管理员口令：上传后的表情包仅管理员可编辑（点「编辑」时输入） */
const ADMIN_KEY = process.env.ADMIN_KEY || '2648965787';

/* 站点基准 URL（SEO 用，og:image/canonical 需绝对地址） */
function siteBase(req) {
  return (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* 图片绝对地址：兼容相对路径（本地）与 COS 绝对 URL */
function absImg(url, base) {
  if (!url) return base + '/assets/img/logo.png';
  return /^https?:\/\//.test(url) ? url : base + url;
}

/* ---------- 上传暂存队列（内存态：图片在 /api/upload 即已入对象存储） ---------- */
const UPLOAD_META = path.join(__dirname, 'data', 'uploads.json');
function loadQueue() {
  try { return JSON.parse(fs.readFileSync(UPLOAD_META, 'utf8')); } catch { return {}; }
}
function saveQueue(q) { fs.writeFileSync(UPLOAD_META, JSON.stringify(q, null, 2)); }

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => cb(null, /\.(jpe?g|png|gif|webp)$/i.test(file.originalname)),
});

/* ---------- 核心排序权重（与原实现一致） ----------
   文本相关性 = 多字段匹配分（决定是否命中搜索）
   最终分   = 文本相关性 + 0.35×IP权重 + 0.20×热度归一 + 0.15×时效归一 + 0.03×置信度 */
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
  s += 0.35 * (m.ip_weight ?? 0.3);
  s += 0.20 * Math.log10((m.views || 0) + 1) / Math.log10(20000);
  s += 0.15 * Math.exp(-(m.age_days || 0) / 45);
  s += 0.03 * ((m.conf || 0) / 100);
  return s;
}

/* ---------- API ---------- */

// 搜索
app.get('/api/search', async (req, res) => {
  try {
    const q    = String(req.query.q || '');
    const ip   = String(req.query.ip  || 'all');
    const ch   = String(req.query.char || 'all');
    const emo  = String(req.query.emo  || 'all');
    const crowd = String(req.query.crowd || 'all');
    const sort = String(req.query.sort || 'relevance');
    const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;

    let list = await cdb.allMemes();
    if (ip  !== 'all') list = list.filter(m => m.ip === ip);
    if (ch  !== 'all') list = list.filter(m => m.char === ch);
    if (emo !== 'all') list = list.filter(m => m.emo.includes(emo));
    if (crowd !== 'all') list = list.filter(m => (m.crowd || 'default') === crowd);

    if (q) {
      list = list.filter(m => textScore(m, q) > 0);
      list.sort((a, b) => scoreMeme(b, q) - scoreMeme(a, q));
    } else {
      list.sort((a, b) => scoreMeme(b, '') - scoreMeme(a, ''));
    }
    if (sort === 'hot')  list.sort((a, b) => b.views - a.views);
    if (sort === 'new')  list.sort((a, b) => a.age_days - b.age_days);
    if (sort === 'conf') list.sort((a, b) => b.conf - a.conf);

    res.json({ total: list.length, list: list.slice(offset, offset + limit) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 角色目录
app.get('/api/chars', async (req, res) => {
  try { res.json(await cdb.charsWithCount()); } catch (e) { res.status(500).json({ error: e.message }); }
});

// 单条详情 + 相关
app.get('/api/meme/:code', async (req, res) => {
  try {
    const m = await cdb.getMeme(req.params.code);
    if (!m) return res.status(404).json({ error: 'not found' });
    const all = await cdb.allMemes();
    const related = all.filter(x => x.code !== m.code && (
      (m.char && x.char === m.char) || x.emo.some(e => m.emo.includes(e))
    )).slice(0, 8);
    res.json({ meme: m, related });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 元数据
app.get('/api/meta', async (req, res) => {
  try {
    const [ips, emotions, chars] = await Promise.all([cdb.allIps(), cdb.allEmotions(), cdb.charsWithCount()]);
    res.json({ ips, emotions, chars });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- 上传：接收图片 → 入对象存储 → 暂存（不做 AI 识图） ----------
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '请上传 jpg/png/gif/webp 图片（≤10MB）' });
    const id = 'u' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
    const ext = (path.extname(req.file.originalname) || '.jpg').toLowerCase().replace('.', '');
    const url = await storage.saveMemeImage(req.file.buffer, ext);
    const queue = loadQueue();
    queue[id] = { id, orig: req.file.originalname, url, createdAt: new Date().toISOString() };
    saveQueue(queue);
    res.json({ uploadId: id, url, orig: req.file.originalname });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 删除暂存（放弃这张）
app.delete('/api/upload/:id', (req, res) => {
  const queue = loadQueue();
  if (!queue[req.params.id]) return res.status(404).json({ error: 'not found' });
  delete queue[req.params.id];
  saveQueue(queue);
  res.json({ ok: true });
});

// 暂存队列
app.get('/api/upload', (req, res) => {
  const queue = loadQueue();
  res.json(Object.values(queue).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
});

// ---------- 确认入库：IP 固定蔚蓝档案，角色由角色名自动匹配/建档 ----------
app.post('/api/memes', express.json(), async (req, res) => {
  try {
    const { uploadId, title, text, crowd } = req.body || {};
    const queue = loadQueue();
    const item = queue[uploadId];
    if (!item) return res.status(404).json({ error: '上传记录不存在' });
    if (!title || !String(title).trim()) return res.status(400).json({ error: '请填写角色名' });

    // 上传不再选择 IP：统一按站点主权重「蔚蓝档案」归档；历史自定义 IP 的数据保持原样
    const ipId = 'ba';
    const finalEmo = ['doge'];
    // 人数分类：默认 / 多人（未指定时按默认）
    const crowdVal = crowd === 'multi' ? 'multi' : 'default';

    // 角色由角色名自动匹配；未命中自动建档（出现即建）
    const charId = await cdb.resolveCharacter(String(title).trim(), ipId);

    const code = await cdb.nextCode(ipId);
    await cdb.insertMeme({
      code, title: String(title).trim(), ip: ipId, char: charId,
      emo: JSON.stringify(finalEmo), views: 0, age_days: 0,
      auto: 0, conf: 0, text: text || '', image_url: item.url, crowd: crowdVal,
    });

    delete queue[uploadId];
    saveQueue(queue);

    if (charId) avatar.ensureAvatar(charId).catch(() => {});

    res.json({ ok: true, meme: await cdb.getMeme(code) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- 编辑档案：仅管理员可编辑（需口令） ---------- */
app.patch('/api/meme/:code', express.json(), async (req, res) => {
  try {
    const code = req.params.code;
    if (!(await cdb.getMeme(code))) return res.status(404).json({ error: '档案不存在' });

    const { title, ip, newIp, char, emo, text, adminKey } = req.body || {};
    if (String(adminKey || '') !== ADMIN_KEY) return res.status(403).json({ error: '无编辑权限：需要管理员口令' });
    if (!title || !String(title).trim()) return res.status(400).json({ error: '角色名不能为空' });

    let ipId = ip;
    if (ip === '__new__') {
      const name = String(newIp || '').trim();
      if (!name) return res.status(400).json({ error: '请填写自定义 IP 名称' });
      ipId = await cdb.ensureIp(name);
    }
    if (!(await cdb.getIp(ipId))) return res.status(400).json({ error: 'IP 无效' });

    const existing = await cdb.getMeme(code);
    let finalEmo;
    if (Array.isArray(emo)) {
      finalEmo = [];
      for (const e of emo) {
        const id = String(e).trim();
        if (!id) continue;
        await cdb.ensureEmotion(id);
        finalEmo.push(id);
      }
      if (!finalEmo.length) finalEmo.push('doge');
    } else {
      try { finalEmo = JSON.parse(existing.emo || '[]'); } catch { finalEmo = ['doge']; }
      if (!finalEmo.length) finalEmo.push('doge');
    }

    let charId = char || null;
    if (!charId && String(title).trim()) charId = await cdb.resolveCharacter(title, ipId);
    // 显式指定的新角色也自动建档（出现即建）
    if (charId && !(await cdb.getChar(charId))) {
      await cdb.insertChar({ id: charId, name: charId, en: '', ip: ipId, hue: cdb.hashHue(charId), avatar: '', is_new: 1 });
    }

    await cdb.adminUpdateMeme(adminKey, code, String(title).trim(), ipId, charId, JSON.stringify(finalEmo), text || '');

    if (charId) avatar.ensureAvatar(charId).catch(() => {});

    res.json({ ok: true, meme: await cdb.getMeme(code) });
  } catch (e) {
    const msg = String((e && e.message) || e || '');
    if (msg.includes('管理员口令') || msg.includes('无编辑权限')) return res.status(403).json({ error: '无编辑权限：需要管理员口令' });
    res.status(500).json({ error: msg });
  }
});

/* ---------- 删除档案：仅管理员可删除（需口令） ---------- */
app.delete('/api/meme/:code', express.json(), async (req, res) => {
  try {
    const code = req.params.code;
    const m = await cdb.getMeme(code);
    if (!m) return res.status(404).json({ error: '档案不存在' });

    const adminKey = (req.body && req.body.adminKey) || '';
    if (String(adminKey) !== ADMIN_KEY) return res.status(403).json({ error: '无删除权限：需要管理员口令' });

    await cdb.adminDeleteMeme(adminKey, code);
    // 顺带清理对象存储里的图片（失败不影响删除结果）
    if (m.image_url) storage.deleteMemeImage(m.image_url).catch(() => {});

    res.json({ ok: true });
  } catch (e) {
    const msg = String((e && e.message) || e || '');
    if (msg.includes('管理员口令') || msg.includes('无删除权限')) return res.status(403).json({ error: '无删除权限：需要管理员口令' });
    res.status(500).json({ error: msg });
  }
});

/* ---------- 手动上传角色头像（仅限尚无头图的角色） ---------- */
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => cb(null, /\.(jpe?g|png|webp)$/i.test(file.originalname)),
});

app.post('/api/chars/:id/avatar',
  async (req, res, next) => {
    try {
      const c = await cdb.getChar(req.params.id);
      if (!c) return res.status(404).json({ error: '角色不存在' });
      if (c.avatar) return res.status(403).json({ error: '该角色已有头图，仅限未带头图的角色上传' });
      next();
    } catch (e) { res.status(500).json({ error: e.message }); }
  },
  avatarUpload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: '请上传 jpg/png/webp 图片（≤5MB）' });
      const ext = (path.extname(req.file.originalname) || '.png').toLowerCase().replace('.', '');
      const url = await storage.saveAvatarImage(req.params.id, req.file.buffer, ext);
      await cdb.updateCharAvatar(req.params.id, url);
      res.json({ ok: true, avatar: url });
    } catch (e) { res.status(500).json({ error: e.message }); }
  }
);

/* ---------- SSR 详情页（SEO） ---------- */
async function renderSSR(m, base) {
  const [emotions, ips, all] = await Promise.all([cdb.allEmotions(), cdb.allIps(), cdb.allMemes()]);
  const emoMap = Object.fromEntries(emotions.map(e => [e.id, e.name]));
  const ipMap = Object.fromEntries(ips.map(i => [i.id, i]));
  const ip = ipMap[m.ip] || { name: m.ip, weight: 0.3 };
  const desc = `${m.title}｜${ip.name}${m.char_name ? ' · ' + m.char_name : ''}表情包。蔚蓝档案玩家共建 ba表情档案，${m.emo.map(id => emoMap[id] || id).join('、')}类表情，可直接下载使用。`;
  const img = absImg(m.image_url, base);
  const related = all.filter(x => x.code !== m.code && ((m.char && x.char === m.char) || x.emo.some(e => m.emo.includes(e)))).slice(0, 8);

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
<meta property="og:image" content="${img}">
<meta property="og:url" content="${base}/meme/${esc(m.code)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${img}">
<link rel="icon" type="image/png" href="/assets/img/favicon.png">
<link rel="stylesheet" href="/assets/css/tokens.css">
<link rel="stylesheet" href="/assets/css/components.css">
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'ImageObject',
    name: m.title, description: desc,
    contentUrl: img, thumbnailUrl: img,
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
        <div class="meta-list__row"><span class="meta-list__key">人数</span><span class="meta-list__val">${m.crowd === 'multi' ? '多人' : '默认'}</span></div>
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

app.get('/meme/:code', async (req, res) => {
  try {
    const m = await cdb.getMeme(req.params.code);
    if (!m) return res.status(404).send('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>档案不存在 - ba表情档案</title></head><body><div style="padding:60px;text-align:center;font-family:sans-serif"><h1>这份档案不存在</h1><p><a href="/">返回档案大厅</a></p></div></body></html>');
    res.send(await renderSSR(m, siteBase(req)));
  } catch (e) { res.status(500).send('服务器错误'); }
});

/* ---------- sitemap.xml + robots.txt（SEO） ---------- */
app.get('/sitemap.xml', async (req, res) => {
  try {
    const base = siteBase(req);
    const memes = await cdb.allMemes();
    const charIds = [...new Set(memes.map(m => m.char).filter(Boolean))];
    const urls = [
      { loc: '/', lastmod: new Date().toISOString().slice(0, 10), priority: 1.0 },
      { loc: '/search.html', lastmod: new Date().toISOString().slice(0, 10), priority: 0.8 },
      { loc: '/about.html', lastmod: new Date().toISOString().slice(0, 10), priority: 0.5 },
      ...memes.map(m => ({ loc: '/meme/' + m.code, lastmod: (m.created_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10), priority: 0.7 })),
      ...charIds.map(id => ({ loc: '/search.html?char=' + encodeURIComponent(id), lastmod: new Date().toISOString().slice(0, 10), priority: 0.6 })),
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.map(u => `  <url><loc>${base}${u.loc}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.priority}</priority></url>`).join('\n') +
      `\n</urlset>`;
    res.type('application/xml').send(xml);
  } catch (e) { res.status(500).send('error'); }
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /upload.html\nDisallow: /api/\n\nSitemap: ${siteBase(req)}/sitemap.xml`);
});

/* ---------- 静态托管 ---------- */
app.use('/uploads', express.static(path.join(__dirname, 'data', 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ba表情档案 后端已启动: http://localhost:${PORT}`);
  avatar.ensureAllAvatars().then(done => {
    if (done.length) console.log('已自动补全角色头像:', done.join(', '));
  }).catch(() => {});
});
