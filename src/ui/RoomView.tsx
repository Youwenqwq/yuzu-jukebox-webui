import { useEffect, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { YuzuError } from '../protocol/types';
import type { Playback, QueueEntry, RadioState } from '../protocol/types';
import { httpBase } from '../config';
import { api, client, roomStore, setLastRoom } from '../app/session';
import { IDLE_PLAYBACK, audio, renderer } from '../app/player';
import { syncMediaSession } from '../app/mediasession';
import { activeLineIndex, parseLrc, type LyricLine } from '../player/lyrics';
import { useConnStatus, useIdentity, useRoomState } from './hooks';
import { formatClock, formatMs } from './format';
import { extractGlowColors } from './glow';
import { LyricsPanel } from './LyricsPanel';
import { BatchAddPanel } from './BatchAddPanel';
import { useToast } from './toast';

/** 由五元组 + 校时时钟推算"此刻应该放到哪"（spec §2.2） */
function shouldBe(pb: Playback): number {
  if (!pb.playing) return pb.position_ms;
  return pb.position_ms + (client.clock.serverNow() - pb.updated_at) * pb.rate;
}

export default function RoomView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { roomId = '' } = useParams();
  const state = useRoomState();
  const status = useConnStatus();
  const identity = useIdentity();

  const [joinError, setJoinError] = useState<YuzuError | null>(null);
  const [joinPassword, setJoinPassword] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const { show, showError } = useToast();

  // 音频渲染内核：组合根单例，播放状态完全由服务端驱动。
  // 离房时 cleanup 渲染空闲态停止播放，避免旧实例残留发声。

  useEffect(() => {
    renderer.render(state.playback);
  }, [renderer, state.playback]);

  // 系统媒体会话（锁屏控制）；播放控制动作仅 room_admin 注入
  useEffect(() => {
    syncMediaSession(
      state.playback,
      httpBase,
      isAdminRef.current
        ? {
            onPlay: () => void roomStore.resume().catch(() => {}),
            onPause: () => void roomStore.pause().catch(() => {}),
            onNextTrack: () => void roomStore.skip().catch(() => {}),
          }
        : {},
    );
  }, [state.playback]);

  useEffect(() => {
    const id = setInterval(() => renderer.tick(), 1000);
    return () => clearInterval(id);
  }, [renderer]);

  // 浏览器自动播放限制：首次手势时补一次 play
  useEffect(() => {
    const unlock = () => {
      if (state.playback.playing && audio.paused && audio.src) {
        void audio.play().catch(() => {});
      }
    };
    document.addEventListener('click', unlock);
    return () => document.removeEventListener('click', unlock);
  }, [audio, state.playback.playing]);

  // 进房 / 离房；joinPassword 变化 = 用户提交了房间密码重试
  useEffect(() => {
    let cancelled = false;
    roomStore
      .join(roomId, joinPassword || undefined)
      .then(() => {
        if (cancelled) return;
        setLastRoom({ id: roomId, password: joinPassword || undefined });
        setJoinError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setJoinError(err instanceof YuzuError ? err : new YuzuError('unknown', String(err)));
        }
      });
    return () => {
      cancelled = true;
      setLastRoom(null);
      void roomStore.leave().catch(() => {});
      renderer.render(IDLE_PLAYBACK);
    };
  }, [roomId, joinPassword]);

  const isAdmin = identity?.roles.includes('room_admin') ?? false;
  const isAdminRef = useRef(isAdmin);
  isAdminRef.current = isAdmin;
  const current = state.playback.current;

  // requested_by 是身份 ID（spec §4.1）；优先用条目自带的 requester_name 快照，
  // 缺省（旧数据）再查听众表，最后回退显示 ID。
  const nameById = new Map(state.listeners.map((l) => [l.id, l.name]));
  if (identity) nameById.set(identity.id, identity.name);
  const nameOf = (id: string, snapshot?: string) => snapshot || nameById.get(id) || id;

  return (
    <div className="max-w-6xl mx-auto px-7 pb-16">
      {(status === 'reconnecting' || status === 'offline') && (
        <div className="bg-accent-soft text-accent text-sm text-center py-1.5 mb-2 rounded">
          {t(status === 'offline' ? 'conn.offline' : 'conn.reconnecting')}
        </div>
      )}

      <div className="flex items-baseline gap-3.5 py-5">
        <button onClick={() => navigate('/')} className="text-[13px] text-muted hover:text-paper">
          {t('room.backToLobby')}
        </button>
        <h1 className="font-display text-3xl font-semibold">{state.roomId ?? roomId}</h1>
        <div className="flex-1" />
        <span className="text-xs text-faint font-mono">{identity?.name}</span>
      </div>

      {joinError ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setJoinPassword(passwordInput);
          }}
          className="max-w-sm mx-auto mt-20"
        >
          <p className="text-muted mb-4">{t('room.needPassword')}</p>
          <input
            type="password"
            autoFocus
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            placeholder={t('room.passwordPlaceholder')}
            className="w-full bg-panel border border-hairline rounded-md px-4 py-2.5 mb-4 placeholder:text-faint"
          />
          <button type="submit" className="w-full bg-accent text-on-accent rounded-full py-2.5 font-medium">
            {t('room.join')}
          </button>
        </form>
      ) : (
        <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
          <div>
            <Stage playback={state.playback} isAdmin={isAdmin} nameOf={nameOf} />
            <ListenersBar />
          </div>
          <QueuePanel
            queue={state.queue}
            identityId={identity?.id ?? ''}
            isAdmin={isAdmin}
            radio={state.radio}
            nameOf={nameOf}
            onToast={show}
            onError={showError}
          />
        </div>
      )}

      {current === null && <span className="hidden" />}
    </div>
  );
}

