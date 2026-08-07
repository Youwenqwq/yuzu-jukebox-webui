import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { faviconUrl, pageTitle } from './config';
import './i18n';
import { initBackButton } from './ui/backbutton';
import './styles/tokens.css';

// 品牌运行期配置（config.js）：标题与 favicon
document.title = pageTitle;
document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.href = faviconUrl;

// Android 返回键分发（仅原生壳内生效）
initBackButton();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
