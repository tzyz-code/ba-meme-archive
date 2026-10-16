/* 一次性 CDP 验证脚本：打开页面、收集报错、截图指定区域 */
const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');

const url = process.argv[2] || 'http://localhost:4322/index.html';
const shotPath = process.argv[3] || '';
const selector = process.argv[4] || '';

function getJson(u) {
  return new Promise((res, rej) => {
    http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
  });
}

(async () => {
  const tabs = await getJson('http://127.0.0.1:9222/json');
  const page = tabs.find(t => t.type === 'page');
  if (!page) { console.log('NO PAGE TAB'); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0;
  const pending = {};
  const send = (method, params = {}) => new Promise(res => {
    const mid = ++id; pending[mid] = res;
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.on('message', m => {
    const d = JSON.parse(m);
    if (d.id && pending[d.id]) { pending[d.id](d.result); delete pending[d.id]; }
  });
  await new Promise(r => ws.on('open', r));
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });
  await new Promise(r => setTimeout(r, 3500));

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r.result && r.result.value;
  };

  const errs = await evalJs(`window.__errs || []`);
  const info = await evalJs(`JSON.stringify({
    title: document.title,
    charCards: document.querySelectorAll('.char-card').length,
    charImgs: [...document.querySelectorAll('.char-card__avatar img')].filter(i=>i.complete&&i.naturalWidth>0).length,
    memeCards: document.querySelectorAll('.card').length,
    total: (document.querySelector('#statTotal')||{}).textContent,
    emojiLeft: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(document.body.innerText)
  })`);

  if (shotPath) {
    if (selector) {
      await evalJs(`document.querySelector('${selector}') && document.querySelector('${selector}').scrollIntoView({block:'center'})`);
      await new Promise(r => setTimeout(r, 800));
    }
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
  }

  console.log('ERRORS:', JSON.stringify(errs));
  console.log(info);
  ws.close();
  process.exit(0);
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