// ---------- 舞台 ----------

type NameOf = (id: string, snapshot?: string) => string;

function Stage({ playback, isAdmin, nameOf }: { playback: Playback; isAdmin: boolean; nameOf: NameOf }) {
  const { t } = useTranslation();
  const [, forceTick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const id = setInterval(forceTick, 1000);
    return () => clearInterval(id);
  }, []);

  const current = playback.current;
  const [volume, setVolume] = useState(audio.volume);

  // 封面辉光：取色失败/无封面保持默认色，切歌时保留旧色直至新色就绪（600ms 渐变过渡）
  const [glow, setGlow] = useState<[string, string] | null>(null);

  // 歌词：换曲目重新拉取；无歌词能力的来源 → 空数组（降级提示）
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [lyrics, setLyrics] = useState<LyricLine[] | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const trackRef = current?.track_ref;
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

  const pos = current ? Math.max(0, Math.min(shouldBe(playback), current.duration_ms)) : 0;
  const pct = current && current.duration_ms > 0 ? (pos / current.duration_ms) * 100 : 0;

  if (!current) {
    return (
      <div className="bg-panel border border-hairline rounded-lg px-10 py-16 text-center text-muted">
        {t('room.queueEmpty')}
      </div>
    );
  }

  return (
    <div
      className="relative bg-panel border border-hairline rounded-lg px-10 pt-11 pb-8 overflow-hidden"
      style={glow ? ({ '--glow-a': glow[0], '--glow-b': glow[1] } as React.CSSProperties) : undefined}
    >
      <div
        className="absolute -inset-[30%] pointer-events-none"
        style={{
          background:
            'radial-gradient(42% 46% at 30% 34%, var(--glow-a, #6B5326) 0%, transparent 70%), radial-gradient(40% 44% at 72% 66%, var(--glow-b, #2E4258) 0%, transparent 70%)',
          opacity: 'var(--glow-opacity)',
          filter: 'blur(var(--glow-blur))',
          transition: 'background 600ms ease',
        }}
      />

      {lyricsOpen ? (
        <div className="relative h-62">
          {lyricsLoading || lyrics === null ? (
            <p className="text-faint text-sm text-center pt-24">{t('lyrics.loading')}</p>
          ) : (
            <LyricsPanel lines={lyrics} activeIndex={activeLineIndex(lyrics, pos)} emptyText={t('lyrics.unavailable')} />
          )}
        </div>
      ) : (
        <div className="relative flex gap-8 items-end max-md:flex-col max-md:items-start">
          {current.cover_url ? (
            <img
              src={current.cover_url}
              alt=""
              onLoad={(e) => {
                const colors = extractGlowColors(e.currentTarget);
                if (colors) setGlow(colors);
              }}
              className="rounded-lg flex-none object-cover"
              style={{ boxShadow: 'var(--cover-shadow)', width: 216, height: 216 }}
            />
          ) : (
            <div className="rounded-lg flex-none bg-panel-2" style={{ width: 216, height: 216 }} />
          )}
          <div className="min-w-0 flex-1 pb-1">
            <div className="font-mono text-[11px] tracking-[0.14em] uppercase text-muted mb-2">
              {t('room.nowPlaying')}
            </div>
            <h2 className="font-display text-[34px] font-semibold leading-tight">{current.title}</h2>
            <div className="text-muted mt-1.5">
              {current.artist}
              {current.album && <span className="text-faint"> · {current.album}</span>}
            </div>
            <div className="text-faint text-xs mt-2.5">
              {t('room.requestedBy', { name: nameOf(current.requested_by, current.requester_name), time: formatClock(current.added_at) })}
            </div>
          </div>
        </div>
      )}

      <div className="relative flex items-center gap-1.5 mt-5">
        {isAdmin && (
          <>
            <button
              title={playback.playing ? t('room.pause') : t('room.resume')}
              onClick={() => void (playback.playing ? roomStore.pause() : roomStore.resume()).catch(() => {})}
              className="w-8.5 h-8.5 grid place-items-center rounded-md text-muted hover:text-paper hover:bg-[var(--hover)]"
            >
              {playback.playing ? '⏸' : '▶'}
            </button>
            <button
              title={t('room.skip')}
              onClick={() => void roomStore.skip().catch(() => {})}
              className="w-8.5 h-8.5 grid place-items-center rounded-md text-muted hover:text-paper hover:bg-[var(--hover)]"
            >
              ⏭
            </button>
          </>
        )}
        <button
          title={t('room.lyrics')}
          onClick={() => setLyricsOpen((v) => !v)}
          className={`w-8.5 h-8.5 grid place-items-center rounded-md hover:bg-[var(--hover)] ${lyricsOpen ? 'text-accent' : 'text-muted hover:text-paper'}`}
        >
          ♪
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(volume * 100)}
          onChange={(e) => {
            const v = Number(e.target.value) / 100;
            setVolume(v);
            audio.volume = v;
          }}
          title={t('room.volume')}
          className="w-24 ml-2 accent-[var(--accent)]"
        />
      </div>

      <div className="relative mt-5">
        <div
          className="h-[3px] rounded bg-[var(--rail)] overflow-hidden cursor-pointer"
          onClick={(e) => {
            if (!isAdmin || current.duration_ms <= 0) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            void roomStore.seek(Math.round(ratio * current.duration_ms)).catch(() => {});
          }}
        >
          <div className="h-full bg-accent rounded" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex justify-between font-mono text-[11.5px] text-muted mt-1.5 tabular-nums">
          <span>{formatMs(pos)}</span>
          <span>{formatMs(current.duration_ms)}</span>
        </div>
      </div>
    </div>
  );
}

