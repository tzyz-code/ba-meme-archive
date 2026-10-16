# ba表情档案 · BA Meme Archive

蔚蓝档案表情包一站式检索站 —— 玩家共建的表情包档案馆：上传即归档，按角色、关键词、档案编号快速检索。

## 功能

- **检索**：多字段搜索（标题 / 角色中英文名 / 关键词 / 编号），权重排序（蔚蓝档案优先 ×3.3 权重）
- **上传入库**：拖拽上传 → 填角色名/IP/关键词 → 确认弹窗 → 入库（无 AI 识图，上传秒传）
- **角色目录**：出现即建目录；新角色自动从 kivo.wiki / 维基百科抓取头像，失败可手动补传（仅限无头图角色）
- **编辑档案**：上传后仅管理员可编辑（口令验证）；角色名/IP/角色/关键词可改
- **SEO**：每张档案独立 SSR 详情页（`/meme/:code`），含 JSON-LD ImageObject、og 标签、sitemap.xml / robots.txt
- **移动端适配**：响应式布局，手机可用

## 技术栈

- 后端：Node.js（Express），数据存 **WorkBuddy 云服务 PostgreSQL**（`@tencent-ai/workbuddy-cloud-sdk`）
- 图片：**腾讯云 COS**（对象存储，匿名可读）
- 前端：原生 HTML / CSS / JS（无框架、无构建）
- 依赖：`express`、`multer`、`@tencent-ai/workbuddy-cloud-sdk`、`cos-nodejs-sdk-v5`

## 快速开始

```bash
npm install
npm start      # http://localhost:3000
```

前置条件：

1. **云数据库**：项目需先在工作区激活 WorkBuddy 云服务（`workbuddy_cloud_service`），
   云库 schema（ips/characters/emotions/memes 表 + RLS 策略）由云服务管理面初始化。
2. **图片存储**：在项目 `data/cos-config.json` 填入腾讯云 COS 凭证：

```json
{
  "SecretId": "AKID...",
  "SecretKey": "...",
  "Bucket": "your-bucket-1250000000",
  "Region": "ap-shanghai"
}
```

（`data/` 已 gitignore，凭证不会进仓库；未配置时图片回退本地 `data/uploads/`，仅供本地开发）

## 目录结构

```
├── server.js          # Express 后端（API + SSR 详情页 + sitemap/robots）
├── cloud-db.js        # 云数据库访问层（封装 SDK 的 CRUD / 建档 / 管理员更新 RPC）
├── lib/
│   ├── storage.js     # 图片存储（COS 优先，本地兜底）
│   └── avatar.js      # 新角色头像自动获取（kivo.wiki / 维基百科）
├── public/            # 前端静态资源
│   ├── index.html     # 档案大厅
│   ├── search.html    # 搜索页
│   ├── detail.html    # 详情页（前端版，canonical 指向 SSR）
│   ├── upload.html    # 上传入库
│   ├── report.html    # 侵权反馈
│   └── assets/        # 设计令牌、组件样式、JS 数据层
├── docs/              # kivo.wiki 学生头像 sitemap（头像匹配索引用）
└── data/              # 运行时数据（gitignore：COS 配置、uploads 缓存）
```

## 数据说明

- 档案记录（IP/角色/情绪/表情）存于 **WorkBuddy 云数据库**，跨部署持久
- 图片（表情图 / 新角色头像）存于 **腾讯云 COS**，公开可读
- 数据层保留「情绪」字段但界面已由「搜索关键词」承担
- 管理员口令：上传后编辑需口令（`server.js` 的 `ADMIN_KEY`，默认 2648965787）

## 部署

任何支持单端口 HTTP 服务的环境均可部署（监听 `PORT` 环境变量，绑定 `0.0.0.0`）。
发布到 WorkBuddy「发布为应用」时复用同一 applicationId，保持域名与云服务 Origin 不变。

## 免责声明

本站为玩家自建的非官方索引站，与 Yostar / 米哈游等厂商无隶属关系。图片版权归原作者所有，权利人可通过站内「侵权反馈」页面申请下架。
