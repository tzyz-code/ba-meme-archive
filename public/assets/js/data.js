/* 表情档案馆 · 模拟数据层（IIFE 封装，避免顶层变量与页面脚本冲突） */
(function(){
/* ============================================================
   表情档案馆 · 模拟数据层
   阶段1 使用此数据驱动前端原型；阶段2 起由后端 API 替换。
   角色与 IP 采用蔚蓝档案真实设定，确保排序/归类逻辑可真实校验。
   ============================================================ */

/* ---------- 从后端同步加载数据（阶段2起）----------
   后端启动时用真实落库数据；后端未启动/加载失败则回退到下方内置静态数据。
   同步 XHR 保证 data.js 加载完成后数据即刻可用，页面脚本无需改动。 */
function loadServerData() {
  try {
    const sync = (url) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.send(null);
      if (xhr.status !== 200) throw new Error(url + ' -> ' + xhr.status);
      return JSON.parse(xhr.responseText);
    };
    const meta = sync('/api/meta');
    const res  = sync('/api/search?limit=500');
    const ipMap = {};
    for (const ip of meta.ips) ipMap[ip.id] = { id: ip.id, name: ip.name, short: ip.short, weight: ip.weight, cls: ip.cls, priority: ip.priority };
    const chars = meta.chars.map(c => ({ id: c.id, name: c.name, en: c.en, ip: c.ip, hue: c.hue, avatar: c.avatar, isNew: !!c.is_new }));
    const emotions = meta.emotions.map(e => ({ id: e.id, name: e.name }));
    const memes = res.list.map(m => ({
      code: m.code, title: m.title, ip: m.ip, char: m.char, emo: m.emo,
      views: m.views, d: m.age_days, auto: !!m.auto, conf: m.conf, text: m.text,
      imageUrl: m.image_url || ''
    }));
    return { ipMap, chars, emotions, memes };
  } catch (e) {
    return null;
  }
}
const SERVER = loadServerData();

/* ---------- IP 定义：weight 即搜索加权权重 ---------- */
const IP_DB = SERVER ? SERVER.ipMap : {
  ba:       { id: 'ba',        name: '蔚蓝档案',       short: 'BA',  weight: 1.0,  cls: 'ip-badge--ba',    priority: 0 },
  azur:     { id: 'azur',      name: '碧蓝航线',     short: 'AZ',  weight: 0.30, cls: 'ip-badge--other', priority: 1 },
  genshin:  { id: 'genshin',   name: '原神',           short: 'GS',  weight: 0.30, cls: 'ip-badge--other', priority: 1 },
  hk3:      { id: 'hk3',       name: '崩坏3',          short: 'HK3', weight: 0.30, cls: 'ip-badge--other', priority: 1 },
  arknights:{ id: 'arknights', name: '明日方舟',     short: 'AK',  weight: 0.30, cls: 'ip-badge--other', priority: 1 },
  none:     { id: 'none',      name: '通用表情',     short: 'GEN', weight: 0.10, cls: 'ip-badge--none',  priority: 9 },
};

/* ---------- 角色库 ---------- */
const CHARS = SERVER ? SERVER.chars : [
  { id: 'shiroko',   name: '白子',   en: 'Shiroko',   ip: 'ba', hue: 218, avatar: 'assets/img/chars/shiroko.png' },
  { id: 'hoshino',   name: '星野',   en: 'Hoshino',   ip: 'ba', hue: 262, avatar: 'assets/img/chars/hoshino.png' },
  { id: 'kokona',    name: '心奈',   en: 'Kokona',    ip: 'ba', hue: 190, avatar: 'assets/img/chars/kokona.png' },
  { id: 'yuuka',     name: '优香',   en: 'Yuuka',     ip: 'ba', hue: 340, avatar: 'assets/img/chars/yuuka.png' },
  { id: 'mutsuki',   name: '睦月',   en: 'Mutsuki',   ip: 'ba', hue: 205, avatar: 'assets/img/chars/mutsuki.png' },
  { id: 'aru',       name: '阿露',   en: 'Aru',       ip: 'ba', hue: 210, avatar: 'assets/img/chars/arisu.png' },
  { id: 'sumire',    name: '堇',     en: 'Sumire',    ip: 'ba', hue: 285, avatar: 'assets/img/chars/sumire.png' },
  { id: 'nonomi',    name: '野宫',   en: 'Nonomi',    ip: 'ba', hue: 45,  avatar: 'assets/img/chars/nonomi.png' },
  { id: 'ayane',     name: '绫音',   en: 'Ayane',     ip: 'ba', hue: 230, avatar: 'assets/img/chars/ayane.png' },
  { id: 'serika',    name: '芹香',   en: 'Serika',    ip: 'ba', hue: 160, avatar: 'assets/img/chars/serika.png' },
  { id: 'kei',       name: '凯伊',   en: 'Kei',       ip: 'ba', hue: 15,  avatar: 'assets/img/logo/kei-avatar.png' },
];

/* ---------- 情绪标签 ---------- */
const EMOTIONS = SERVER ? SERVER.emotions : [
  { id: 'doge',    name: '无语' },
  { id: 'laugh',   name: '爆笑' },
  { id: 'cry',     name: '落泪' },
  { id: 'angry',   name: '愤怒' },
  { id: 'love',    name: '爱了' },
  { id: 'shock',   name: '震惊' },
  { id: 'sleep',   name: '睡死' },
  { id: 'fight',   name: '干架' },
];

/* ---------- 表情档案数据 ----------
   code   : 档案编号（用户会看到，具收藏感）
   title  : 角色名（即归档标题）
   ip     : 所属 IP（决定 badge 与权重）
   char   : 角色 id
   emo    : 情绪 id[]
   views  : 浏览量（热度）
   d      : 天数前（时效性权重）
   auto   : 是否为模型自动归类（展示 ⌁ 标记）
   conf   : 识别置信度
   text   : 表情上的文字（搜索关键词）
------------------------------------------- */
const MEMES = SERVER ? SERVER.memes : [];
/* ---------- 工具函数 ---------- */
const DB = { IP_DB, CHARS, EMOTIONS, MEMES };

const q1 = (sel, root = document) => root.querySelector(sel);
const qAll = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ipOf    = id => IP_DB[id] || IP_DB.none;
const emoOf   = id => EMOTIONS.find(e => e.id === id) || null;

/* 角色字典：id → 元数据（已知角色）。
   注意：CHARS 只是「已知角色字典」，不是角色馆名单 ——
   角色馆名单由 charCatalog() 从已收录表情包里动态派生。 */
const CHAR_MAP = Object.fromEntries(CHARS.map(c => [c.id, c]));

/* 稳定色相：新角色按 id 生成一个不重复的底色 */
function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 360;
}

