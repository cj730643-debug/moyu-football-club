# 摸鱼足球俱乐部

V0.2.2 原创足球培养网页游戏。单人模式免注册；好友联机只需要用户名和密码，无需填写邮箱或收取确认邮件。

选六名核心球员，系统补齐十八人球队。安排阵型、培养球员、观看完整二维比赛，十轮后进入青训、交易和下一赛季。单人模式由电脑自动选人、排阵和准备比赛。

V0.2.2 已修复比赛画布与加载提示争用 DOM 导致的黑屏。球场使用独立容器；绘图初始化失败时显示可重试的提示。单人播放不依赖外部脚本。

## 本地运行

使用 Node.js 22.13 或更新版本。

```bash
npm ci
cp .env.example .env.local
```

在 `.env.local` 中配置 `NEXT_PUBLIC_SUPABASE_URL` 和公开的 `NEXT_PUBLIC_SUPABASE_ANON_KEY`，然后运行 `npm run dev`。

单人球队和录像保存在当前浏览器的 IndexedDB 中，可在游戏内导出、导入存档。切换网站域名后需导入原网站导出的存档。联机数据由 Supabase 后端保存。

## GitHub 与 Vercel 部署

将此目录上传到独立的 GitHub 仓库，在 Vercel 导入该仓库的 `main` 分支。`vercel.json` 已指定静态构建方式：

| 设置 | 值 |
| --- | --- |
| Framework Preset | Other |
| Install Command | `npm ci` |
| Build Command | `npm run build:standalone -- dist/index.html` |
| Output Directory | `dist` |
| Node.js | 22.x 或 24.x |

在 Vercel 的 Production 和 Preview 环境分别设置这两项公开变量：

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

构建生成包含游戏代码和样式的 `dist/index.html`。单人游戏直接在浏览器运行；好友联机连接配置的 Supabase。发布 Production 后使用正式域名访问，并检查未登录 Vercel 的访问者能否打开游戏。GitHub 仓库可以保持私有，不影响玩家访问公开的网站。

不要上传 `.env.local`、`.env.integration`、玩家密码或 Service Role Key。现有 Supabase 后端可继续使用，无需为前端迁移清空或重新初始化数据库。

## 检查

```bash
npm run typecheck
npm run lint
npm test
npm run build:standalone -- dist/index.html
```

`npm test` 含 74 项引擎、存档、服务端状态机和录像界面测试。界面回归测试使用 jsdom；它验证 React DOM 挂载、播放控制、Canvas 回退和绘图失败后的重试，不等同于真实浏览器的画面验收。此前验收记录保存在 `reports/acceptance.md`。

## 模块

| 路径 | 职责 |
| --- | --- |
| `app/`、`components/` | 页面、样式、球队管理与录像界面 |
| `game/` | 原创球员、电脑决策、比赛模拟与赛季状态机 |
| `lib/solo.ts`、`lib/solo-store.ts` | 单人赛季、IndexedDB 原子存档和多标签锁 |
| `lib/canvas-replay.ts` | 无需远程资源的 Canvas 2D 播放器 |
| `lib/client.ts` | 用户名登录、单人/联机分流、API 与 Realtime |
| `scripts/build-standalone.mjs` | 生成可部署的静态页面 |
| `supabase/functions/mfc-game/` | 服务端鉴权与游戏入口 |
| `supabase/migrations/` | 正式数据库迁移 |
| `tests/` | 自动回归测试 |

## 联机后台

联机数据位于独立的 `mfc` schema。内部表启用 RLS，普通客户端不能直接读取或写入；隐藏属性和正式比赛结果由服务端维护。客户端通过 `mfc-game` Edge Function 提交操作。写操作使用版本比较、数据库行锁和请求回执，比赛录像锁定后不会重新模拟。

部署到全新的 Supabase 项目时：

1. 创建项目，记录项目引用、项目 URL 和公开 anon key。
2. 用 Supabase CLI 登录并执行 `supabase link --project-ref YOUR_PROJECT_REF`。
3. 按顺序应用 `supabase/migrations/*.sql`，或在全新项目中执行 `supabase db push`。不要重复执行参考文件 `supabase/schema.sql`。
4. 执行 `supabase functions deploy mfc-game`，保留 JWT 校验。
5. 配置前端的两项公开环境变量，使用两个不同的用户名验证创建房间、加入、选秀、准备和比赛结算。

`supabase/qa/migrations/` 是临时验收设施，不用于正式部署。用户名注册由 Edge Function 创建已确认的内部身份，玩家无需提供邮箱。旧邮箱账号仍可在用户名栏输入原邮箱登录。

## 两位玩家开始游戏

1. A 使用用户名和密码注册，创建房间和俱乐部。
2. B 使用另一个用户名注册，输入 A 的六位房间码。
3. 双方按顺序各选六名核心，系统补齐十八人球队。
4. 选择培养路线、阵容和战术，分别确认准备。
5. 观看比赛，或直接查看赛果；双方完成后进入结算与下一轮。

## 引用与许可

比赛引擎参考并复用了 MIT 许可的 `tbleckert/football-simulator`，固定于提交 `39529b19c40868d66aa47db084ebc9ea29c86e70`。LICENSE 与适配说明保存在 `vendor/football-simulator/`。游戏使用原创球员、自定义属性和成长体系。

比赛观看时长固定为6分钟，上下半场各3分钟（暂停和中场休息不计入）。球员头顶显示当前体力槽。比赛锁定时可进入当前比赛，单人模式可结算后继续调整阵容。
