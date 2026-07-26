import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// 开发代理：同源部署时 Pages/反代处理，本地 dev 由 Vite 代理到 yuzu-server。
// 用 VITE_YUZU_SERVER 指向任意服务端（服务端已支持 CORS，也可跨域直连）。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const server = env.VITE_YUZU_SERVER || 'http://127.0.0.1:8080';
  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/api': { target: server, changeOrigin: true },
        '/stream': { target: server, changeOrigin: true },
        '/ws': { target: server, ws: true, changeOrigin: true },
      },
    },
  };
});
