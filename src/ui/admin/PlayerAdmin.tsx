import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlayerInfo, RoomInfo, RoomPlayerInfo } from '../../api/types';
import { api } from '../../app/session';
import { formatDateTime } from '../format';
import { ConfirmDialog, Select } from '../primitives';
import { useToast } from '../toast';

const primaryButtonClass =
  'rounded-full bg-accent px-4 py-1.5 text-[13px] font-medium text-on-accent hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40';
const secondaryButtonClass =
  'rounded-full border border-hairline px-4 py-1.5 text-[13px] text-muted hover:border-faint hover:text-paper disabled:cursor-not-allowed disabled:opacity-40';
const removeButtonClass =
  'rounded-full border border-hairline px-3 py-1 text-xs text-muted hover:border-[#D05A4E] hover:text-[#D05A4E] disabled:cursor-not-allowed disabled:opacity-40';

interface UnassignTarget {
  room: RoomInfo;
  player: RoomPlayerInfo;
}

export default function PlayerAdmin() {
  const { t } = useTranslation();
  const { show, showError } = useToast();
  const [players, setPlayers] = useState<PlayerInfo[] | null>(null);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [roomPlayers, setRoomPlayers] = useState<Map<string, RoomPlayerInfo[]>>(() => new Map());
  const [assignmentDrafts, setAssignmentDrafts] = useState<Map<string, string>>(() => new Map());
  const [busyRooms, setBusyRooms] = useState<Set<string>>(() => new Set());
  const [unassignTarget, setUnassignTarget] = useState<UnassignTarget | null>(null);
  const [loading, setLoading] = useState(false);
  const [volumes, setVolumes] = useState<Map<string, number>>(() => new Map());
  const [mutingPlayers, setMutingPlayers] = useState<Set<string>>(() => new Set());
  const volumeDrafts = useRef(new Map<string, number>());
  const sentVolumes = useRef(new Map<string, number>());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextPlayers, nextRooms] = await Promise.all([api.listPlayers(), api.listRooms()]);
      const roomPlayerEntries = await Promise.all(
        nextRooms.map(async (room) => [room.id, await api.roomPlayers(room.id)] as const),
      );
      const nextVolumes = new Map(nextPlayers.map((player) => [player.id, player.volume]));
      setPlayers(nextPlayers);
      setRooms(nextRooms);
      setRoomPlayers(new Map(roomPlayerEntries));
      setAssignmentDrafts(new Map(nextRooms.map((room) => [room.id, ''])));
      setVolumes(nextVolumes);
      volumeDrafts.current = new Map(nextVolumes);
      sentVolumes.current = new Map(nextVolumes);
    } catch (error: unknown) {
      setPlayers([]);
      setRooms([]);
      setRoomPlayers(new Map());
      setAssignmentDrafts(new Map());
      showError(error);
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void load();
  }, [load]);

  const roomById = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms]);
  const bindablePlayers = useMemo(
    () => (players ?? []).filter((player) => player.caps.includes('volume')),
    [players],
  );

  const setAssignmentDraft = (roomId: string, playerId: string) => {
    setAssignmentDrafts((current) => {
      const next = new Map(current);
      next.set(roomId, playerId);
      return next;
    });
  };

  const withRoomBusy = async (roomId: string, mutation: () => Promise<void>) => {
    if (busyRooms.has(roomId)) return;
    setBusyRooms((current) => new Set(current).add(roomId));
    try {
      await mutation();
      await load();
    } catch (error: unknown) {
      showError(error);
    } finally {
      setBusyRooms((current) => {
        const next = new Set(current);
        next.delete(roomId);
        return next;
      });
    }
  };

  const assignPlayer = (room: RoomInfo) => {
    const playerId = assignmentDrafts.get(room.id) ?? '';
    if (!playerId) return;
    void withRoomBusy(room.id, async () => {
      await api.bindRoomPlayer(room.id, playerId);
      show(t('admin.players.assignmentSaved', { room: room.name }));
    });
  };

  const unassignPlayer = (target: UnassignTarget) => {
    setUnassignTarget(null);
    void withRoomBusy(target.room.id, async () => {
      await api.unbindRoomPlayer(target.room.id, target.player.id);
      show(
        t('admin.players.assignmentRemoved', {
          player: target.player.device || target.player.id,
          room: target.room.name,
        }),
      );
    });
  };

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

      <section className="rounded-md border border-hairline bg-panel">
        <header className="border-b border-hairline px-4 py-3.5">
          <h3 className="font-display text-lg font-semibold">{t('admin.players.assignmentTitle')}</h3>
          <p className="mt-0.5 text-xs text-muted">{t('admin.players.assignmentIntro')}</p>
        </header>
        {players === null ? (
          <p className="py-8 text-center text-sm text-faint">{t('common.loading')}</p>
        ) : rooms.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-faint">{t('admin.players.assignmentRoomsEmpty')}</p>
        ) : (
          <div className="divide-y divide-hairline">
            {rooms.map((room) => {
              const assignedPlayers = (roomPlayers.get(room.id) ?? []).filter((player) => player.bound);
              const assignedIds = new Set(assignedPlayers.map((player) => player.id));
              const draft = assignmentDrafts.get(room.id) ?? '';
              const busy = busyRooms.has(room.id);
              const options = bindablePlayers
                .filter((player) => !assignedIds.has(player.id))
                .map((player) => ({
                  value: player.id,
                  label: `${player.device} · ${player.id}`,
                }));
              return (
                <div key={room.id} className="grid gap-4 px-4 py-4 xl:grid-cols-[minmax(180px,0.7fr)_minmax(320px,1.5fr)_minmax(300px,1fr)] xl:items-start">
                  <div>
                    <div className="font-medium text-paper">{room.name}</div>
                    <div className="font-mono text-[10px] text-faint">{room.id}</div>
                  </div>

                  <div className="grid gap-2">
                    {assignedPlayers.length === 0 ? (
                      <p className="flex min-h-11 items-center rounded-md border border-dashed border-hairline px-3 py-2.5 text-xs text-faint">
                        {t('admin.players.assignmentNone')}
                      </p>
                    ) : (
                      assignedPlayers.map((player) => (
                        <div key={player.id} className="flex h-11 items-center gap-3 rounded-md border border-hairline bg-panel-2 px-3">
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <span className="truncate text-sm font-medium text-paper">{player.device || player.id}</span>
                            {player.device && player.device !== player.id && (
                              <span className="truncate font-mono text-[10px] text-faint">{player.id}</span>
                            )}
                            <span
                              className={`shrink-0 ${
                                player.online ? 'text-[10px] text-accent' : 'text-[10px] text-faint'
                              }`}
                            >
                              {player.online
                                ? t('admin.players.assignmentOnline')
                                : t('admin.players.assignmentOffline')}
                            </span>
                          </div>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setUnassignTarget({ room, player })}
                            className={removeButtonClass}
                          >
                            {t('admin.players.assignmentRemove')}
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="flex h-11 items-center gap-2">
                    <Select
                      value={draft}
                      onValueChange={(value) => setAssignmentDraft(room.id, value)}
                      options={options}
                      placeholder={
                        options.length === 0
                          ? t('admin.players.assignmentNoCandidates')
                          : t('admin.players.assignmentPlaceholder')
                      }
                      ariaLabel={t('admin.players.assignmentFor', { room: room.name })}
                      className="h-11 min-w-0 flex-1"
                    />
                    <button
                      type="button"
                      disabled={!draft || busy}
                      onClick={() => assignPlayer(room)}
                      className={`${primaryButtonClass} h-11`}
                    >
                      {busy ? t('admin.common.working') : t('admin.players.assignmentAdd')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-5">
        <div className="mb-3">
          <h3 className="font-display text-lg font-semibold">{t('admin.players.onlineTitle')}</h3>
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
                  <th className="px-3 py-2 font-medium">{t('admin.players.currentRoom')}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.players.volume')}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.players.sound')}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.players.connectedAt')}</th>
                </tr>
              </thead>
              <tbody>
                {players.map((player) => {
                  const canVolume = player.caps.includes('volume');
                  const canMute = player.caps.includes('mute');
                  const volume = volumes.get(player.id) ?? player.volume;
                  return (
                    <tr key={player.id} className="border-t border-hairline align-middle">
                      <td className="px-3 py-3">
                        <div className="font-medium">{player.device}</div>
                        <div className="font-mono text-[10px] text-faint">{player.id}</div>
                        <div className="mt-0.5 font-mono text-[10px] text-faint">
                          {player.version
                            ? t('admin.players.version', { version: player.version })
                            : t('admin.players.versionUnknown')}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-muted">{player.identity_name}</td>
                      <td className="px-3 py-3 text-muted">
                        {player.room_id
                          ? roomById.get(player.room_id)?.name ?? player.room_id
                          : t('admin.players.noRoom')}
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
                          aria-checked={!player.muted}
                          aria-label={t('admin.players.soundFor', { device: player.device })}
                          title={!canMute ? t('admin.players.muteUnsupported') : undefined}
                          disabled={!canMute || mutingPlayers.has(player.id)}
                          onClick={() => void setMuted(player, !player.muted)}
                          className={`relative h-5 w-9 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                            player.muted ? 'border border-hairline bg-[var(--rail)]' : 'bg-accent'
                          }`}
                        >
                          <span
                            className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-[left,background-color] ${
                              player.muted ? 'left-[3px] bg-muted' : 'left-[19px] bg-on-accent'
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

      <ConfirmDialog
        open={unassignTarget !== null}
        onOpenChange={(open) => {
          if (!open) setUnassignTarget(null);
        }}
        title={t('admin.players.unassignTitle')}
        description={
          unassignTarget
            ? t('admin.players.unassignDescription', {
                player: unassignTarget.player.device || unassignTarget.player.id,
                room: unassignTarget.room.name,
              })
            : undefined
        }
        confirmText={t('admin.players.assignmentRemove')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => {
          if (unassignTarget) unassignPlayer(unassignTarget);
        }}
      />
    </section>
  );
}
