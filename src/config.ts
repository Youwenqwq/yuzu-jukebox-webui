/**
 * 服务端基址解析。
 * 默认同源（Pages 部署 + 反代，或 Vite dev proxy）；
 * VITE_YUZU_SERVER 可指向绝对地址跨域直连（服务端已支持 CORS）。
 */

const configured = (import.meta.env.VITE_YUZU_SERVER as string | undefined)?.replace(/\/$/, '');

/** REST/流式端点基址；同源时为空串，直接拼路径即可。 */
export const httpBase: string = configured ?? '';

/** WebSocket 基址（ws/wss），由配置或当前页面推导。 */
export const wsBase: string = configured
  ? configured.replace(/^http/, 'ws')
  : `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
