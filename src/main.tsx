import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { faviconUrl, pageTitle } from './config';
import './i18n';
import './styles/tokens.css';

// 品牌运行期配置（config.js）：标题与 favicon
document.title = pageTitle;
document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.href = faviconUrl;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
