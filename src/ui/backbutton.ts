/**
 * Android 返回键统一分发（Capacitor 壳）：覆盖层关闭栈，栈顶先收。
 *
 * 根部语义：音乐 App 按返回 = 退到桌面继续放歌（minimizeApp），
 * 而不是 finish Activity——Activity 销毁即 WebView 销毁，播放随之静默，
 * 前台服务也失去意义。非根页面先走 history 后退（Web 路由习惯）。
 *
 * 浏览器环境完全不装监听器（不接管任何默认行为）。
 */
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

interface OverlayCloser {
  id: string;
  close: () => void;
}

const closers: OverlayCloser[] = [];
let listening = false;

/** 覆盖层打开时压栈（同 id 先出栈再压，幂等）；关闭回调触发后由覆盖层自身出栈。 */
export function pushOverlayCloser(id: string, close: () => void): void {
  removeOverlayCloser(id);
  closers.push({ id, close });
}

export function removeOverlayCloser(id: string): void {
  const index = closers.findIndex((closer) => closer.id === id);
  if (index >= 0) closers.splice(index, 1);
}

/** App 启动时调用一次；重复调用为空转。 */
export function initBackButton(): void {
  if (listening || !Capacitor.isNativePlatform()) return;
  listening = true;
  void App.addListener('backButton', () => {
    const top = closers[closers.length - 1];
    if (top) {
      top.close();
      return;
    }
    if (window.location.pathname !== '/' && window.history.length > 1) {
      window.history.back();
      return;
    }
    void App.minimizeApp();
  });
}
