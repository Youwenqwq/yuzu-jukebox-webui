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
  auth/        TokenStore(localStorage 跨标签共享)、OIDC PKCE flow
  app/         组合根单例：session.ts(内核装配/身份/断线恢复)、
               player.ts(全局唯一 <audio>+renderer)、theme.ts(主题)、
               mediasession.ts(系统媒体控制)
  ui/          React 视图：Login + 播放器外壳（AppShell=登录后常驻骨架，
               shell/PlayerBar 底部栏、shell/RoomSwitcher 房间切换弹窗、
               shell/QueueDrawer 队列抽屉、shell/RadioPanel 电台面板；
               页面=Home 漫游/Search/PlaylistDetail/RoomDeepLink）+ admin/
  i18n/        i18next 初始化 + zh-CN 文案目录
  design/      视觉稿 mockup.html（设计决策的唯一参照）
```

交互架构（Phase E 起）：**登录后着陆 = 播放器外壳**，房间是状态而非页面——
底部栏右侧的房间切换弹窗（Spotify 设备菜单的对应物）承担换房；自动入房
（localStorage `yuzu-last-room` → 唯一房间 → 未入房空态）；`/r/:id` 深链
（兼容旧 `/room/:id`）只承担「切房」动作。房间治理（建删/策略/授权/输出/历史）
集中在 /admin「房间」tab；电台开停留在播放器侧（队列抽屉 RadioPanel）。
播放接线（renderer.render/Media Session/自动播放解锁/canControl 查询）常驻
AppShell，页面切换不影响出声。

核心纪律：

- **服务端是唯一权威状态源**；UI 是渲染器。播放位置永远由五元组
  `position_ms + updated_at + playing + rate` + 校时 offset 推算，不存在本地进度状态。
- **`position_ms` 可以为负**（切歌起播提前量，房间 policy `start_lead_ms`，默认 600ms）：
  `should_be < 0` = 本曲还有 `|should_be|` ms 才开播，此时 `playing` 已经是 true——
  **判断是否该出声只看 should_be 的正负，不看 `playing`**。AudioRenderer 在窗口内装载并
  停在 0 待命、用 setTimeout 到点 play()（新状态/离房一律 cancel），DriftCorrector 在窗口内
  既不 seek 也不学基线；所有渲染点（进度条/时间文本/歌词/大厅 now_playing）钳到 0。
- **对齐是纯 seek，不调速**（spec §2.2/§9.2，与 yuzu-agent 一致）：`|偏差| > 150ms` →
  seek 到 `should_be + drift_baseline`（基线随即作废重学），`≤ 150ms` 不动。
  变速会改变音高与听感，代价高于一次跳转——`playbackRate` 不参与同步，
  `PlayerIntent` 只有 seek 一种。
- **房间 policy 是整体替换**：`PATCH /rooms/{id}` 的 `policy` 覆盖整块
  `rooms.policy_json`，而 WebUI 只认识其中一个子集。保存必须以本次从服务端读到的
  policy 为基底、只写表单拥有的键（`api/policy.ts` 的 `mergeRoomPolicy`）——
  曾经的 bug：RoomAdminPanel 重建整个对象提交，管理员点一次保存就把 `start_lead_ms`
  抹回缺省。新增服务端 policy 字段不需要动 UI。
- **组合根单例**：`<audio>`、AudioRenderer、YuzuClient、SessionStore 全在 `app/`
  持有。曾发生过的 bug：RoomView 每次挂载新建 audio → 离房后旧实例继续发声、
  重进房双重播放。**任何视图不得自建内核实例**。
- **App 根部组成不可丢**：ToastProvider 包裹 login/router 全树（曾重写 App 时误删导致
  全线 useToast 崩溃）；OIDC 回调识别、boot 阶段、identity 置空回登录页也在根部。
- **覆盖层必须 portal 到 body**：任何 `fixed` 全屏层（FullscreenPlayer、Dialog）走
  createPortal/radix Portal——祖先的 transform/filter/位移动画会把 fixed 劫持为相对
  该祖先定位（曾在 view-enter 动画加入后全屏播放页被压缩到页面高度）。
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

## Android 壳（Capacitor v8）

Web 资源打包进 `android/`（`webDir: dist`），applicationId `dev.uwen.yuzujukebox`。
存在理由只有一个：**前台服务保活**——浏览器 tab 会被 OEM 省电杀掉，WebView 没有
前台服务一样被杀。浏览器与 App 是同一份代码，原生能力全部按 `isNativeApp`
（`app/nativemedia.ts`）运行时探测，不得出现分支专属实现。

- `android/.../YuzuMediaPlugin.java` + `MediaSessionManager.java` +
  `YuzuPlaybackService.java`：mediaPlayback 前台服务 + 系统 MediaSession +
  MediaStyle 通知 + 播放期 partial wake lock。WebView 的
  `navigator.mediaSession` 没有系统出口（锁屏/蓝牙按键），所以原生端重做一份，
  JS 契约与 `app/mediasession.ts` 相同（`app/nativemedia.ts`，shell/state.ts 双写）。
- 保活语义：房间有当前曲目即起服务，离房/停止即停；唤醒锁只在 playing 时持有。
- **Capacitor 桥数值读取坑**：`PluginCall.getLong()` 只接受 org.json 解析为 `Long`
  的值——JS 侧 int 范围的数字（positionMs/durationMs 这类几万~几十万）会被 JSONObject
  存成 `Integer`，`getLong` 静默回退默认值 0。曾导致 PlaybackState position 与
  metadata DURATION 恒为 0、锁屏/通知进度条整体缺失（根因不在 JS）。数值一律按
  `getData().opt(name)` 的 `Number` 提取（见 `YuzuMediaPlugin.numberAsLong`）。
- 进度条插值依赖推送基准：ColorOS 对 PlaybackState 插值
  （`position + (now - updateTime) * speed`），但位置推算**必须用 ClockSync
  的 serverNow**（与 UI 同钟）——裸 `Date.now()` 会引入设备/服务器时钟偏差
  （真机实测 +235ms），锁屏歌词/进度随之整体偏移。**start_lead 负窗口原样保留**
  （只钳上限 duration）：切歌瞬间 position 为负，系统歌词无当前行，到 0 才起播，
  与音频对齐；钳 0 会让歌词整首领先 start_lead。1s tick（`nativemedia.tick`）
  持续用 serverNow 刷新 PlaybackState 以抵消时钟漂移，暂停态不推。
- **系统媒体控件 seek 已禁用**（共享房间治理）：PlaybackState 不设
  `ACTION_SEEK_TO`（通知栏进度条仍显示但只读，真机实测），且 `onSeekTo` 忽略
  （`TransportControls.seekTo` 不校验 actions，去 SEEK_TO 只挡通知栏 UI，锁屏
  仍可拖拽触发 seek 命令，必须在回调层拦截），`dispatchSeek` 已删。房间级 seek
  只能从 App 内 UI（`roomStore.seek`）发起，防低注意力场景误触改全房间进度。
  同步单例在 `app/session.ts` 组装（`nativeMediaSync`，注入
  `client.clock.serverNow`），浏览器为 null。
- **锁屏歌词（ColorOS 16+ lyricInfo 协议）**：歌词以 JSON 字符串挂
  `MediaMetadata` 的 `lyricInfo` 键（`{songName,artist,songId,lyric,translationLyric?}`，
  `lyric` 为带时间戳的原始 LRC 原文），系统管线渲染，播放进度由 PlaybackState 提供。
  实现见 `app/nativelyrics.ts`（state.ts 组装单例，订阅 roomStore 曲目变化）：
  **事件驱动，每首歌最多 2 次**——切歌先推 null 清旧词，歌词就绪推完整 payload，
  800ms 后幂等补交一次（防抖窗口可能吞首次提交）；勿周期推送、勿写 TITLE/ARTIST
  身份字段、勿把当前歌词行写进 lyricInfo。歌词源 = 服务端 `GET /api/v1/lyrics`
  的 `lrc`/`tlrc` 原始字符串（不经过 parseLrc 合并）。
  **媒体卡片单行歌词已通；全屏/沉浸歌词入口不可达**（真机 ColorOS 16.1 反编译
  SystemUI 确认）：入口由 `MediaActionPrioritySelector.getLyricEntrance(pkg)` 按
  **包名白名单**（`oplusActionConfig` 内置 + OPPO RUS 云控 `RUS_LYRIC_ENTRANCE_KEY`）
  发放，标准 MediaSession API 无任何请求机制，非 Root/LSPosed 无解（原项目
  ColorOS-Live-Lyrics-Bridge 正是 hook 该方法强制返回 52）。勿再尝试系统侧全屏。
- `ui/backbutton.ts`：返回键统一分发——覆盖层关闭栈栈顶先收，非根页面 history
  后退，根部 minimizeApp（**不能 finish Activity**：Activity 销毁 = WebView 销毁 =
  停止出声）。
- 服务端地址：原生平台 localStorage `yuzu-server`（App 内登录页/账户菜单可改）
  > config.js > VITE_*；改地址会清 `yuzu-session`/`yuzu-room-credentials`/
  `yuzu-last-room` 并 reload。cleartext 走 manifest `usesCleartextTraffic`
  （v8 平台不读 `server.cleartext` 配置项），`android.allowMixedContent` 允许
  https 壳加载 http 流。
```bash
pnpm build && npx cap sync android          # Web 产物 → android assets
cd android && ./gradlew assembleDebug       # 需 ANDROID_HOME 或 local.properties sdk.dir
```

- 部署前提：服务端 config 开启 `cors.enabled` 且 `allowed_origins` 含
`https://localhost`（Capacitor 壳的 origin；WS 已放开 OriginPatterns *）。
真机安装：`adb install android/app/build/outputs/apk/debug/app-debug.apk`。

