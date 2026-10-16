/* 经 GitHub API 逐文件建仓（小请求避开代理对大包上传的限制） */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = 'tzyz-code/ba-meme-archive';
const PROXY = 'http://127.0.0.1:7890';
const API = `https://api.github.com/repos/${REPO}`;

function token() {
  const out = execSync('git credential fill', { input: 'protocol=https\nhost=github.com\n' }).toString();
  return out.split('\n').find(l => l.startsWith('password=')).slice(9);
}

async function api(method, url, body, tok, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, {
        method,
        headers: { Authorization: `token ${tok}`, 'User-Agent': 'ba-meme-archive', Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 409 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`HTTP ${res.status} ${JSON.stringify(j).slice(0, 200)}`);
      return j;
    } catch (e) {
      console.log(`  retry ${i}/${tries}: ${e.message}`);
      if (i === tries) throw e;
      await new Promise(r => setTimeout(r, 2500));
    }
  }
}

(async () => {
  const tok = token();
  console.log('凭证账号确认中…');
  const me = await api('GET', 'https://api.github.com/user', null, tok);
  console.log('认证账号:', me.login);

  const files = execSync('git -c core.quotepath=false ls-files').toString().split('\n').filter(Boolean);
  console.log(`待上传 ${files.length} 个文件`);

  // 0) 空仓库先用 contents API 建初始提交（README.md）
  let headSha;
  try {
    const init = await api('PUT', `${API}/contents/README.md`, {
      message: 'init: README',
      content: fs.readFileSync('README.md').toString('base64'),
    }, tok);
    headSha = init.commit.sha;
    console.log('初始提交:', headSha);
  } catch (e) {
    // 已有提交则取 HEAD
    const c = await api('GET', `${API}/commits/heads/main`.replace('/commits/heads/', '/commits/'), null, tok).catch(async () => await api('GET', `${API}/commits`, null, tok));
    headSha = (c.sha || (c[0] && c[0].sha));
    console.log('已有提交:', headSha);
  }

  // 1) 逐个建 blob（跳过 README.md）
  const tree = [];
  for (const f of files) {
    if (f === 'README.md') continue;
    const content = fs.readFileSync(path.join('.', f));
    const b = await api('POST', `${API}/git/blobs`, { content: content.toString('base64'), encoding: 'base64' }, tok);
    tree.push({ path: f.replace(/\\/g, '/'), mode: '100644', type: 'blob', sha: b.sha });
    process.stdout.write(`  blob ${f} ok\n`);
  }

  // 2) 建 tree（基于已有 HEAD，保留 README）
  const t = await api('POST', `${API}/git/trees`, { base_tree: headSha, tree }, tok);
  console.log('tree:', t.sha);

  // 3) 建 commit
  const c = await api('POST', `${API}/git/commits`, {
    message: 'feat: 全部源码与文档',
    tree: t.sha,
    parents: [headSha],
  }, tok);
  console.log('commit:', c.sha);

  // 4) 更新 main 分支
  await api('PATCH', `${API}/git/refs/heads/main`, { sha: c.sha, force: true }, tok);
  console.log('=== 仓库构建完成！');
})().catch(e => { console.log('FATAL:', e.message); process.exit(1); });