/* 角色查询：查得到返回字典元数据；查不到自动「新建角色目录」（待命名状态）。
   仅当 id 为空（该表情无角色）时返回 null。 */
function charOf(id) {
  if (!id) return null;
  if (CHAR_MAP[id]) return CHAR_MAP[id];
  return { id, name: id, en: '', ip: 'ba', hue: hashHue(id), avatar: '', isNew: true };
}

/* 角色馆目录：从已收录表情包中动态聚合出现过的角色（出现即建目录） */
function charCatalog() {
  const count = {};
  for (const m of MEMES) if (m.char) count[m.char] = (count[m.char] || 0) + 1;
  return Object.keys(count)
    .map(id => ({ ...charOf(id), count: count[id] }))
    .sort((a, b) => (b.count - a.count) || (a.isNew ? 1 : 0) - (b.isNew ? 1 : 0));
}

/* 头像主体：有图用图，无图（新角色待补图）用「首字 + 渐变色」占位 */
function charAvatarHTML(char) {
  if (!char) return '';
  if (char.avatar) return `<img class="char-av" src="${char.avatar}" alt="${char.name}">`;
  return `<span class="char-av char-av--fallback" style="background:${avatarStyle(char)}">${char.name.charAt(0)}</span>`;
}

/* IP 徽章 HTML —— BA 专属实心蓝，其余弱化 */
function ipBadge(ipId) {
  const ip = ipOf(ipId);
  const isBA = ip.id === 'ba';
  return `<span class="ip-badge ${ip.cls}">${isBA ? '' : '<i class="ip-badge__dot"></i>'}${ip.name}</span>`;
}

/* 角色显示名：英文名优先（无 en 的新角色用中文名/id） */
function charDisplayName(char) {
  if (!char) return '';
  return char.en || char.name || char.id;
}

/* 角色头像底色：由 hue 生成稳定渐变 */
function avatarStyle(char) {
  if (!char) return 'background:linear-gradient(140deg,#8FA9FF,#5B7EF5)';
  return `background:linear-gradient(140deg,hsl(${char.hue} 82% 66%),hsl(${char.hue} 68% 48%))`;
}

/* ---------- 核心排序算法 ----------
   文本相关性（决定搜索命中）+ 最终分：
   最终分 = 文本相关性 + 0.35×IP权重 + 0.20×热度归一 + 0.15×时效归一
   蔚蓝档案 ipWeight=1.0 → 贡献 0.35 分，天然压过其它 IP
------------------------------------------- */
function textScore(m, query) {
  if (!query) return 0;
  let s = 0;
  const q = query.toLowerCase();
  const ch = charOf(m.char);
  const fields = [
    { t: m.title, w: 3.0 },
    { t: ch ? ch.name : '', w: 2.5 },
    { t: ch ? ch.en : '', w: 1.5 },
    { t: m.text, w: 1.2 },
    { t: m.code, w: 1.0 },
  ];
  for (const f of fields) {
    if (!f.t) continue;
    const hay = f.t.toLowerCase();
    if (hay === q) s += f.w * 3;                 // 完全匹配
    else if (hay.includes(q)) s += f.w * 1.6;    // 包含
    else if (q.length >= 2 && q.split('').every(c => hay.includes(c))) s += f.w * 0.25; // 模糊（≥2字）
  }
  return s;
}

