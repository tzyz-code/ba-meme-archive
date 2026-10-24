/* 图片存储：上传表情图 + 角色头图
   优先走腾讯云 COS（匿名上传不依赖登录）；未配置 COS 时回退本地文件（仅本地开发/测试用） */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MEME_DIR = path.join(__dirname, '..', 'data', 'uploads');
const CHARS_DIR = path.join(__dirname, '..', 'public', 'assets', 'img', 'chars');
const COS_CONFIG = path.join(__dirname, '..', 'data', 'cos-config.json');

/* 读取 COS 凭证：优先环境变量，其次 data/cos-config.json（gitignore，随部署上传） */
function cosCfg() {
  const env = {
    SecretId: process.env.COS_SECRET_ID, SecretKey: process.env.COS_SECRET_KEY,
    Bucket: process.env.COS_BUCKET, Region: process.env.COS_REGION,
  };
  if (env.SecretId && env.SecretKey && env.Bucket && env.Region) return env;
  try { return JSON.parse(fs.readFileSync(COS_CONFIG, 'utf8')); } catch { return {}; }
}

function cosConfigured() {
  const c = cosCfg();
  return !!(c.SecretId && c.SecretKey && c.Bucket && c.Region);
}

function cosUpload(key, buffer, ext) {
  const COS = require('cos-nodejs-sdk-v5');
  const c = cosCfg();
  const client = new COS({ SecretId: c.SecretId, SecretKey: c.SecretKey });
  return new Promise((resolve, reject) => {
    client.putObject({
      Bucket: c.Bucket,
      Region: c.Region,
      Key: key,
      Body: buffer,
      ContentType: 'image/' + (ext === 'jpg' ? 'jpeg' : ext),
      ACL: 'public-read',
    }, (err) => {
      if (err) return reject(err);
      resolve(`https://${c.Bucket}.cos.${c.Region}.myqcloud.com/${key}`);
    });
  });
}

/* 保存表情图 → 返回可访问 URL */
async function saveMemeImage(buffer, ext) {
  ext = String(ext || 'jpg').toLowerCase().replace('.', '');
  if (cosConfigured()) {
    const key = `memes/${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}.${ext}`;
    return cosUpload(key, buffer, ext);
  }
  fs.mkdirSync(MEME_DIR, { recursive: true });
  const name = Date.now().toString(36) + crypto.randomBytes(4).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(MEME_DIR, name), buffer);
  return '/uploads/' + name;
}

/* 保存角色头图 → 返回可访问 URL */
async function saveAvatarImage(charId, buffer, ext) {
  ext = String(ext || 'png').toLowerCase().replace('.', '');
  if (cosConfigured()) {
    const key = `chars/${charId}.${ext}`;
    return cosUpload(key, buffer, ext);
  }
  fs.mkdirSync(CHARS_DIR, { recursive: true });
  const name = charId + '.' + ext;
  fs.writeFileSync(path.join(CHARS_DIR, name), buffer);
  return 'assets/img/chars/' + name;
}

/* 删除表情图：COS 按 Key 删除，本地路径删 data/uploads 下的文件 */
async function deleteMemeImage(url) {
  if (!url) return;
  const s = String(url);
  if (/^https?:\/\//.test(s)) {
    const c = cosCfg();
    if (!c.SecretId || !c.Bucket) return;
    const prefix = `https://${c.Bucket}.cos.${c.Region}.myqcloud.com/`;
    if (!s.startsWith(prefix)) return;
    const key = decodeURIComponent(s.slice(prefix.length));
    const COS = require('cos-nodejs-sdk-v5');
    const client = new COS({ SecretId: c.SecretId, SecretKey: c.SecretKey });
    await new Promise((resolve, reject) => {
      client.deleteObject({ Bucket: c.Bucket, Region: c.Region, Key: key }, (err) => err ? reject(err) : resolve());
    });
    return;
  }
  if (s.startsWith('/uploads/')) {
    fs.promises.unlink(path.join(MEME_DIR, path.basename(s))).catch(() => {});
  }
}

module.exports = { saveMemeImage, saveAvatarImage, deleteMemeImage, cosConfigured };
