# Yuzu Jukebox Web

[Yuzu Jukebox](https://github.com/Youwenqwq/yuzu-jukebox)（Go 服务端）的 Web 客户端：聆听、控制、管理。协议以服务端 `docs/spec-v1.md` 为准，本仓为其实现。

## 功能

- 房间聆听：全局同步播放、辉光舞台、同步歌词、Media Session 系统媒体控制
- 房间控制：入队 / 点歌、进度控制、音量
- 大厅实况：在线房间列表，含听众数与当前播放
- 管理：房间建删、电台 / 策略 / 历史、歌单与媒体管理（上传 / 本地媒体 / 缓存 / 凭据扫码）、播放端
- 登录：访客口令（可选）与 OIDC PKCE（组织账号登录）
- 主题：深 / 浅色 + 自定义强调色，可跟随系统；i18n（zh-CN）

## 技术栈

React 19 · Vite 7 · TypeScript（strict）· Tailwind CSS v4 · i18next · radix-ui · vitest

## 开发

```bash
pnpm install   # 注意：pnpm-workspace.yaml 的 allowBuilds: esbuild 必须保留
pnpm dev       # Vite dev，代理 /api /stream /ws → VITE_YUZU_SERVER（默认 127.0.0.1:8080）
pnpm test      # vitest 全量
pnpm build     # tsc -b + vite build
```

需要本地服务端：`~/projects/yuzu-jukebox`（或按 `VITE_YUZU_SERVER` 指向远端）。

## 运行期配置

`public/config.js`（部署后直接编辑，无需重新构建）：

| 字段 | 说明 |
| --- | --- |
| `server` | 服务端基址；留空 = 同源 |
| `oidc_client_id` | PKCE 应用 client_id；留空回退服务端主 id |
| `title` / `favicon` | 网页标题 / 图标 |
| `accent` / `scheme` | 默认主题色 / 深浅色（用户本机选择优先） |
| `admin_password_enabled` | 是否显示访客管理员口令框 |

优先级：`config.js` > 构建期 `VITE_*` > 默认值。

## 架构

```
src/
  protocol/   框架无关协议内核：WS 客户端、校时、房间快照（YuzuClient / ClockSync / SessionStore）
  player/     AudioRenderer、DriftCorrector（对齐基线）、LRC 歌词解析
  api/        REST 客户端
  auth/       TokenStore、OIDC PKCE
  app/        组合根单例：session / player / theme / mediasession
  ui/         React 视图与组件
  i18n/       i18next + zh-CN 文案
```

核心纪律：服务端是唯一权威状态源，UI 只是渲染器；播放位置始终由 `position_ms + updated_at + playing + rate` 推算，不存在本地进度状态。

## 目录

- 协议与对齐行为：服务端仓库 `docs/spec-v1.md`
- 开发约定与踩坑记录：`AGENTS.md`

## License

[AGPL-3.0](LICENSE)
