# ba表情档案 · BA Meme Archive

蔚蓝档案表情包一站式检索站 —— 玩家共建的表情包档案馆：上传即自动识别归类，按角色、关键词、档案编号快速检索。

## 功能

- **检索**：多字段搜索（标题 / 角色中英文名 / 关键词 / 编号），权重排序（蔚蓝档案优先 ×3.3 权重）
- **上传入库**：拖拽上传 → 自动识图（文件名启发式 + pHash 视觉匹配）→ 人工校正 → 入库
- **角色目录**：出现即建目录；新角色自动从 kivo.wiki 拉取头像，失败可手动上传
- **编辑档案**：标题 / IP / 角色 / 关键词随时可改，新角色同步建档
- **收藏、浏览计数、相关档案推荐**
- **SEO**：每张档案独立 SSR 详情页（`/meme/:code`），含 JSON-LD ImageObject、og 标签、sitemap.xml / robots.txt
- **移动端适配**：响应式布局，手机可用

## 技术栈

- 后端：Node.js（Express + `node:sqlite` 内置模块，零编译依赖）
- 前端：原生 HTML / CSS / JS（无框架、无构建）
- 依赖：`express`、`multer`（上传）、`jimp`（pHash 视觉识别）

## 快速开始

```bash
npm install
npm run seed   # 初始化字典（IP / 角色库，档案库为空等待上传）
npm start      # http://localhost:3000
```

## 目录结构

```
├── server.js          # Express 后端（API + SSR 详情页 + sitemap/robots）
├── db.js              # SQLite 初始化与迁移
├── seed.js            # 字典种子（IP/角色/情绪）
├── lib/
│   ├── classifier.js  # 识图 Provider（可插拔，启发式 + pHash 融合）
│   ├── visual.js      # pHash 视觉相似度匹配（对比角色头像）
│   └── avatar.js      # 新角色头像自动获取（kivo.wiki）
├── public/            # 前端静态资源
│   ├── index.html     # 档案大厅
│   ├── search.html    # 搜索页
│   ├── detail.html    # 详情页（前端版，canonical 指向 SSR）
│   ├── upload.html    # 上传入库
│   ├── report.html    # 侵权反馈
│   └── assets/        # 设计令牌、组件样式、JS 数据层
├── docs/              # kivo.wiki 学生头像 sitemap（头像匹配索引用）
└── data/              # 运行时数据（gitignore：SQLite + uploads）
```

## 数据说明

- 所有数据存于本地 SQLite（`data/archive.db`），不依赖外部数据库，随项目发布即可运行
- 数据层保留「情绪」字段但界面已由「搜索关键词」承担
- 上传的图片存于 `data/uploads/`

## 部署

任何支持单端口 HTTP 服务的环境均可部署（监听 `PORT` 环境变量，绑定 `0.0.0.0`）。SQLite 随项目运行，无需外部服务。

## 免责声明

本站为玩家自建的非官方索引站，与 Yostar / 米哈游等厂商无隶属关系。图片版权归原作者所有，权利人可通过站内「侵权反馈」页面申请下架。
