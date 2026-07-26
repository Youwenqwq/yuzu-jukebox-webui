import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { YuzuError } from '../protocol/types';
import type { Playback, QueueEntry, RadioState } from '../protocol/types';
import type { SearchTrack } from '../api/types';
import { api, client, roomStore, setLastRoom } from '../app/session';
import { IDLE_PLAYBACK, audio, renderer } from '../app/player';
import { useConnStatus, useIdentity, useRoomState } from './hooks';
import { formatClock, formatMs } from './format';
import { errorKey } from './errors';

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
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current ?? undefined);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  // 音频渲染内核：组合根单例，播放状态完全由服务端驱动。
  // 离房时 cleanup 渲染空闲态停止播放，避免旧实例残留发声。

  useEffect(() => {
    renderer.render(state.playback);
  }, [renderer, state.playback]);

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
  const current = state.playback.current;

  // requested_by 是身份 ID（spec §4.1）；用听众表 + 自身身份解析显示名，
  // 点歌人已离场时回退显示 ID。
  const nameById = new Map(state.listeners.map((l) => [l.id, l.name]));
  if (identity) nameById.set(identity.id, identity.name);

  return (
    <div className="max-w-6xl mx-auto px-7 pb-16">
      {status === 'reconnecting' && (
        <div className="bg-accent-soft text-accent text-sm text-center py-1.5 mb-2 rounded">
          {t('conn.reconnecting')}
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
            <Stage playback={state.playback} isAdmin={isAdmin} nameById={nameById} />
            <ListenersBar />
          </div>
          <QueuePanel
            queue={state.queue}
            identityId={identity?.id ?? ''}
            isAdmin={isAdmin}
            radio={state.radio}
            nameById={nameById}
            onToast={showToast}
          />
        </div>
      )}

      {toast && (
        <div className="fixed right-7 bottom-7 bg-panel-2 border border-hairline border-l-[3px] border-l-accent rounded-lg px-4.5 py-3 text-[13.5px] shadow-xl">
          {toast}
        </div>
      )}
      {current === null && <span className="hidden" />}
    </div>
  );
}

// ---------- 舞台 ----------

function Stage({ playback, isAdmin, nameById }: { playback: Playback; isAdmin: boolean; nameById: Map<string, string> }) {
  const { t } = useTranslation();
  const [, forceTick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const id = setInterval(forceTick, 1000);
    return () => clearInterval(id);
  }, []);

  const current = playback.current;
  const [volume, setVolume] = useState(audio.volume);

  if (!current) {
    return (
      <div className="bg-panel border border-hairline rounded-lg px-10 py-16 text-center text-muted">
        {t('room.queueEmpty')}
      </div>
    );
  }

  const pos = Math.max(0, Math.min(shouldBe(playback), current.duration_ms));
  const pct = current.duration_ms > 0 ? (pos / current.duration_ms) * 100 : 0;

  return (
    <div className="relative bg-panel border border-hairline rounded-lg px-10 pt-11 pb-8 overflow-hidden">
      <div className="relative flex gap-8 items-end max-md:flex-col max-md:items-start">
        {current.cover_url ? (
          <img
            src={current.cover_url}
            alt=""
            className="w-54 h-54 rounded-lg flex-none object-cover"
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
            {t('room.requestedBy', { name: nameById.get(current.requested_by) ?? current.requested_by, time: formatClock(current.added_at) })}
          </div>

          <div className="flex items-center gap-1.5 mt-5">
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
        </div>
      </div>

      <div className="relative mt-7">
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
  nameById,
  onToast,
}: {
  queue: QueueEntry[];
  identityId: string;
  isAdmin: boolean;
  radio: RadioState | null;
  nameById: Map<string, string>;
  onToast: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const [searchOpen, setSearchOpen] = useState(false);

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
        {searchOpen && <SearchPanel onToast={onToast} />}
      </div>

      {queue.length === 0 ? (
        <p className="px-4.5 py-8 text-center text-muted text-sm">{t('room.queueEmpty')}</p>
      ) : (
        queue.map((entry, i) => (
          <Ticket key={entry.entry_id} entry={entry} index={i + 1} mine={entry.requested_by === identityId} isAdmin={isAdmin} nameById={nameById} />
        ))
      )}

      {radio && <div className="px-4.5 py-2.5 text-xs text-faint border-t border-dashed border-hairline">{t('room.radioNote')}</div>}
    </div>
  );
}

function Ticket({ entry, index, mine, isAdmin, nameById }: { entry: QueueEntry; index: number; mine: boolean; isAdmin: boolean; nameById: Map<string, string> }) {
  const { t } = useTranslation();
  const canRemove = mine || isAdmin;
  const requesterName = nameById.get(entry.requested_by) ?? entry.requested_by;
  return (
    <div
      className={`group grid grid-cols-[34px_1fr_auto] gap-3 px-4.5 py-3 border-b border-hairline last:border-b-0 hover:bg-panel-2 ${mine ? 'shadow-[inset_2px_0_0_var(--accent)]' : ''}`}
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
          <button
            title={mine ? t('room.removeOwn') : t('room.removeAdmin')}
            onClick={() => void roomStore.removeQueue(entry.entry_id).catch(() => {})}
            className="text-faint hover:text-[#D05A4E] opacity-0 group-hover:opacity-100 transition-opacity px-1"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

function SearchPanel({ onToast }: { onToast: (msg: string) => void }) {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<string[]>([]);
  const [provider, setProvider] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchTrack[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .listProviders()
      .then((list) => {
        const ids = list.map((p) => p.id);
        setProviders(ids);
        if (ids.length > 0) setProvider((cur) => cur || ids[0]);
      })
      .catch(() => {});
  }, []);

  const run = () => {
    if (!q.trim() || !provider) return;
    setBusy(true);
    api
      .search(provider, q.trim())
      .then(setResults)
      .catch(() => setResults([]))
      .finally(() => setBusy(false));
  };

  return (
    <div className="mt-3">
      <div className="flex gap-2">
        {providers.length > 1 && (
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="bg-panel-2 border border-hairline rounded-md px-2 text-xs"
          >
            {providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
          placeholder={t('search.placeholder')}
          className="flex-1 min-w-0 bg-panel-2 border border-hairline rounded-md px-3 py-1.5 text-[13px] placeholder:text-faint"
        />
        <button onClick={run} disabled={busy} className="text-accent text-[13px] px-2 disabled:opacity-40">
          {t('search.submit')}
        </button>
      </div>

      {results && (
        <div className="mt-2 max-h-72 overflow-y-auto">
          {results.length === 0 && <p className="text-xs text-faint py-3 text-center">{t('search.empty')}</p>}
          {results.map((track) => (
            <div key={track.track_ref} className="flex items-center gap-2.5 py-2 border-b border-hairline last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] truncate">{track.title}</div>
                <div className="text-[11px] text-muted truncate">{track.artist}</div>
              </div>
              <span className="font-mono text-[11px] text-faint tabular-nums">{formatMs(track.duration_ms)}</span>
              <button
                onClick={() =>
                  void roomStore
                    .addQueue([track.track_ref])
                    .then(() => onToast(t('room.addedToast', { title: track.title })))
                    .catch((err: unknown) =>
                      onToast(
                        t(errorKey(err instanceof YuzuError ? err : new YuzuError('unknown', String(err))), {
                          message: err instanceof Error ? err.message : '',
                        }),
                      ),
                    )
                }
                className="text-accent text-lg leading-none px-1.5 hover:brightness-110"
                title={t('search.add')}
              >
                +
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
