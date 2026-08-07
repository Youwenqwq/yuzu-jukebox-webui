/**
 * 移动端紧凑播放条（<md）：封面 + 标题/歌手（点击进全屏）+ 个人暂停 + 队列。
 * 底部进度细线；房间级控制（controller）在账户菜单的「切换房间」弹层里。
 * 与桌面播放栏共用渲染内核（renderer.pausePersonal/resumePersonal）与五元组时钟。
 */
import { useEffect, useReducer, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { ListMusic, Pause, Play } from 'lucide-react';
import { client } from '../app/session';
import { audio, renderer } from '../app/player';
import { useRoomState } from './hooks';
import { coverSrc } from './cover';
import { useLyrics } from './useLyrics';
import { FullscreenPlayer } from './FullscreenPlayer';
import { useShell } from './shellContext';

function positionOf(playback: {
  current: { duration_ms: number } | null;
  playing: boolean;
  position_ms: number;
  updated_at: number;
  rate: number;
}): number {
  const current = playback.current;
  if (!current) return 0;
  const shouldBe = playback.playing
    ? playback.position_ms + (client.clock.serverNow() - playback.updated_at) * playback.rate
    : playback.position_ms;
  return Math.max(0, Math.min(shouldBe, current.duration_ms));
}

export function MobilePlayerBar(): JSX.Element {
  const { t } = useTranslation();
  const state = useRoomState();
  const { nameOf, queueOpen, setQueueOpen, setRoomsOpen } = useShell();
  const [playerOpen, setPlayerOpen] = useState(false);
  const [personalPaused, setPersonalPaused] = useState(() => renderer.isPersonalPaused);
  const [, forceTick] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    const id = setInterval(forceTick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // 离房/换房：内核渲染空闲态时清除个人暂停标志，这里同步按钮态。
    setPersonalPaused(renderer.isPersonalPaused);
  }, [state.roomId]);

  const playback = state.playback;
  const current = playback.current;
  const { lines: lyrics, loading: lyricsLoading } = useLyrics(current?.track_ref);

  // 未入房：降级为「选择房间」条（点击开房间弹层）
  if (!state.roomId) {
    return (
      <div className="flex h-14 flex-none items-center justify-between gap-3 border-t border-hairline bg-panel px-3.5">
        <span className="truncate text-[12.5px] text-faint">{t('shell.noRoomHint')}</span>
        <button
          type="button"
          onClick={() => setRoomsOpen(true)}
          className="flex-none rounded-full bg-accent px-4 py-1.5 text-[12.5px] font-medium text-on-accent hover:brightness-105"
        >
          {t('shell.selectRoom')}
        </button>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="flex h-14 flex-none items-center justify-between gap-3 border-t border-hairline bg-panel px-3.5">
        <span className="truncate text-[12.5px] text-faint">{t('shell.idleHint')}</span>
        <button
          type="button"
          data-queue-toggle
          onClick={() => setQueueOpen(true)}
          className="relative grid h-8 w-8 flex-none place-items-center rounded-full text-muted after:absolute after:-inset-1 after:content-[''] hover:bg-[var(--hover)]"
        >
          <ListMusic className="h-4 w-4" />
        </button>
      </div>
    );
  }

  const pos = personalPaused ? audio.currentTime * 1_000 : positionOf(playback);
  const pct = current.duration_ms > 0 ? (pos / current.duration_ms) * 100 : 0;

  return (
    <div className="relative flex h-14 flex-none items-center gap-3 border-t border-hairline bg-panel px-3.5">
      {/* 顶部 2px 进度细线 */}
      <div className="absolute inset-x-0 top-0 h-[2px] bg-[var(--rail)]">
        <div className="progress-glide h-full bg-accent" style={{ width: `${pct}%` }} />
      </div>

      <button
        type="button"
        onClick={() => setPlayerOpen(true)}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        {current.cover_url ? (
          <img src={coverSrc(current.cover_url)} alt="" className="h-10 w-10 flex-none rounded object-cover" />
        ) : (
          <div className="h-10 w-10 flex-none rounded bg-panel-2" />
        )}
        <span className="min-w-0">
          <span className="block truncate text-[13px]">{current.title}</span>
          <span className="block truncate text-[11px] text-muted">
            {current.artist}
            {personalPaused ? ` · ${t('room.personalPausedHint')}` : ''}
          </span>
        </span>
      </button>

      <button
        type="button"
        title={personalPaused ? t('room.personalResume') : t('room.personalPause')}
        onClick={() => {
          if (personalPaused) renderer.resumePersonal();
          else renderer.pausePersonal();
          setPersonalPaused(renderer.isPersonalPaused);
        }}
        className={`relative grid h-9 w-9 flex-none place-items-center rounded-full bg-accent text-on-accent after:absolute after:-inset-1 after:content-[''] ${
          personalPaused ? 'opacity-70' : 'hover:brightness-105'
        }`}
      >
        {personalPaused ? (
          <Play className="ml-0.5 h-4 w-4 fill-current" />
        ) : (
          <Pause className="h-4 w-4 fill-current" />
        )}
      </button>
      <button
        type="button"
        title={t('shell.queue')}
        data-queue-toggle
        onClick={() => setQueueOpen(!queueOpen)}
        className="relative grid h-8 w-8 flex-none place-items-center rounded-full text-muted after:absolute after:-inset-1 after:content-[''] hover:bg-[var(--hover)]"
      >
        <ListMusic className="h-4 w-4" />
      </button>

      {playerOpen && current && (
        <FullscreenPlayer
          playback={playback}
          nameOf={nameOf}
          lines={lyrics}
          lyricsLoading={lyricsLoading}
          onClose={() => setPlayerOpen(false)}
        />
      )}
    </div>
  );
}
