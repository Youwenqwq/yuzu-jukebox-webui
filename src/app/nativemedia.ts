/**
 * 原生（Capacitor）媒体桥：与 app/mediasession.ts 同一契约，目标是
 * Android 前台服务 + 系统 MediaSession。WebView 的 navigator.mediaSession
 * 没有系统出口（锁屏/通知/蓝牙按键），原生端由 YuzuMediaPlugin 承载。
 *
 * 保活语义：房间有当前曲目即启动前台服务，离房/停止即停。
 * 同步语义与 Web 版一致：位置由五元组推算并钳到 [0, duration]，
 * 原生 PlaybackState 带 rate，系统自行插值，无需周期推送。
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { Playback } from '../protocol/types';

/** 与 syncMediaSession 相同的注入约定。onSeek 仅 controller 注入（房间级 seek）。 */
export interface NativeMediaHandlers {
  onPlay?: () => void;
  onPause?: () => void;
  onNextTrack?: () => void;
  onSeek?: (positionMs: number) => void;
}

/** 原生 YuzuMedia 插件的 JS 侧形态（与 @CapacitorPlugin 方法一一对应）。 */
export interface YuzuMediaPluginHandle {
  setMetadata(options: {
    title: string;
    artist: string;
    album: string;
    artworkUrl: string;
    durationMs: number;
  }): Promise<void>;
  setPlaybackState(options: { playing: boolean; positionMs: number; rate: number }): Promise<void>;
  clearSession(): Promise<void>;
  startKeepAlive(): Promise<void>;
  stopKeepAlive(): Promise<void>;
  isIgnoringBatteryOptimizations(): Promise<{ granted: boolean }>;
  requestIgnoreBatteryOptimizations(): Promise<void>;
  addListener(
    eventName: 'action',
    listenerFunc: (event: { action: string; positionMs?: number }) => void,
  ): Promise<PluginListenerHandle>;
}

export interface NativeMediaSync {
  sync(playback: Playback, artworkBase: string, handlers: NativeMediaHandlers): void;
}

/** 可注入插件句柄的工厂：测试用 fake 句柄，生产由模块级单例注入 registerPlugin 结果。 */
export function createNativeMediaSync(plugin: YuzuMediaPluginHandle): NativeMediaSync {
  let handlers: NativeMediaHandlers = {};
  let listenerReady: Promise<unknown> | null = null;
  let keepAlive = false;
  let metadataKey = '';

  const ensureListener = (): void => {
    if (!listenerReady) {
      listenerReady = plugin
        .addListener('action', (event) => {
          const current = handlers;
          if (event.action === 'play') current.onPlay?.();
          else if (event.action === 'pause') current.onPause?.();
          else if (event.action === 'next') current.onNextTrack?.();
          else if (event.action === 'seek' && typeof event.positionMs === 'number') {
            current.onSeek?.(event.positionMs);
          }
        })
        .catch(() => {
          listenerReady = null;
        });
    }
  };

  return {
    sync(playback, artworkBase, next) {
      handlers = next;
      const current = playback.current;

      if (!current) {
        const hadSession = metadataKey !== '' || keepAlive;
        metadataKey = '';
        if (keepAlive) {
          keepAlive = false;
          void plugin.stopKeepAlive().catch(() => {});
        }
        if (hadSession) void plugin.clearSession().catch(() => {});
        return;
      }

      ensureListener();
      if (!keepAlive) {
        keepAlive = true;
        // 启动失败（如后台启动受限）时下一次 sync 重试
        void plugin.startKeepAlive().catch(() => {
          keepAlive = false;
        });
      }

      const artworkUrl = current.cover_url
        ? new URL(current.cover_url, artworkBase || location.origin).href
        : '';
      const key = [
        current.track_ref,
        current.title,
        current.artist,
        current.album,
        artworkUrl,
        current.duration_ms,
      ].join('|');
      if (key !== metadataKey) {
        metadataKey = key;
        void plugin
          .setMetadata({
            title: current.title,
            artist: current.artist,
            album: current.album ?? '',
            artworkUrl,
            durationMs: current.duration_ms,
          })
          .catch(() => {});
      }

      const elapsedMs = playback.playing ? (Date.now() - playback.updated_at) * playback.rate : 0;
      const positionMs = Math.min(
        current.duration_ms,
        Math.max(0, playback.position_ms + elapsedMs),
      );
      void plugin
        .setPlaybackState({ playing: playback.playing, positionMs, rate: playback.rate })
        .catch(() => {});
    },
  };
}

export const isNativeApp: boolean = Capacitor.isNativePlatform();

const pluginHandle = isNativeApp ? registerPlugin<YuzuMediaPluginHandle>('YuzuMedia') : null;
const nativeSync = pluginHandle ? createNativeMediaSync(pluginHandle) : null;

/** 原生端媒体会话同步；非原生平台（浏览器）为 no-op。 */
export function syncNativeMedia(
  playback: Playback,
  artworkBase: string,
  handlers: NativeMediaHandlers,
): void {
  nativeSync?.sync(playback, artworkBase, handlers);
}

/** 电池优化白名单查询；非原生平台视为已豁免。 */
export async function isBatteryOptimizationIgnored(): Promise<boolean> {
  if (!pluginHandle) return true;
  try {
    return (await pluginHandle.isIgnoringBatteryOptimizations()).granted;
  } catch {
    return true; // 查询失败不打扰
  }
}

/** 跳系统电池优化豁免对话框（ROM 不支持时插件侧回退应用详情页）。 */
export async function requestBatteryOptimizationExemption(): Promise<void> {
  await pluginHandle?.requestIgnoreBatteryOptimizations();
}
