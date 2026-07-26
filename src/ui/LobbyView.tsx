import { useEffect, useReducer, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { RoomInfo } from '../api/types';
import { api, client } from '../app/session';
import ThemeControls from './ThemeControls';

export default function LobbyView() {
  const { t } = useTranslation();
  const [rooms, setRooms] = useState<RoomInfo[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = () => {
    setFailed(false);
    api.listRooms().then(setRooms).catch(() => setFailed(true));
  };
  useEffect(load, []);

  return (
    <div className="max-w-5xl mx-auto px-7 pb-16">
      <header className="flex items-center gap-4 py-5 border-b border-hairline mb-9">
        <div className="font-display text-xl font-semibold">
          Yuzu <em className="italic font-normal text-accent">Jukebox</em>
        </div>
        <div className="flex-1" />
        <ThemeControls />
      </header>

      <div className="font-mono text-[11px] tracking-[0.14em] uppercase text-faint mb-2.5">
        {t('lobby.eyebrow')}
      </div>
      <h1 className="font-display text-4xl font-semibold mb-9">{t('lobby.title')}</h1>

      {rooms === null && !failed && <p className="text-muted mb-6">{t('common.loading')}</p>}

      {failed && (
        <div className="text-muted mb-6">
          {t('error.internal')}
          <button onClick={load} className="ml-3 text-accent">
            {t('common.retry')}
          </button>
        </div>
      )}

      <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
        {(rooms ?? []).map((room) => (
          <RoomCard key={room.id} room={room} />
        ))}
        {rooms?.length === 0 && <p className="text-muted">{t('lobby.noRooms')}</p>}
      </div>
    </div>
  );
}

function RoomCard({ room }: { room: RoomInfo }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // 进度条每秒重算（校时时钟由 WS 连接在启动时建立）
  const [, forceTick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const id = setInterval(forceTick, 1000);
    return () => clearInterval(id);
  }, []);

  const np = room.now_playing;
  const pos = np
    ? Math.max(
        0,
        Math.min(
          np.playing ? np.position_ms + (client.clock.serverNow() - np.updated_at) * np.rate : np.position_ms,
          np.duration_ms,
        ),
      )
    : 0;

  return (
    <button
      onClick={() => navigate(`/room/${encodeURIComponent(room.id)}`)}
      className="text-left bg-panel border border-hairline rounded-md p-4.5 hover:border-faint hover:bg-panel-2 transition-colors cursor-pointer"
    >
      <h2 className="font-display text-xl font-semibold">{room.name}</h2>
      <div className="flex gap-3 text-[12.5px] text-muted mt-0.5">
        {np ? (
          np.playing ? (
            <span className="text-accent inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              {t('lobby.playing')}
            </span>
          ) : (
            <span className="text-faint">{t('lobby.paused')}</span>
          )
        ) : (
          <span className="text-faint">{t('lobby.idle')}</span>
        )}
        <span>{t('lobby.listenerCount', { count: room.listener_count })}</span>
      </div>

      <div className="mt-3.5 pt-3 border-t border-hairline">
        {np ? (
          <div className="flex items-center gap-2.5">
            {np.cover_url ? (
              <img src={np.cover_url} alt="" className="w-8.5 h-8.5 rounded object-cover flex-none" />
            ) : (
              <div className="w-8.5 h-8.5 rounded bg-panel-2 flex-none" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] truncate">{np.title}</div>
              <div className="text-xs text-muted truncate">{np.artist}</div>
              <div className="h-0.5 bg-[var(--rail)] rounded mt-1.5 overflow-hidden">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${np.duration_ms > 0 ? (pos / np.duration_ms) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div className="text-[13px] text-muted">{t('lobby.emptyQueue')}</div>
            <div className="text-xs text-accent">{t('lobby.firstSong')}</div>
          </div>
        )}
      </div>
    </button>
  );
}
