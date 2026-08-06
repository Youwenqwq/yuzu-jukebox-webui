/**
 * 底部播放栏：常驻的播放器面孔。
 * 左 = 当前曲目（点击进全屏）；中 = 控制 + 进度；右 = 音量 / 队列 / 房间切换。
 * 图标统一走 lucide，不用文本字符（不同终端字体下渲染不一致）。
 * 未入房时整条降级为「选择房间」入口；入房但空闲时提示去点歌。
 */
import { useEffect, useReducer, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { DropdownMenu } from 'radix-ui';
import { Heart, ListMusic, Pause, Play, Plus } from 'lucide-react';
import { api, client } from '../../app/session';
import { audio, renderer } from '../../app/player';
import type { AccountPlaylist } from '../../api/types';
import type { Playback } from '../../protocol/types';
import { parseLrc, type LyricLine } from '../../player/lyrics';
import { useProviders, useRoomState } from '../hooks';
import { formatMs } from '../format';
import { FullscreenPlayer } from '../FullscreenPlayer';
import { VolumeControl } from '../VolumeControl';
import { useToast } from '../toast';
import { useShell } from '../AppShell';
import { RoomSwitcher } from './RoomSwitcher';

/** 加入凭据账号歌单：下拉枚举账号歌单（owner 专用，选中即调 playlist-add）。 */
function AddToAccountPlaylist({ providerId, trackId }: { providerId: string; trackId: string }) {
  const { t } = useTranslation();
  const { show, showError } = useToast();
  const [playlists, setPlaylists] = useState<AccountPlaylist[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setPlaylists(null);
    api
      .accountPlaylists(providerId)
      .then(setPlaylists)
      .catch((err: unknown) => {
        setPlaylists([]);
        showError(err);
      });
  };

  return (
    <DropdownMenu.Root
      onOpenChange={(open) => {
        if (open) load();
      }}
    >
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          title={t('like.addToPlaylist')}
          className="grid h-8 w-8 flex-none place-items-center rounded-full text-muted hover:bg-[var(--hover)] hover:text-paper"
        >
          <Plus className="h-4 w-4" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          side="top"
          sideOffset={8}
          className="menu-content z-50 w-56 rounded-lg border border-hairline bg-panel-2 p-1.5"
        >
          <div className="px-2.5 pt-1 pb-1.5 font-mono text-[11px] tracking-[0.14em] text-faint">
            {t('like.addToPlaylist')}
          </div>
          {playlists === null && (
            <p className="px-2.5 py-3 text-xs text-muted">{t('common.loading')}</p>
          )}
          {playlists?.length === 0 && (
            <p className="px-2.5 py-3 text-xs text-faint">{t('like.noAccountPlaylists')}</p>
          )}
          <div className="max-h-64 overflow-y-auto">
            {(playlists ?? []).map((playlist) => (
              <DropdownMenu.Item
                key={playlist.id}
                disabled={busy}
                onSelect={() => {
                  setBusy(true);
                  void api
                    .playlistAddTrack(providerId, playlist.id, trackId)
                    .then(() => show(t('like.addedToPlaylist', { name: playlist.name })))
                    .catch(showError)
                    .finally(() => setBusy(false));
                }}
                className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-2 text-[13px] text-muted outline-none data-[highlighted]:bg-[var(--hover)] data-[highlighted]:text-paper"
              >
                <span className="truncate">{playlist.name}</span>
                <span className="flex-none font-mono text-[11px] text-faint tabular-nums">
                  {t('batch.trackCount', { count: playlist.track_count })}
                </span>
              </DropdownMenu.Item>
            ))}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** 由五元组 + 校时时钟推算"此刻应该放到哪"（spec §2.2）；负值窗口渲染前钳到 0。 */
export function positionOf(playback: Playback): number {
  const current = playback.current;
  if (!current) return 0;
  const shouldBe = playback.playing
    ? playback.position_ms + (client.clock.serverNow() - playback.updated_at) * playback.rate
    : playback.position_ms;
  return Math.max(0, Math.min(shouldBe, current.duration_ms));
}

export function PlayerBar(): JSX.Element {
  const { t } = useTranslation();
  const state = useRoomState();
  const { nameOf, queueOpen, setQueueOpen, setRoomsOpen } = useShell();
  const providers = useProviders();
  const { show, showError } = useToast();
  const [playerOpen, setPlayerOpen] = useState(false);
  // 本会话内已喜欢的 ref 集合（服务端不提供喜欢状态查询，乐观记录）
  const [likedRefs, setLikedRefs] = useState<Set<string>>(() => new Set());

  // 进度 1s 重算（校时时钟由 WS 连接在启动时建立）
  const [, forceTick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const id = setInterval(forceTick, 1000);
    return () => clearInterval(id);
  }, []);

  // 歌词数据：换曲目重新拉取；全屏播放页消费
  const [lyrics, setLyrics] = useState<LyricLine[] | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const trackRef = state.playback.current?.track_ref;
  useEffect(() => {
    setLyrics(null);
    if (!trackRef) return;
    let dead = false;
    setLyricsLoading(true);
    api
      .lyrics(trackRef)
      .then((res) => {
        if (!dead) setLyrics(res ? parseLrc(res.lrc, res.tlrc) : []);
      })
      .catch(() => {
        if (!dead) setLyrics([]);
      })
      .finally(() => {
        if (!dead) setLyricsLoading(false);
      });
    return () => {
      dead = true;
    };
  }, [trackRef]);

  const playback = state.playback;
  const current = playback.current;
  // 个人暂停（前端暂停）：仅本客户端静默，房间继续播放；恢复时对齐房间位置。
  const [personalPaused, setPersonalPaused] = useState(() => renderer.isPersonalPaused);
  useEffect(() => {
    // 离房/换房：内核渲染空闲态时清除标志，这里同步按钮态。
    setPersonalPaused(renderer.isPersonalPaused);
  }, [state.roomId]);
  const pos = personalPaused && current
    ? audio.currentTime * 1_000
    : positionOf(playback);
  const pct = current && current.duration_ms > 0 ? (pos / current.duration_ms) * 100 : 0;

  // 喜欢/加歌单：仅当当前曲目的 provider 凭据归我所有且报告对应能力时出现
  const currentRef = current?.track_ref;
  const accountTarget = (() => {
    if (!currentRef) return null;
    const sep = currentRef.indexOf(':');
    if (sep <= 0) return null;
    const providerId = currentRef.slice(0, sep);
    const providerInfo = providers?.find((p) => p.id === providerId);
    if (!providerInfo?.owned) return null;
    const write = providerInfo.capabilities?.account_write ?? [];
    return {
      providerId,
      trackId: currentRef.slice(sep + 1),
      canLike: write.includes('like'),
      canLikeCheck: write.includes('like_check'),
      canPlaylistAdd: write.includes('playlist_add'),
    };
  })();
  const liked = currentRef !== undefined && likedRefs.has(currentRef);

  // 喜欢状态回读（spec：now-playing 变化时自查，服务端不广播该私有状态）
  useEffect(() => {
    if (!accountTarget?.canLikeCheck) return;
    const ref = currentRef!;
    let dead = false;
    api
      .likeCheck(accountTarget.providerId, accountTarget.trackId)
      .then((serverLiked) => {
        if (dead) return;
        setLikedRefs((current) => {
          const next = new Set(current);
          if (serverLiked) next.add(ref);
          else next.delete(ref);
          return next;
        });
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
    // accountTarget 随 currentRef 重建，依赖 ref 即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRef]);

  if (!state.roomId) {
    return (
      <div className="flex h-16 flex-none items-center justify-between gap-4 border-t border-hairline bg-panel px-4">
        <span className="text-[13px] text-faint">{t('shell.noRoomHint')}</span>
        <button
          type="button"
          onClick={() => setRoomsOpen(true)}
          className="rounded-full bg-accent px-5 py-2 text-[13px] font-medium text-on-accent hover:brightness-105"
        >
          {t('shell.selectRoom')}
        </button>
        <RoomSwitcher />
      </div>
    );
  }

  return (
    <div className="grid h-18 flex-none grid-cols-[1fr_minmax(0,1.6fr)_1fr] items-center gap-4 border-t border-hairline bg-panel px-4">
      {/* 左：当前曲目 */}
      <div className="flex min-w-0 items-center gap-3">
        {current ? (
          <button
            type="button"
            onClick={() => setPlayerOpen(true)}
            title={t('room.expand')}
            className="flex min-w-0 items-center gap-3 text-left"
          >
            {current.cover_url ? (
              <img src={current.cover_url} alt="" className="h-11 w-11 flex-none rounded object-cover" />
            ) : (
              <div className="h-11 w-11 flex-none rounded bg-panel-2" />
            )}
            <span className="min-w-0">
              <span className="block truncate text-[13.5px]">{current.title}</span>
              <span className="block truncate text-xs text-muted">{current.artist}</span>
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setQueueOpen(true)}
            className="truncate text-[13px] text-faint hover:text-accent"
          >
            {t('shell.idleHint')}
          </button>
        )}
        {accountTarget?.canLike && (
          <button
            type="button"
            title={liked ? t('like.liked') : t('like.like')}
            disabled={liked}
            onClick={() => {
              void api
                .likeTrack(accountTarget.providerId, accountTarget.trackId)
                .then(() => {
                  setLikedRefs((current) => new Set(current).add(currentRef!));
                  show(t('like.likedToast', { title: current!.title }));
                })
                .catch(showError);
            }}
            className={`grid h-8 w-8 flex-none place-items-center rounded-full hover:bg-[var(--hover)] disabled:opacity-100 ${
              liked ? 'text-accent' : 'text-muted hover:text-paper'
            }`}
          >
            <Heart className={`h-4 w-4 ${liked ? 'fill-current' : ''}`} />
          </button>
        )}
        {accountTarget?.canPlaylistAdd && (
          <AddToAccountPlaylist providerId={accountTarget.providerId} trackId={accountTarget.trackId} />
        )}
      </div>

      {/* 中：进度（统一展示；房间控制已移至房间切换面板） */}
      <div className="flex min-w-0 flex-col items-center gap-1">
        {current && (
          <>
            <div className="flex w-full items-center gap-2.5">
              <span className="flex-none font-mono text-[11px] text-muted tabular-nums">{formatMs(pos)}</span>
              <div className="h-[3px] flex-1 overflow-hidden rounded bg-[var(--rail)]">
                <div className="progress-glide h-full rounded bg-accent" style={{ width: `${pct}%` }} />
              </div>
              <span className="flex-none font-mono text-[11px] text-muted tabular-nums">
                {formatMs(current.duration_ms)}
              </span>
            </div>
            {personalPaused && (
              <p className="text-[10.5px] text-faint">{t('room.personalPausedHint')}</p>
            )}
          </>
        )}
      </div>

      {/* 右：个人暂停 / 音量 / 队列 / 房间切换 */}
      <div className="flex min-w-0 items-center justify-end gap-2">
        {current && (
          <button
            type="button"
            title={personalPaused ? t('room.personalResume') : t('room.personalPause')}
            onClick={() => {
              if (personalPaused) {
                renderer.resumePersonal();
              } else {
                renderer.pausePersonal();
              }
              setPersonalPaused(renderer.isPersonalPaused);
            }}
            className={`grid h-8.5 w-8.5 flex-none place-items-center rounded-full hover:bg-[var(--hover)] ${
              personalPaused ? 'text-accent' : 'text-muted hover:text-paper'
            }`}
          >
            {personalPaused ? (
              <Play className="ml-0.5 h-4 w-4 fill-current" />
            ) : (
              <Pause className="h-4 w-4 fill-current" />
            )}
          </button>
        )}
        <VolumeControl className="max-lg:hidden" />
        <button
          type="button"
          title={t('shell.queue')}
          data-queue-toggle
          onClick={() => setQueueOpen(!queueOpen)}
          className={`grid h-8.5 w-8.5 flex-none place-items-center rounded-md hover:bg-[var(--hover)] ${
            queueOpen ? 'text-accent' : 'text-muted hover:text-paper'
          }`}
        >
          <ListMusic className="h-4 w-4" />
        </button>
        <RoomSwitcher />
      </div>

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
