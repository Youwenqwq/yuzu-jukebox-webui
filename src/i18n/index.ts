/**
 * i18n 初始化。当前仅 zh-CN，但所有文案必须经 t()，禁止组件内硬编码字符串。
 * 新增语言 = 新增 catalog + 注册到 resources。
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { zhCN } from './zh-CN';

void i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
  },
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  interpolation: { escapeValue: false },
});

export default i18n;
