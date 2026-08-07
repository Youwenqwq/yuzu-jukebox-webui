import type { Playback } from '../protocol/types';

/** 同步系统媒体会话：元数据、播放态、进度、动作处理。动作回调由调用方注入（便于测试与权限控制）。
 *  系统媒体控件的 seek 一律禁用（共享房间治理）：不注册 seekto handler，
 *  进度条仍由 setPositionState 提供但不可拖；房间级 seek 只从 App 内 UI 发起。 */
export function syncMediaSession(
  playback: Playback,
  artworkBase: string,
  handlers: {
    onPlay?: () => void;
    onPause?: () => void;
    onNextTrack?: () => void;
  },
): void {
  if (!('mediaSession' in navigator) || !navigator.mediaSession) {
    return;
  }

  const mediaSession = navigator.mediaSession;
  const current = playback.current;

  mediaSession.metadata = current
    ? new MediaMetadata({
        title: current.title,
        artist: current.artist,
        album: current.album,
        artwork: current.cover_url
          ? [{ src: new URL(current.cover_url, artworkBase || location.origin).href }]
          : [],
      })
    : null;
  mediaSession.playbackState = current
    ? playback.playing ? 'playing' : 'paused'
    : 'none';

  if (typeof mediaSession.setPositionState === 'function') {
    if (current && current.duration_ms > 0 && playback.rate > 0) {
      const elapsedMs = playback.playing ? (Date.now() - playback.updated_at) * playback.rate : 0;
      const duration = current.duration_ms / 1000;
      const position = Math.min(duration, Math.max(0, (playback.position_ms + elapsedMs) / 1000));
      mediaSession.setPositionState({
        duration,
        playbackRate: playback.rate,
        position,
      });
    } else {
      mediaSession.setPositionState();
    }
  }

  if (typeof mediaSession.setActionHandler === 'function') {
    try {
      mediaSession.setActionHandler('play', handlers.onPlay ?? null);
    } catch {
      // Some browsers expose Media Session but not every action.
    }
    try {
      mediaSession.setActionHandler('pause', handlers.onPause ?? null);
    } catch {
      // Some browsers expose Media Session but not every action.
    }
    try {
      mediaSession.setActionHandler('nexttrack', handlers.onNextTrack ?? null);
    } catch {
      // Some browsers expose Media Session but not every action.
    }
  }
}
