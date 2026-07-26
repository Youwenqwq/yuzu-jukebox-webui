# Yuzu Jukebox Web — Agent Guide

[yuzu-jukebox](../yuzu-jukebox)（Go 服务端）的第一个完全体 Web 客户端：聆听 / 控制 / 管理。
协议权威是服务端仓库的 `docs/spec-v1.md`；本仓是其实现（React 19 + Vite 7 + TS strict +
Tailwind v4 + i18next，pnpm 包管理）。

## 架构分层

```
src/
  protocol/    框架无关协议内核：YuzuClient(WS/信封/ref 路由/退避重连)、
               ClockSync(校时)、SessionStore(房间快照，useSyncExternalStore 语义)
  player/      渲染内核：AudioRenderer(<audio> 控制)、DriftCorrector
               (spec §2.2 基线学习状态机)、lyrics.ts(LRC 解析)
  api/         REST 客户端（Bearer、错误码 → YuzuError）
  auth/        TokenStore(sessionStorage)、OIDC PKCE flow
  app/         组合根单例：session.ts(内核装配/身份/断线恢复)、
               player.ts(全局唯一 <audio>+renderer)、theme.ts(主题)、
               mediasession.ts(系统媒体控制)
  ui/          React 视图：Login/Lobby/Room + toast/glow/hooks/format
  i18n/        i18next 初始化 + zh-CN 文案目录
  design/      视觉稿 mockup.html（设计决策的唯一参照）
```

核心纪律：

- **服务端是唯一权威状态源**；UI 是渲染器。播放位置永远由五元组
  `position_ms + updated_at + playing + rate` + 校时 offset 推算，不存在本地进度状态。
- **组合根单例**：`<audio>`、AudioRenderer、YuzuClient、SessionStore 全在 `app/`
  持有。曾发生过的 bug：RoomView 每次挂载新建 audio → 离房后旧实例继续发声、
  重进房双重播放。**任何视图不得自建内核实例**。
- **内核不 import React / i18n**；错误一律 `YuzuError(code, message)`，UI 经
  `ui/errors.ts` 的 `errorKey()` 映射到 i18n 文案。
- **i18n 零硬编码**：所有可见文案必须经 `t()`，新 key 追加到 `i18n/zh-CN.ts`。
  语气：控件说会发生什么；错误不道歉；空态是邀请。
- **requester 名字解析**：条目自带 `requester_name` 快照优先（服务端 G2），
  缺省查 listeners 表，最后回退身份 ID。

## 主题系统（三条正交轴）

1. `scheme`：深/浅基底色板，`<html data-scheme>` 切换，localStorage `yuzu-scheme`
   锁定，默认跟随系统；index.html 有首帧前内联脚本防刷白。
2. `accent`：用户主题色，只写 `--accent`，派生靠 `color-mix`，`--on-accent`
   按 YIQ 亮度计算（`app/theme.ts`），localStorage `yuzu-accent`。
3. `glow`：封面取色（`ui/glow.ts`），只作用于舞台辉光，与前两轴物理隔离。

Tailwind v4 经 `@theme inline` 映射 token（bg-hall/text-paper/text-muted/text-faint/
bg-accent/text-on-accent 等），改配色只动 `styles/tokens.css`。

## 开发

```bash
pnpm install        # 注意：pnpm-workspace.yaml 的 allowBuilds: esbuild 必须保留
pnpm dev            # Vite dev，代理 /api /stream /ws → VITE_YUZU_SERVER(默认 127.0.0.1:8080)
pnpm test           # vitest 全量
pnpm build          # tsc -b + vite build
```

环境坑（本机）：

- 存在 http 代理，curl 本机服务要 `--noproxy '*'` 或用 `server-addr:8080`。
- pnpm 11 的构建白名单在 `pnpm-workspace.yaml`（`allowBuilds`），不在 package.json。
- REST 响应均为包装对象：`{rooms:[...]}` `{tracks:[...]}` `{providers:[...]}`——
  不是裸数组（曾误读 jq 报错把 listRooms 改错，已回滚）。
- `httpBase` 同源部署时是空串：凡需要绝对 URL 的场景（`new URL(path, base)`、
  Media Session artwork 等）必须 `base || location.origin` 回退。

## 测试约定

- 内核测试注入依赖：TransportLike（WS）、fetchFn、Storage、手写 fake audio 表面。
- DriftCorrector 每个 spec §2.2 细则至少一个用例（基线学习/纠正 seek 含 baseline/
  换曲目清零/paused 无意图等），改对齐逻辑先读 spec。
- UI 视图测试非默认；行为契约在内核层覆盖。

## 路线图状态

- [x] Phase A 收听体验：辉光、同步歌词（共用 should_be 时钟）、Media Session、
      Toast 系统、大厅实况（服务端 G1: rooms 带 listener_count/now_playing）
- [ ] Phase B 队列增强：queue.move 拖拽（admin）、批量入队 UI（内核 batch 已就绪）
- [x] Phase C 管理界面：radix-ui primitives（未引 shadcn，见其下）——房间内
      电台/策略/历史、大厅房间建删、/admin 歌单/媒体（上传/本地媒体管理/缓存/凭据扫码）/
      播放端；服务端配套：GET/DELETE /api/v1/media
- [ ] Phase D OIDC 登录 UI（PKCE 内核就绪，等 IdP 的 PKCE 应用）+ Pages 部署

## 服务端协同

服务端仓库 `~/projects/yuzu-jukebox` 由独立维护批次演进（spec 先行，非破坏性扩展）。
已完成：批量 queue.add（原子，ack 回 entry_ids）、playlist item move、
OIDC 多 audience（extra_client_ids）、rooms 实况摘要、requester_name 快照。
IdP 侧待办：新增 PKCE(User-Agent)应用 → 其 client_id 加入服务端
`oidc.extra_client_ids`；roles 进 ID token 用 Application 级 Token Settings
或 scope `urn:zitadel:iam:org:projects:roles`。
