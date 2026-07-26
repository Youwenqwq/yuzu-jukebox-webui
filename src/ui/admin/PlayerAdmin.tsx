import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlayerInfo, RoomInfo } from '../../api/types';
import { api } from '../../app/session';
import { formatDateTime } from '../format';
import { Select } from '../primitives';
import { useToast } from '../toast';

const secondaryButtonClass =
  'rounded-full border border-hairline px-4 py-1.5 text-[13px] text-muted hover:border-faint hover:text-paper disabled:cursor-not-allowed disabled:opacity-40';

export default function PlayerAdmin() {
  const { t } = useTranslation();
  const { showError } = useToast();
  const [players, setPlayers] = useState<PlayerInfo[] | null>(null);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [volumes, setVolumes] = useState<Map<string, number>>(() => new Map());
  const [mutingPlayers, setMutingPlayers] = useState<Set<string>>(() => new Set());
  const [joiningPlayers, setJoiningPlayers] = useState<Set<string>>(() => new Set());
  const volumeDrafts = useRef(new Map<string, number>());
  const sentVolumes = useRef(new Map<string, number>());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextPlayers, nextRooms] = await Promise.all([api.listPlayers(), api.listRooms()]);
      const nextVolumes = new Map(nextPlayers.map((player) => [player.id, player.volume]));
      setPlayers(nextPlayers);
      setRooms(nextRooms);
      setVolumes(nextVolumes);
      volumeDrafts.current = new Map(nextVolumes);
      sentVolumes.current = new Map(nextVolumes);
    } catch (error: unknown) {
      setPlayers([]);
      showError(error);
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateVolumeDraft = (playerId: string, value: number) => {
    volumeDrafts.current.set(playerId, value);
    setVolumes((current) => {
      const next = new Map(current);
      next.set(playerId, value);
      return next;
    });
  };

  const commitVolume = (player: PlayerInfo) => {
    if (!player.caps.includes('volume')) return;
    const value = volumeDrafts.current.get(player.id) ?? player.volume;
    const previous = sentVolumes.current.get(player.id) ?? player.volume;
    if (value === previous) return;
    sentVolumes.current.set(player.id, value);
    void api.playerCommand(player.id, 'set_volume', value).catch((error: unknown) => {
      sentVolumes.current.set(player.id, previous);
      volumeDrafts.current.set(player.id, previous);
      setVolumes((current) => {
        const next = new Map(current);
        next.set(player.id, previous);
        return next;
      });
      showError(error);
    });
  };

  const setMuted = async (player: PlayerInfo, muted: boolean) => {
    if (!player.caps.includes('mute') || mutingPlayers.has(player.id)) return;
    setMutingPlayers((current) => new Set(current).add(player.id));
    setPlayers((current) =>
      current?.map((item) => (item.id === player.id ? { ...item, muted } : item)) ?? null,
    );
    try {
      await api.playerCommand(player.id, 'set_mute', muted);
    } catch (error: unknown) {
      setPlayers((current) =>
        current?.map((item) => (item.id === player.id ? { ...item, muted: player.muted } : item)) ?? null,
      );
      showError(error);
    } finally {
      setMutingPlayers((current) => {
        const next = new Set(current);
        next.delete(player.id);
        return next;
      });
    }
  };

  const joinRoom = async (player: PlayerInfo, roomId: string) => {
    if (!player.caps.includes('join_room') || joiningPlayers.has(player.id)) return;
    setJoiningPlayers((current) => new Set(current).add(player.id));
    setPlayers((current) =>
      current?.map((item) => (item.id === player.id ? { ...item, room_id: roomId } : item)) ?? null,
    );
    try {
      await api.playerCommand(player.id, 'join_room', roomId);
    } catch (error: unknown) {
      setPlayers((current) =>
        current?.map((item) => (item.id === player.id ? { ...item, room_id: player.room_id } : item)) ?? null,
      );
      showError(error);
    } finally {
      setJoiningPlayers((current) => {
        const next = new Set(current);
        next.delete(player.id);
        return next;
      });
    }
  };

  return (
    <section>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold">{t('admin.players.heading')}</h2>
          <p className="mt-1 text-sm text-muted">{t('admin.players.intro')}</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className={secondaryButtonClass}>
          {loading ? t('admin.common.working') : t('admin.common.refresh')}
        </button>
      </div>

      {players === null ? (
        <p className="py-10 text-center text-sm text-faint">{t('common.loading')}</p>
      ) : players.length === 0 ? (
        <p className="rounded-md border border-dashed border-hairline bg-panel px-4 py-10 text-center text-sm text-faint">
          {t('admin.players.empty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-hairline bg-panel">
          <table className="w-full min-w-[900px] border-collapse text-left text-[13px]">
            <thead className="bg-panel-2 text-[11px] uppercase tracking-[0.08em] text-faint">
              <tr>
                <th className="px-3 py-2 font-medium">{t('admin.players.device')}</th>
                <th className="px-3 py-2 font-medium">{t('admin.players.identity')}</th>
                <th className="px-3 py-2 font-medium">{t('admin.players.room')}</th>
                <th className="px-3 py-2 font-medium">{t('admin.players.volume')}</th>
                <th className="px-3 py-2 font-medium">{t('admin.players.muted')}</th>
                <th className="px-3 py-2 font-medium">{t('admin.players.connectedAt')}</th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => {
                const canVolume = player.caps.includes('volume');
                const canMute = player.caps.includes('mute');
                const canJoin = player.caps.includes('join_room');
                const volume = volumes.get(player.id) ?? player.volume;
                return (
                  <tr key={player.id} className="border-t border-hairline align-middle">
                    <td className="px-3 py-3">
                      <div className="font-medium">{player.device}</div>
                      <div className="font-mono text-[10px] text-faint">
                        {player.version
                          ? t('admin.players.version', { version: player.version })
                          : t('admin.players.versionUnknown')}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted">{player.identity_name}</td>
                    <td className="px-3 py-3">
                      <fieldset
                        disabled={!canJoin || joiningPlayers.has(player.id)}
                        title={!canJoin ? t('admin.players.joinUnsupported') : undefined}
                        className="m-0 border-0 p-0 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Select
                          value={player.room_id ?? ''}
                          onValueChange={(roomId) => void joinRoom(player, roomId)}
                          options={rooms.map((room) => ({ value: room.id, label: room.name }))}
                          placeholder={t('admin.players.noRoom')}
                          className="min-w-36"
                        />
                      </fieldset>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex min-w-44 items-center gap-2">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={volume}
                          disabled={!canVolume}
                          onChange={(event) => updateVolumeDraft(player.id, Number(event.target.value))}
                          onPointerUp={() => commitVolume(player)}
                          onBlur={() => commitVolume(player)}
                          aria-label={t('admin.players.volumeFor', { device: player.device })}
                          title={!canVolume ? t('admin.players.volumeUnsupported') : undefined}
                          className="min-w-0 flex-1 accent-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-35"
                        />
                        <span className="w-8 text-right font-mono text-xs tabular-nums text-muted">{volume}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={player.muted}
                        aria-label={t('admin.players.muteFor', { device: player.device })}
                        title={!canMute ? t('admin.players.muteUnsupported') : undefined}
                        disabled={!canMute || mutingPlayers.has(player.id)}
                        onClick={() => void setMuted(player, !player.muted)}
                        className={`relative h-5 w-9 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                          player.muted ? 'border-accent bg-accent' : 'border-hairline bg-[var(--rail)]'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-transform ${
                            player.muted
                              ? 'translate-x-[17px] bg-on-accent'
                              : 'translate-x-0.5 bg-muted'
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs tabular-nums text-muted">
                      {formatDateTime(player.connected_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
