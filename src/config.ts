/**
 * 服务端基址解析。优先级：public/config.js（运行期，部署可改）
 * > VITE_* 环境变量（构建期）> 同源默认。
 * config.js 在 index.html 中先于模块脚本执行，此处可直接读全局值。
 */

interface YuzuRuntimeConfig {
  server?: string;
  oidc_client_id?: string;
  title?: string;
  favicon?: string;
  accent?: string;
  scheme?: 'dark' | 'light' | '';
  /** true only when server config.admin_password is non-empty. */
  admin_password_enabled?: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var YUZU_CONFIG: YuzuRuntimeConfig | undefined;
}

const runtime = globalThis.YUZU_CONFIG ?? {};

const configured = (
  runtime.server ||
  (import.meta.env.VITE_YUZU_SERVER as string | undefined) ||
  ''
).replace(/\/$/, '');

/** REST/流式端点基址；同源时为空串，直接拼路径即可。 */
export const httpBase: string = configured;

/** WebSocket 基址（ws/wss），由配置或当前页面推导。 */
export const wsBase: string = configured
  ? configured.replace(/^http/, 'ws')
  : `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;

/** WebUI 的 PKCE 应用 client_id；空串 = 回退服务端 oidcConfig 主 client_id。 */
export const oidcClientId: string =
  runtime.oidc_client_id || (import.meta.env.VITE_YUZU_OIDC_CLIENT_ID as string | undefined) || '';

/** 网页标题（浏览器标签页）。 */
export const pageTitle: string = runtime.title || 'Yuzu Jukebox';

/** favicon 路径；空 = 内置 favicon.svg。 */
export const faviconUrl: string = runtime.favicon || 'favicon.svg';

/** 默认主题色（用户本机选择优先于它）。 */
export const defaultAccent: string = runtime.accent || '#E3B93C';

/** 配置指定的默认深浅色；'' = 跟随系统（用户本机锁定优先）。 */
export const configuredScheme: 'dark' | 'light' | '' = runtime.scheme ?? '';

/**
 * Guest login admin-password field. Must match server `admin_password`:
 * empty server value disables elevation, so the WebUI hides the input.
 */
export const adminPasswordEnabled: boolean = runtime.admin_password_enabled === true;
