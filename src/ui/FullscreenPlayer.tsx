import { useEffect, useReducer, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Pause, Play, X } from 'lucide-react';
import { client } from '../app/session';
import { audio, renderer } from '../app/player';
import type { Playback } from '../protocol/types';
import type { LyricLine } from '../player/lyrics';
import { activeLineIndex } from '../player/lyrics';
import { extractGlowColors } from './glow';
import { pushOverlayCloser, removeOverlayCloser } from './backbutton';
import { LyricsPanel } from './LyricsPanel';
import { formatClock, formatMs } from './format';

type NameOf = (id: string, snapshot?: string) => string;

/**
 * 全屏沉浸播放页：整幅辉光背景 + 封面/歌词。
 * 桌面两列（左封面信息 + 右歌词）；移动端单视图切换——点击封面歌词淡入、
 * 再点歌词封面淡入（crossfade）。个人收听视图：房间级控制在房间面板。
 */
export function FullscreenPlayer(props: {
  playback: Playback;
  nameOf: NameOf;
  lines: LyricLine[] | null;
  lyricsLoading: boolean;
  onClose: () => void;
}): JSX.Element {
  const { playback, nameOf, lines, lyricsLoading, onClose } = props;
  const { t } = useTranslation();
  const current = playback.current!; // 挂载方保证 current 非空

  const [, forceTick] = useReducer((x: number) => x + 1, 0);
  const [glow, setGlow] = useState<[string, string] | null>(null);
  // 移动端视图：封面 ↔ 歌词（点击切换）
  const [view, setView] = useState<'cover' | 'lyrics'>('cover');

  // 进度/歌词高亮 1s 重算；ESC 关闭；打开期间锁定背景滚动；压入返回键栈
  useEffect(() => {
    const id = setInterval(forceTick, 1000);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    pushOverlayCloser('fullscreen-player', onClose);
    return () => {
      clearInterval(id);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      removeOverlayCloser('fullscreen-player');
    };
  }, [onClose]);

  // 起播提前量窗口内推算值为负（本曲还没开始）：钳到 0 再拿去渲染进度条/时间/歌词。
  // 个人暂停时显示本地停住位置（房间仍在播）。
  const personalPaused = renderer.isPersonalPaused;
  const shouldBe = playback.playing
    ? playback.position_ms + (client.clock.serverNow() - playback.updated_at) * playback.rate
    : playback.position_ms;
  const pos = Math.max(
    0,
    Math.min(personalPaused ? audio.currentTime * 1_000 : shouldBe, current.duration_ms),
  );

  const grabGlow = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const colors = extractGlowColors(e.currentTarget);
    if (colors) setGlow(colors);
  };

  const lyricsBlock = (
    <>
      {lyricsLoading || lines === null ? (
        <p className="text-faint text-sm text-center pt-24">{t('lyrics.loading')}</p>
      ) : (
        <LyricsPanel lines={lines} activeIndex={activeLineIndex(lines, pos)} emptyText={t('lyrics.unavailable')} large />
      )}
    </>
  );

  const progressBlock = (
    <>
      <div className="h-[3px] rounded bg-[var(--rail)] overflow-hidden">
        <div
          className="progress-glide h-full bg-accent rounded"
          style={{ width: `${current.duration_ms > 0 ? (pos / current.duration_ms) * 100 : 0}%` }}
        />
      </div>
      <div className="flex justify-between font-mono text-[11.5px] text-muted mt-1.5 tabular-nums">
        <span>{formatMs(pos)}</span>
        <span>{formatMs(current.duration_ms)}</span>
      </div>
      {personalPaused && <p className="mt-2 text-[11px] text-faint">{t('room.personalPausedHint')}</p>}
    </>
  );

  // portal 到 body：任何祖先的 transform/filter/动画都不能影响 fixed 覆盖定位
  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-hall">
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
        className="fixed top-[calc(env(safe-area-inset-top)+1.25rem)] right-[calc(env(safe-area-inset-right)+1.5rem)] z-10 grid h-9 w-9 place-items-center rounded-full border border-hairline text-muted after:absolute after:-inset-1 after:content-[''] hover:border-faint hover:text-paper bg-hall/60"
      >
        <X className="h-4 w-4" />
      </button>

      {/* 移动端：封面/歌词单视图切换（crossfade，点击互切）。
          封面在大区上下居中，歌曲信息与进度条贴底部；歌词同样居中。
          容器撑满视口——fixed 覆盖层上没有外部元素占用，不留底部空隙。 */}
      <div className="relative mx-auto h-dvh max-w-md px-6 landscape:max-w-2xl lg:hidden">
        <div
          role="button"
          tabIndex={0}
          aria-label={t('room.showLyrics')}
          onClick={() => setView('lyrics')}
          onKeyDown={(e) => {
            // 内嵌控件（个人暂停钮）的按键不上冒为整区切换
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setView('lyrics');
            }
          }}
          className={`absolute inset-0 flex flex-col text-center transition-opacity duration-300 landscape:flex-row landscape:items-center landscape:gap-8 ${
            view === 'cover' ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
            {current.cover_url ? (
              <img
                src={current.cover_url}
                alt=""
                onLoad={grabGlow}
                className="w-56 aspect-square rounded-xl object-cover landscape:w-32 sm:w-64 sm:landscape:w-40"
                style={{ boxShadow: 'var(--cover-shadow)' }}
              />
            ) : (
              <div className="w-56 aspect-square rounded-xl bg-panel-2 landscape:w-32 sm:w-64 sm:landscape:w-40" />
            )}
          </div>
          <div className="px-2 pb-9 landscape:flex-1 landscape:pb-0 landscape:text-left">
            <h2 className="font-display text-2xl font-semibold leading-tight">{current.title}</h2>
            <div className="mt-1 text-[13px] text-muted">
              {current.artist}
              {current.album && <span className="text-faint"> · {current.album}</span>}
            </div>
            <div className="mt-5">
              {progressBlock}
            </div>
            {/* 个人暂停/继续：只影响本机跟随，房间仍在播（与 MobilePlayerBar 同一内核开关） */}
            <button
              type="button"
              title={personalPaused ? t('room.personalResume') : t('room.personalPause')}
              onClick={(e) => {
                e.stopPropagation();
                if (personalPaused) renderer.resumePersonal();
                else renderer.pausePersonal();
                forceTick();
              }}
              className={`mx-auto mt-4 grid h-11 w-11 place-items-center rounded-full bg-accent text-on-accent landscape:mx-0 ${
                personalPaused ? 'opacity-70' : 'hover:brightness-105'
              }`}
            >
              {personalPaused ? (
                <Play className="ml-0.5 h-5 w-5 fill-current" />
              ) : (
                <Pause className="h-5 w-5 fill-current" />
              )}
            </button>
          </div>
        </div>

        <div
          className={`absolute inset-0 overflow-hidden transition-opacity duration-300 ${
            view === 'lyrics' ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          {/* 显式高度容器：LyricsPanel 的 ol(h-full) 才能解析高度并自身滚动，
              scrollIntoView 才会滚到高亮行（其内部 38% 上下留白负责居中）。 */}
          <div className="h-full px-2 py-12">
            {lyricsBlock}
          </div>
          {/* 返回封面：整区 role=button 会吞掉歌词滚动/选词，改为独立小按钮 */}
          <button
            type="button"
            onClick={() => setView('cover')}
            className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 rounded-full border border-hairline bg-hall/60 px-4 py-2.5 text-xs text-muted hover:text-paper"
          >
            {t('room.showCover')}
          </button>
        </div>
      </div>

      {/* 桌面：两列（左封面信息 + 右歌词） */}
      <div className="relative hidden min-h-full max-w-6xl mx-auto px-8 py-14 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] items-center gap-14">
        <div className="max-w-md w-full mx-auto">
          {current.cover_url ? (
            <img
              src={current.cover_url}
              alt=""
              onLoad={grabGlow}
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

          <div className="mt-6">{progressBlock}</div>
        </div>

        {/* 右列：歌词 */}
        <div className="h-[68vh]">{lyricsBlock}</div>
      </div>
    </div>,
    document.body,
  );
}
