import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { RoomInfo } from '../api/types';
import { api } from '../app/session';
import ThemeControls from './ThemeControls';

export default function LobbyView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
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
          <button
            key={room.id}
            onClick={() => navigate(`/room/${encodeURIComponent(room.id)}`)}
            className="text-left bg-panel border border-hairline rounded-md p-4.5 hover:border-faint hover:bg-panel-2 transition-colors cursor-pointer"
          >
            <h2 className="font-display text-xl font-semibold">{room.name}</h2>
            <div className="text-xs text-muted mt-1 font-mono">{room.id}</div>
          </button>
        ))}
        {rooms?.length === 0 && <p className="text-muted">{t('lobby.noRooms')}</p>}
      </div>
    </div>
  );
}
