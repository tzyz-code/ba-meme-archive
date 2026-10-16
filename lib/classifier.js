/* 识图 Provider（可插拔）
   阶段3 默认实现：启发式识别（文件名/字典匹配）。
   未来接入真模型（CLIP/多模态 LLM）时，实现同一个 classify 接口注册即可：
     registerProvider('clip', async (filePath, origName) => ({ ip, char, emo, conf }))
   并把 ACTIVE_PROVIDER 换成对应名字。 */

const { db, hydrate } = require('../db');
const visual = require('./visual');

const PROVIDERS = {};
let ACTIVE_PROVIDER = 'heuristic';

function registerProvider(name, fn) { PROVIDERS[name] = fn; }
function setProvider(name) { if (PROVIDERS[name]) ACTIVE_PROVIDER = name; }

/* 字典缓存（进程内，入库后自动刷新） */
let _dict = null;
function refreshDict() {
  _dict = {
    chars: db.prepare('SELECT * FROM characters').all().map(hydrate),
    ips: db.prepare('SELECT * FROM ips').all(),
    emos: db.prepare('SELECT * FROM emotions').all(),
  };
  return _dict;
}
function dict() { return _dict || refreshDict(); }

/* 启发式识别：文件名 + 标题关键词 匹配角色/IP/情绪字典 */
async function heuristicClassify(filePath, origName, hint = '') {
  const d = dict();
  const hay = `${origName} ${hint}`.toLowerCase();

  // 1) 角色匹配（id / en / name，长词优先避免误命中）
  let char = null, ip = null, conf = 0;
  const chars = [...d.chars].sort((a, b) => (b.en || '').length - (a.en || '').length);
  for (const c of chars) {
    const keys = [c.id.toLowerCase(), (c.en || '').toLowerCase(), c.name].filter(k => k && k.length >= 2);
    if (keys.some(k => hay.includes(k))) {
      char = c.id; ip = c.ip; conf = 88;
      break;
    }
  }

  // 2) IP 匹配（角色没命中时）
  if (!ip) {
    for (const ipRow of d.ips) {
      const keys = [ipRow.id, (ipRow.short || '').toLowerCase(), ipRow.name].filter(k => k && k.length >= 2);
      if (keys.some(k => hay.includes(k))) {
        ip = ipRow.id; conf = Math.max(conf, 72);
        break;
      }
    }
  }

  // 3) 情绪关键词
  const emoHits = [];
  const emoWords = {
    laugh: ['笑', '哈哈', 'lol', 'funny', '搞笑'],
    cry:   ['哭', '泪', 'sad', 'cry', 'emo'],
    angry: ['怒', '气', 'angry', 'mad'],
    shock: ['惊', '震', 'wow', '什么'],
    sleep: ['睡', '困', 'zzz', 'sleep'],
    love:  ['爱', '喜欢', 'love', 'kawaii'],
    fight: ['打', '干架', 'fight'],
    doge:  ['无语', 'doge', '滑稽', '蔑'],
  };
  for (const [emoId, words] of Object.entries(emoWords)) {
    if (words.some(w => hay.includes(w))) emoHits.push(emoId);
  }

  // 4) 兜底：未识别 → 通用表情，低置信度，等待人工校正
  if (!ip) { ip = 'none'; conf = 40; }
  if (emoHits.length === 0) emoHits.push('doge');

  return {
    provider: 'heuristic',
    ip,
    char: char || null,
    emo: emoHits.slice(0, 2),
    conf,
    auto: conf >= 70,
  };
}

/* 综合识别：文件名启发式 → 未命中时用 pHash 视觉相似度匹配角色头像 */
async function combinedClassify(filePath, origName, hint) {
  const base = await heuristicClassify(filePath, origName, hint);
  if (base.char) return base; // 文件名已命中，置信度高，直接用

  try {
    const hit = await visual.matchChar(filePath);
    if (hit) {
      const chRow = db.prepare('SELECT * FROM characters WHERE id=?').get(hit.char);
      return {
        provider: 'visual-phash',
        ip: (chRow && chRow.ip) || 'ba',
        char: hit.char,
        emo: base.emo,
        conf: Math.max(60, 92 - hit.distance),   // 距离越小置信越高
        auto: hit.distance <= 14,                // 很像才自动，其余仍待校正
        visualDistance: hit.distance,
      };
    }
  } catch {}
  return base;
}

registerProvider('heuristic', heuristicClassify);
registerProvider('visual', combinedClassify);
setProvider('visual');

async function classify(filePath, origName, hint) {
  const fn = PROVIDERS[ACTIVE_PROVIDER] || heuristicClassify;
  return fn(filePath, origName, hint);
}

module.exports = { classify, registerProvider, setProvider, refreshDict };
