/* 移动端适配验证：iPhone 视口 + 各页面截图与布局检查 */
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');

const getJson = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));

(async () => {
  const tabs = await getJson('http://127.0.0.1:9222/json');
  const page = tabs.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  const send = (m, p = {}) => new Promise(res => { const i = ++id; pend[i] = res; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', m => { const d = JSON.parse(m); if (d.id && pend[d.id]) { pend[d.id](d.result); delete pend[d.id]; } });
  await new Promise(r => ws.on('open', r));
  await send('Page.enable'); await send('Runtime.enable');

  // iPhone 视口
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;
  const shot = async (url, path) => {
    await send('Page.navigate', { url });
    await new Promise(r => setTimeout(r, 3000));
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path, Buffer.from(s.data, 'base64'));
  };

  // 首页
  await shot('http://localhost:3000/index.html', 'docs/mobile-home.png');
  console.log('首页:', await ev(`JSON.stringify({
    errs: window.__errs || [],
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    toggleVisible: (document.querySelector('.sidebar__toggle')||{}).offsetParent !== null,
    gridCols: getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length,
    charCols: getComputedStyle(document.querySelector('.char-grid')).gridTemplateColumns.split(' ').length,
    searchW: Math.round(document.querySelector('.hero__search').getBoundingClientRect().width)
  })`));

  // 点开筛选
  await ev(`document.querySelector('.sidebar__toggle').click()`);
  await new Promise(r => setTimeout(r, 500));
  console.log('筛选展开:', await ev(`document.querySelector('.sidebar').classList.contains('is-open')`));
  const s2 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('docs/mobile-filter.png', Buffer.from(s2.data, 'base64'));

  // 搜索页
  await shot('http://localhost:3000/search.html?q=%E7%99%BD%E5%AD%90', 'docs/mobile-search.png');
  console.log('搜索页:', await ev(`JSON.stringify({ errs: window.__errs||[], overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth })`));

  // 详情页
  await shot('http://localhost:3000/detail.html?code=BA-0020', 'docs/mobile-detail.png');
  console.log('详情页:', await ev(`JSON.stringify({ errs: window.__errs||[], overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth })`));

  // 上传页
  await shot('http://localhost:3000/upload.html', 'docs/mobile-upload.png');
  console.log('上传页:', await ev(`JSON.stringify({ errs: window.__errs||[], overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth })`));

  ws.close(); process.exit(0);
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
