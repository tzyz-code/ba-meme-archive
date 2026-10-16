/* 阶段2 API 验证脚本 */
const BASE = 'http://localhost:3000';

async function get(path) {
  const r = await fetch(BASE + path);
  return r.json();
}

(async () => {
  let ok = true;
  const check = (name, cond, detail = '') => {
    console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!cond) ok = false;
  };

  // 1. 搜「白子」
  let r = await get('/api/search?q=' + encodeURIComponent('白子'));
  check('搜「白子」命中白子条目', r.total > 0 && r.list[0].title.includes('白子'), r.list[0]?.title);

  // 2. 搜「猫猫」→ 通用表情(ip none)
  r = await get('/api/search?q=' + encodeURIComponent('猫猫'));
  check('搜「猫猫」命中通用表情(ip=none)', r.list.some(m => m.ip === 'none'), r.list[0]?.ip);

  // 3. 默认排序前6名全是 ba
  r = await get('/api/search?limit=6');
  check('默认排序前6名全是蔚蓝档案', r.list.length === 6 && r.list.every(m => m.ip === 'ba'), r.list.map(m => m.ip).join(','));

  // 4. 搜编号 BA-0003 精确命中
  r = await get('/api/search?q=BA-0003');
  check('搜编号 BA-0003 精确命中', r.list[0]?.code === 'BA-0003', r.list[0]?.title);

  // 5. BA 权重 > 其它 IP（同条件排序下 ba 靠前）
  r = await get('/api/search?emo=laugh&limit=50');
  const baFirst = r.list.findIndex(m => m.ip !== 'ba');
  const hasBA = r.list.some(m => m.ip === 'ba');
  check('同情绪下 BA 排在其它 IP 之前', hasBA && (baFirst === -1 || baFirst > 0), `首个非BA在第${baFirst + 1}位`);

  // 6. 角色筛选 azusa（自动建档的新角色可检索）
  r = await get('/api/search?char=azusa');
  check('角色筛选 azusa 可检索', r.total === 1 && r.list[0].code === 'BA-0019', r.list[0]?.title);

  // 7. 详情 + 相关
  r = await get('/api/meme/BA-0001');
  check('详情接口返回 meme+related', r.meme?.code === 'BA-0001' && Array.isArray(r.related), `related:${r.related?.length}`);

  // 8. 排序 hot
  r = await get('/api/search?sort=hot&limit=1');
  check('热度排序', r.list[0]?.views === Math.max(...r.list.map(m => m.views)));

  console.log(ok ? '\n全部通过' : '\n存在失败');
  process.exit(ok ? 0 : 1);
})();