## 测试约定

- 内核测试注入依赖：TransportLike（WS）、fetchFn、Storage、手写 fake audio 表面。
- DriftCorrector 每个 spec §2.2 细则至少一个用例（基线学习/纠正 seek 含 baseline/
  换曲目清零/paused 无意图等），改对齐逻辑先读 spec。
- UI 视图测试非默认；行为契约在内核层覆盖。

## 路线图状态

- [x] Phase A 收听体验：辉光、同步歌词（共用 should_be 时钟）、Media Session、
      Toast 系统、大厅实况（服务端 G1: rooms 带 listener_count/now_playing）
- [X] Phase B 队列增强：queue.move 拖拽（admin）、批量入队 UI（内核 batch 已就绪）
- [x] Phase C 管理界面：radix-ui primitives（未引 shadcn，见其下）——房间内
      电台/策略/历史、大厅房间建删、/admin 歌单/媒体（上传/本地媒体管理/缓存/凭据扫码）/
      播放端；服务端配套：GET/DELETE /api/v1/media
- [x] Phase D OIDC 登录 UI（部署由用户自理）：登录页「使用组织账号登录」
      （服务端 OIDC 启用时出现）、PKCE 回调在 App 启动时识别（redirect_uri = 应用根，
      code/state 落在 location.search）、请求携带 Zitadel roles scope、大厅身份区退出登录
