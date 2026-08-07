/**
 * Yuzu Jukebox Web 运行期配置（部署后可直接编辑，无需重新构建）。
 * 优先级：本文件 > 构建期 VITE_* 环境变量 > 默认值。
 * 品牌与用户偏好类配置的完整优先级见各项注释。
 *
 * server: 服务端基址。留空 = 同源（Pages + 反代，或 Vite dev proxy）；
 *         跨域直连填绝对地址，如 "https://jukebox-api.example.com"（服务端已支持 CORS）。
 * oidc_client_id: OIDC PKCE 应用 client_id（可选覆盖）。默认留空 = 跟随服务器：
 *         使用当前服务器 /api/v1/auth/oidc/config 返回的主 client_id（App 手动
 *         切服务器后自动跟随新服务器配置）。仅单服务器多应用等场景填写。
 * title: 网页标题（浏览器标签页）。
 * favicon: 图标路径（相对应用根或绝对 URL）；留空 = 内置 favicon.svg。
 * accent: 默认主题色。用户在本机的选择优先（localStorage），本项只是新访客的默认。
 * scheme: 默认深浅色 "dark" | "light"；留空 = 跟随系统。用户本机锁定优先。
 * admin_password_enabled: 是否显示访客登录的管理员口令输入框。
 *         仅当服务端 config.json 的 admin_password 非空时设为 true；
 *         公域 / 口令留空时保持 false，避免展示无效字段。
 */
globalThis.YUZU_CONFIG = {
  server: '',
  oidc_client_id: '',
  title: 'Yuzu Jukebox',
  favicon: '',
  accent: '#6A8FD8',
  scheme: '',
  admin_password_enabled: false,
};