// ---------- 听众条 ----------

function ListenersBar() {
  const { t } = useTranslation();
  const state = useRoomState();
  return (
    <div className="flex items-center gap-4 mt-5 pt-3.5 border-t border-hairline text-[13px] text-muted">
      <span>{t('room.listenerCount', { count: state.listeners.length })}</span>
      <span className="text-faint">{state.listeners.map((l) => l.name).join('、')}</span>
      {state.radio && (
        <>
          <span className="w-px h-3.5 bg-hairline" />
          <span className="font-mono text-xs">{t('room.radioOn', { source: state.radio.source })}</span>
        </>
      )}
    </div>
  );
}

// ---------- 队列（点歌小票）+ 搜索点歌 ----------

function QueuePanel({
  queue,
  identityId,
  isAdmin,
  radio,
  nameOf,
  onToast,
  onError,
}: {
  queue: QueueEntry[];
  identityId: string;
  isAdmin: boolean;
  radio: RadioState | null;
  nameOf: NameOf;
  onToast: (msg: string) => void;
  onError: (err: unknown) => void;
}) {
  const { t } = useTranslation();
  const [searchOpen, setSearchOpen] = useState(false);

  // 拖拽排序（room_admin）：dragIndex = 被拖条目序号，dropSlot = 插入缝（0..N）
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropSlot, setDropSlot] = useState<number | null>(null);

  const dropAt = (slot: number) => {
    if (dragIndex === null) return;
    const entry = queue[dragIndex];
    setDragIndex(null);
    setDropSlot(null);
    if (!entry || slot === dragIndex || slot === dragIndex + 1) return; // 落回原位
    // 服务端 to_index = 删除该条目后的插入位（0-based）：向下拖要减 1
    const toIndex = slot < dragIndex ? slot : slot - 1;
    void roomStore.moveQueue(entry.entry_id, toIndex).catch(onError);
  };

  const endDrag = () => {
    setDragIndex(null);
    setDropSlot(null);
  };

  return (
    <div className="bg-panel border border-hairline rounded-lg">
      <header className="flex items-baseline justify-between px-4.5 py-3.5 border-b border-hairline">
        <span className="font-mono text-[11px] tracking-[0.14em] text-faint">{t('room.queueTitle')}</span>
        <span className="font-mono text-xs text-muted tabular-nums">
          {t('room.queueCount', { count: queue.length })}
        </span>
      </header>

      <div className="px-4.5 py-3 border-b border-hairline">
        <button
          onClick={() => setSearchOpen((v) => !v)}
          className="w-full bg-accent text-on-accent rounded-full py-2 text-[13.5px] font-medium hover:brightness-105"
        >
          {t('room.addSong')}
        </button>
        {searchOpen && <BatchAddPanel onToast={onToast} onError={onError} />}
      </div>

      {queue.length === 0 ? (
        <p className="px-4.5 py-8 text-center text-muted text-sm">{t('room.queueEmpty')}</p>
      ) : (
        queue.map((entry, i) => (
          <div key={entry.entry_id}>
            {isAdmin && dropSlot === i && <div className="h-0.5 bg-accent mx-2 rounded" />}
            <Ticket
              entry={entry}
              index={i + 1}
              mine={entry.requested_by === identityId}
              isAdmin={isAdmin}
              nameOf={nameOf}
              onError={onError}
              dragging={dragIndex === i}
              dnd={
                isAdmin
                  ? {
                      onDragStart: (e) => {
                        setDragIndex(i);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', entry.entry_id);
                      },
                      onDragOver: (e) => {
                        e.preventDefault();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setDropSlot(e.clientY < rect.top + rect.height / 2 ? i : i + 1);
                      },
                      onDrop: (e) => {
                        e.preventDefault();
                        dropAt(dropSlot ?? i);
                      },
                      onDragEnd: endDrag,
                    }
                  : undefined
              }
            />
          </div>
        ))
      )}
      {isAdmin && dropSlot === queue.length && queue.length > 0 && (
        <div className="h-0.5 bg-accent mx-2 rounded" />
      )}

      {radio && <div className="px-4.5 py-2.5 text-xs text-faint border-t border-dashed border-hairline">{t('room.radioNote')}</div>}
    </div>
  );
}