function scoreMeme(m, query) {
  let s = textScore(m, query);

  // IP 权重（蔚蓝档案加权核心）
  s += 0.35 * ipOf(m.ip).weight;

  // 热度归一
  s += 0.20 * Math.log10(m.views + 1) / Math.log10(20000);

  // 时效归一
  s += 0.15 * Math.exp(-m.d / 45);

  // 人工确认过的归类略微加成（可信度）
  s += 0.03 * (m.conf / 100);

  return s;
}

/* 完整检索：文本 + 筛选 + 排序 */
function search({ query = '', ip = 'all', char = 'all', emo = 'all', sort = 'relevance' } = {}) {
  let list = MEMES.slice();

  if (ip   !== 'all') list = list.filter(m => m.ip === ip);
  if (char !== 'all') list = list.filter(m => m.char === char);
  if (emo  !== 'all') list = list.filter(m => m.emo.includes(emo));

  if (query) {
    list = list.filter(m => textScore(m, query) > 0);   // 命中门槛只看文本相关性
    list.sort((a, b) => scoreMeme(b, query, null) - scoreMeme(a, query, null));
  } else {
    list.sort((a, b) => scoreMeme(b, '', null) - scoreMeme(a, '', null));
  }

  if (sort === 'hot')  list.sort((a, b) => b.views - a.views);
  if (sort === 'new')  list.sort((a, b) => a.d - b.d);
  if (sort === 'conf') list.sort((a, b) => b.conf - a.conf);

  return list;
}

/* ---------- 渲染 ---------- */
function cardHTML(m) {
  const ch = charOf(m.char);
  const isBA = m.ip === 'ba';

  return `
  <article class="card ${isBA ? 'card--ba' : ''}" data-code="${m.code}" data-ip="${m.ip}" data-char="${m.char || ''}">
    <button class="card__fav" aria-label="收藏">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>
      </svg>
    </button>
    <div class="card__media">
      ${m.imageUrl
        ? `<img class="card__img" src="${m.imageUrl}" alt="${m.title}" loading="lazy">`
        : m.emojiArt ? '' : (ch
        ? charAvatarHTML(ch)
        : `<svg class="card__ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:44px;height:44px;opacity:.3;color:var(--color-text-faint)"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M3 17l5-5 4 4 3-3 6 5"/></svg>`)}
    </div>
    <div class="card__body">
      <h3 class="card__title">${m.title}</h3>
      <div class="card__tags">
        ${ipBadge(m.ip)}
        ${ch ? `<span class="tag tag--char">${charDisplayName(ch)}</span>` : ''}
      </div>
      ${m.auto ? `<div class="card__meta"><span class="card__stat" style="color:var(--teal-500)">⌁ AI ${m.conf}%</span></div>` : ''}
    </div>
  </article>`;
}

/* 详情页：取单条 + 同角色相关 */
function getMeme(code) {
  const m = MEMES.find(x => x.code === code);
  if (!m) return null;
  const related = MEMES.filter(x => x.code !== code && (
    (m.char && x.char === m.char) || x.emo.some(e => m.emo.includes(e))
  )).slice(0, 8);
  return { meme: m, related };
}

/* Toast */
let toastHost;
function toast(msg, ms = 2200) {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'toast-host';
    document.body.appendChild(toastHost);
  }
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  toastHost.appendChild(el);
  setTimeout(() => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 260);
  }, ms);
}

/* 收藏（localStorage） */
const FavKey = 'ba_archive_favs';
const favs = {
  all: () => { try { return new Set(JSON.parse(localStorage.getItem(FavKey) || '[]')); } catch { return new Set(); } },
  has: c => favs.all().has(c),
  toggle(c) {
    const s = favs.all();
    s.has(c) ? s.delete(c) : s.add(c);
    localStorage.setItem(FavKey, JSON.stringify([...s]));
    return s.has(c);
  }
};

/* ============================================================
   全局挂载
   注意：顶层 const 不会成为 window 的属性，必须显式挂载，
   否则页面里的 window.CHARS / window.MEMES 会是 undefined。
   ============================================================ */
window.IP_DB = IP_DB;
window.CHARS = CHARS;
window.CHAR_MAP = CHAR_MAP;
window.EMOTIONS = EMOTIONS;
window.MEMES = MEMES;
window.DB = { IP_DB, CHARS, EMOTIONS, MEMES };
window.UI = { charDisplayName, $: q1, $$: qAll, ipBadge, avatarStyle, scoreMeme, search, cardHTML, getMeme, toast, favs, charOf, charCatalog, charAvatarHTML, emoOf, ipOf };
window.$ = q1;
window.$$ = qAll;

})();