- [x] Phase E 播放器外壳重构：大厅陈列页/房间页 → 常驻外壳（侧导航+底部播放栏+
      队列抽屉），房间降级为设备式切换弹窗；首页漫游（一键电台卡/歌单浏览/
      本房热门 stats/最近播放 history）；房间治理迁入 /admin；推荐 feed 与
      非 controller 开电台为占位符，等后端端点（见服务端 TODO「WebUI 漫游体验配套」）

## 服务端协同

服务端仓库 `~/projects/yuzu-jukebox` 由独立维护批次演进（spec 先行，非破坏性扩展）。
已完成：批量 queue.add（原子，ack 回 entry_ids）、playlist item move、
OIDC 多 audience（extra_client_ids）、rooms 实况摘要、requester_name 快照。
IdP 侧待办：新增 PKCE(User-Agent)应用 → 其 client_id 加入服务端
`oidc.extra_client_ids`；roles 进 ID token 用 Application 级 Token Settings
或 scope `urn:zitadel:iam:org:projects:roles`（WebUI 授权请求已自动携带后者）。
WebUI 侧配置：`public/config.js`（运行期，部署后可直接编辑无需重建）——
`server` 服务端基址（空 = 同源）、`oidc_client_id` PKCE 应用 id（空 = 回退服务端
oidcConfig 主 id）、`title` 网页标题、`favicon` 图标（空 = 内置 favicon.svg）、
`accent` 默认主题色、`scheme` 默认深浅色（空 = 跟随系统）、
`admin_password_enabled` 是否显示访客管理员口令框（仅当服务端
`admin_password` 非空时为 true；公域留空则 false）。
优先级：server/oidc/admin_password_enabled 为（原生平台 localStorage `yuzu-server` 用户自选 >）
config.js > VITE_* > 默认；
accent/scheme 为用户本机选择（localStorage）> config.js > 内置默认。
redirect_uri 平台相关：Web = 应用根（无路径无 hash）；原生平台（Capacitor）
= 自定义 scheme `yuzu-jukebox://oauth`（manifest VIEW intent-filter，singleTask
onNewIntent → App 插件 `appUrlOpen` 事件 → App.tsx 处理；授权页经
`@capacitor/browser` Custom Tab 打开，与系统浏览器共享 SSO cookie）。
**IdP 应用白名单需同时登记两个 redirect_uri**。scheme 改动后 `cap sync`
会重写 manifest 的 Capacitor 段，但 MainActivity 的 intent-filter 是手写的，
不要被覆盖。
