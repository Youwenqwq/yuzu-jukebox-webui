/**
 * 原生（Capacitor）媒体桥：与 app/mediasession.ts 同一契约，目标是
 * Android 前台服务 + 系统 MediaSession。WebView 的 navigator.mediaSession
 * 没有系统出口（锁屏/通知/蓝牙按键），原生端由 YuzuMediaPlugin 承载。
 *
 * 保活语义：房间有当前曲目即启动前台服务，离房/停止即停。
 * 同步语义与 Web 版一致：位置由五元组推算。时钟用 ClockSync 的服务端时间
 * （serverNow），与 UI 同一基准——裸 Date.now 会引入设备/服务器时钟偏差
 * （真机实测 +235ms），锁屏歌词随之整体偏移。负窗口（start_lead，position_ms
 * 为负）原样保留：曲目未起播时系统歌词无当前行，到 0 才出现，与音频对齐；
 * 只钳上限 duration。原生 PlaybackState 带 rate 由系统插值，另加 1s tick
 * 持续用 serverNow 修正时钟漂移。
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { Playback } from '../protocol/types';

/** 与 syncMediaSession 相同的注入约定。系统媒体控件的 seek 已禁用（共享房间
 *  治理，原生 onSeekTo 忽略、Web 不注册 seekto），无 onSeek 回调。 */
export interface NativeMediaHandlers {
  onPlay?: () => void;
  onPause?: () => void;
  onNextTrack?: () => void;
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
  setLyricInfo(options: { lyricInfo: string | null }): Promise<void>;
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
  /** 播放期周期位置修正：ColorOS 对 PlaybackState 插值，但推送基准必须随
   *  serverNow 持续刷新以抵消时钟漂移；暂停态不推（位置本就冻结）。 */
  tick(playback: Playback): void;
}

/** 可注入插件句柄与时钟的工厂：测试用 fake 句柄与可控 now，生产由模块级
 *  单例注入 registerPlugin 结果与 client.clock.serverNow（服务端时间基准）。 */
export function createNativeMediaSync(
  plugin: YuzuMediaPluginHandle,
  now: () => number = Date.now,
): NativeMediaSync {
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

      const elapsedMs = playback.playing ? (now() - playback.updated_at) * playback.rate : 0;
      // 只钳上限：start_lead 负窗口原样保留，系统歌词在负位置无当前行，
      // 到 0 才起播——与音频起播点对齐（钳 0 会让歌词整首领先 start_lead）。
      const positionMs = Math.min(current.duration_ms, playback.position_ms + elapsedMs);
      void plugin
        .setPlaybackState({ playing: playback.playing, positionMs, rate: playback.rate })
        .catch(() => {});
    },

    tick(playback) {
      const current = playback.current;
      if (!current || !playback.playing) return;
      const elapsedMs = (now() - playback.updated_at) * playback.rate;
      const positionMs = Math.min(current.duration_ms, playback.position_ms + elapsedMs);
      void plugin
        .setPlaybackState({ playing: true, positionMs, rate: playback.rate })
        .catch(() => {});
    },
  };
}

export const isNativeApp: boolean = Capacitor.isNativePlatform();

const pluginHandle = isNativeApp ? registerPlugin<YuzuMediaPluginHandle>('YuzuMedia') : null;

/** 原生 YuzuMedia 插件句柄（媒体桥与歌词桥共用同一注册，勿重复 registerPlugin）。 */
export const yuzuMediaPlugin = pluginHandle;

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
