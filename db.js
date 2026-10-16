/* 数据库层：SQLite（node:sqlite 内置模块，零编译依赖） */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'archive.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS ips (
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    short    TEXT,
    weight   REAL NOT NULL DEFAULT 0.3,
    cls      TEXT,
    priority INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS characters (
    id     TEXT PRIMARY KEY,
    name   TEXT NOT NULL,
    en     TEXT,
    ip     TEXT,
    hue    INTEGER DEFAULT 210,
    avatar TEXT,
    is_new INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS emotions (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS memes (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    code     TEXT UNIQUE NOT NULL,
    title    TEXT NOT NULL,
    ip       TEXT,
    char     TEXT,
    emo      TEXT,
    views    INTEGER DEFAULT 0,
    age_days INTEGER DEFAULT 0,
    auto     INTEGER DEFAULT 0,
    conf     INTEGER DEFAULT 0,
    text     TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_memes_ip   ON memes(ip);
  CREATE INDEX IF NOT EXISTS idx_memes_char ON memes(char);
`);

/* 增量迁移：上传图片的真实 URL（阶段3） */
try { db.exec('ALTER TABLE memes ADD COLUMN image_url TEXT'); } catch {}

/* 把 emo 的 JSON 字符串还原成数组，统一输出形状 */
function hydrate(row) {
  if (!row) return null;
  const r = { ...row };
  try { r.emo = JSON.parse(r.emo || '[]'); } catch { r.emo = []; }
  r.auto = !!r.auto;
  r.is_new = !!r.is_new;
  return r;
}

module.exports = { db, hydrate, DB_PATH };
