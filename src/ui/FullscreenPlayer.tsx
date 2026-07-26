import { useEffect, useReducer, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { roomStore, client } from '../app/session';
import type { Playback } from '../protocol/types';
import type { LyricLine } from '../player/lyrics';
import { activeLineIndex } from '../player/lyrics';
import { extractGlowColors } from './glow';
import { LyricsPanel } from './LyricsPanel';
import { VolumeControl } from './VolumeControl';
import { formatClock, formatMs } from './format';

type NameOf = (id: string, snapshot?: string) => string;

/**
 * 全屏沉浸播放页（Apple Music 式）：整幅辉光背景、左列封面与操控、右列歌词。
 * 仅在有当前曲目时可进入；ESC 或右上角关闭。
 */
export function FullscreenPlayer(props: {
  playback: Playback;
  canControl: boolean;
  nameOf: NameOf;
  lines: LyricLine[] | null;
  lyricsLoading: boolean;
  onClose: () => void;
}): JSX.Element {
  const { playback, canControl, nameOf, lines, lyricsLoading, onClose } = props;
  const { t } = useTranslation();
  const current = playback.current!; // 挂载方保证 current 非空

  const [, forceTick] = useReducer((x: number) => x + 1, 0);
  const [glow, setGlow] = useState<[string, string] | null>(null);

  // 进度/歌词高亮 1s 重算；ESC 关闭；打开期间锁定背景滚动
  useEffect(() => {
    const id = setInterval(forceTick, 1000);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      clearInterval(id);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const pos = Math.max(
    0,
    Math.min(
      playback.playing
        ? playback.position_ms + (client.clock.serverNow() - playback.updated_at) * playback.rate
        : playback.position_ms,
      current.duration_ms,
    ),
  );

  // portal 到 body：任何祖先的 transform/filter/动画都不能影响 fixed 覆盖定位
  return createPortal(
    <div className="fixed inset-0 z-50 bg-hall overflow-y-auto">
      {/* 整幅辉光背景：比舞台更强的存在感，主色取自封面 */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(55% 60% at 30% 40%, ${glow?.[0] ?? '#6B5326'} 0%, transparent 72%), radial-gradient(50% 55% at 75% 65%, ${glow?.[1] ?? '#2E4258'} 0%, transparent 72%)`,
          opacity: 'calc(var(--glow-opacity) + 0.15)',
          filter: 'blur(80px)',
          transition: 'background 600ms ease',
        }}
      />

      <button
        onClick={onClose}
        title={t('room.closePlayer')}
        className="fixed top-5 right-6 z-10 w-9 h-9 grid place-items-center rounded-full border border-hairline text-muted hover:text-paper hover:border-faint bg-hall/60"
      >
        ×
      </button>

      <div className="relative min-h-full max-w-6xl mx-auto px-8 py-14 grid gap-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] items-center">
        {/* 左列：封面 + 曲目信息 + 操控 */}
        <div className="max-w-md w-full mx-auto">
          {current.cover_url ? (
            <img
              src={current.cover_url}
              alt=""
              onLoad={(e) => {
                const colors = extractGlowColors(e.currentTarget);
                if (colors) setGlow(colors);
              }}
              className="w-full aspect-square rounded-xl object-cover"
              style={{ boxShadow: 'var(--cover-shadow)' }}
            />
          ) : (
            <div className="w-full aspect-square rounded-xl bg-panel-2" />
          )}

          <h2 className="font-display text-3xl font-semibold leading-tight mt-7">{current.title}</h2>
          <div className="text-muted mt-1.5">
            {current.artist}
            {current.album && <span className="text-faint"> · {current.album}</span>}
          </div>
          <div className="text-faint text-xs mt-2">
            {t('room.requestedBy', {
              name: nameOf(current.requested_by, current.requester_name),
              time: formatClock(current.added_at),
            })}
          </div>

          <div
            className="h-[3px] rounded bg-[var(--rail)] overflow-hidden cursor-pointer mt-6"
            onClick={(e) => {
              if (!canControl || current.duration_ms <= 0) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = (e.clientX - rect.left) / rect.width;
              void roomStore.seek(Math.round(ratio * current.duration_ms)).catch(() => {});
            }}
          >
            <div
              className="progress-glide h-full bg-accent rounded"
              style={{ width: `${current.duration_ms > 0 ? (pos / current.duration_ms) * 100 : 0}%` }}
            />
          </div>
          <div className="flex justify-between font-mono text-[11.5px] text-muted mt-1.5 tabular-nums">
            <span>{formatMs(pos)}</span>
            <span>{formatMs(current.duration_ms)}</span>
          </div>

          <div className="flex items-center gap-2 mt-5">
            {canControl && (
              <>
                <button
                  title={playback.playing ? t('room.pause') : t('room.resume')}
                  onClick={() => void (playback.playing ? roomStore.pause() : roomStore.resume()).catch(() => {})}
                  className="w-10 h-10 grid place-items-center rounded-full border border-hairline text-paper hover:border-faint"
                >
                  {playback.playing ? '⏸' : '▶'}
                </button>
                <button
                  title={t('room.skip')}
                  onClick={() => void roomStore.skip().catch(() => {})}
                  className="w-10 h-10 grid place-items-center rounded-full border border-hairline text-paper hover:border-faint"
                >
                  ⏭
                </button>
              </>
            )}
            <VolumeControl className="ml-2" />
          </div>
        </div>

        {/* 右列：歌词 */}
        <div className="h-[68vh] max-lg:h-[50vh]">
          {lyricsLoading || lines === null ? (
            <p className="text-faint text-sm text-center pt-24">{t('lyrics.loading')}</p>
          ) : (
            <LyricsPanel lines={lines} activeIndex={activeLineIndex(lines, pos)} emptyText={t('lyrics.unavailable')} large />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
