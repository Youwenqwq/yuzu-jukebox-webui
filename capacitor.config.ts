import type { CapacitorConfig } from '@capacitor/cli';

// Android 壳：Web 资源走 pnpm build 产物（dist），服务端地址仍由
// public/config.js 的 server 字段（或 App 内用户自选）在运行期决定。
// cleartext 走 AndroidManifest 的 usesCleartextTraffic（v8 平台侧不读
// server.cleartext），允许 http 局域网服务端；纯 https 部署无副作用。
const config: CapacitorConfig = {
  appId: 'dev.uwen.yuzujukebox',
  appName: 'Yuzu Jukebox',
  webDir: 'dist',
  android: {
    // http 服务端时允许 https://localhost 页面加载 http 媒体流/封面
    allowMixedContent: true,
  },
};

export default config;