function Ticket({
  entry,
  index,
  mine,
  isAdmin,
  nameOf,
  onError,
  dragging,
  dnd,
}: {
  entry: QueueEntry;
  index: number;
  mine: boolean;
  isAdmin: boolean;
  nameOf: NameOf;
  onError: (err: unknown) => void;
  dragging?: boolean;
  dnd?: {
    onDragStart: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    onDragEnd: () => void;
  };
}) {
  const { t } = useTranslation();
  const canRemove = mine || isAdmin;
  const requesterName = nameOf(entry.requested_by, entry.requester_name);
  return (
    <div
      draggable={dnd !== undefined}
      onDragStart={dnd?.onDragStart}
      onDragOver={dnd?.onDragOver}
      onDrop={dnd?.onDrop}
      onDragEnd={dnd?.onDragEnd}
      className={`group grid grid-cols-[34px_1fr_auto] gap-3 px-4.5 py-3 border-b border-hairline last:border-b-0 hover:bg-panel-2 ${mine ? 'shadow-[inset_2px_0_0_var(--accent)]' : ''} ${dnd ? 'cursor-grab active:cursor-grabbing' : ''} ${dragging ? 'opacity-40' : ''}`}
    >
      <span className="font-mono text-xs text-faint pt-1 tabular-nums">{String(index).padStart(2, '0')}</span>
      <div className="min-w-0">
        <div className="text-sm truncate">{entry.title}</div>
        <div className="text-xs text-muted truncate mt-0.5">
          {entry.artist}
          {entry.album ? ` · ${entry.album}` : ''}
        </div>
        <div className="text-[11.5px] text-faint mt-1 flex gap-2">
          <span className={mine ? 'text-accent' : 'text-muted'}>
            {mine ? t('room.mine', { name: requesterName }) : requesterName}
          </span>
          <time className="font-mono text-[10.5px]">{formatClock(entry.added_at)}</time>
        </div>
      </div>
      <div className="flex flex-col items-end justify-between">
        <span className="font-mono text-[11.5px] text-muted tabular-nums">{formatMs(entry.duration_ms)}</span>
        {canRemove && (
          <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
            {isAdmin && <span className="text-faint px-1" title={t('room.moveAdmin')}>≡</span>}
            <button
              title={mine ? t('room.removeOwn') : t('room.removeAdmin')}
              onClick={() => void roomStore.removeQueue(entry.entry_id).catch(onError)}
              className="text-faint hover:text-[#D05A4E] px-1"
            >
              ×
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

