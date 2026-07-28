import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlayerInfo, RoomInfo, RoomPlayerInfo } from '../../api/types';
import { api } from '../../app/session';
import { formatDateTime } from '../format';
import { ConfirmDialog, Dialog, Select } from '../primitives';
import { useToast } from '../toast';

const primaryButtonClass =
  'rounded-full bg-accent px-4 py-1.5 text-[13px] font-medium text-on-accent hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40';
const secondaryButtonClass =
  'rounded-full border border-hairline px-4 py-1.5 text-[13px] text-muted hover:border-faint hover:text-paper disabled:cursor-not-allowed disabled:opacity-40';
const removeButtonClass =
  'rounded-full border border-hairline px-3 py-1 text-xs text-muted hover:border-[#D05A4E] hover:text-[#D05A4E] disabled:cursor-not-allowed disabled:opacity-40';
const inputClass =
  'mt-1.5 w-full rounded-md border border-hairline bg-panel px-3 py-2 text-[13px] placeholder:text-faint';

interface UnassignTarget {
  room: RoomInfo;
  player: RoomPlayerInfo;
}

type ConfirmAction =
  | { type: 'disable'; player: PlayerInfo }
  | { type: 'rotate'; player: PlayerInfo }
  | { type: 'delete'; player: PlayerInfo }
  | { type: 'unassign'; target: UnassignTarget };

export default function PlayerAdmin() {
  const { t } = useTranslation();
  const { show, showError } = useToast();
  const [players, setPlayers] = useState<PlayerInfo[] | null>(null);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [roomPlayers, setRoomPlayers] = useState<Map<string, RoomPlayerInfo[]>>(() => new Map());
  const [assignmentDrafts, setAssignmentDrafts] = useState<Map<string, string>>(() => new Map());
  const [busyPlayers, setBusyPlayers] = useState<Set<string>>(() => new Set());
  const [busyRooms, setBusyRooms] = useState<Set<string>>(() => new Set());
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newPlayerId, setNewPlayerId] = useState('');
  const [newPlayerName, setNewPlayerName] = useState('');
  const [creating, setCreating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<{ id: string; key: string } | null>(null);
  const [nameDrafts, setNameDrafts] = useState<Map<string, string>>(() => new Map());
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
      const nextVolumes = new Map(
        nextPlayers
          .filter((player) => player.online)
          .map((player) => [player.id, player.volume ?? 0]),
      );
      setPlayers(nextPlayers);
      setRooms(nextRooms);
      setRoomPlayers(new Map(roomPlayerEntries));
      setAssignmentDrafts((current) => {
        const next = new Map(nextRooms.map((room) => [room.id, current.get(room.id) ?? '']));
        return next;
      });
      setNameDrafts(new Map(nextPlayers.map((player) => [player.id, player.name])));
      setVolumes(nextVolumes);
      volumeDrafts.current = new Map(nextVolumes);
      sentVolumes.current = new Map(nextVolumes);
      setRevealedKey((current) =>
        current && nextPlayers.some((player) => player.id === current.id) ? current : null,
      );
    } catch (error: unknown) {
      setPlayers([]);
      setRooms([]);
      setRoomPlayers(new Map());
      setAssignmentDrafts(new Map());
      setNameDrafts(new Map());
      showError(error);
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void load();
  }, [load]);

  const roomById = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms]);
  const assignablePlayers = useMemo(() => players ?? [], [players]);
  const onlinePlayers = useMemo(
    () => (players ?? []).filter((player) => player.online),
    [players],
  );

  const setAssignmentDraft = (roomId: string, playerId: string) => {
    setAssignmentDrafts((current) => {
      const next = new Map(current);
      next.set(roomId, playerId);
      return next;
    });
  };

  const setNameDraft = (playerId: string, value: string) => {
    setNameDrafts((current) => {
      const next = new Map(current);
      next.set(playerId, value);
      return next;
    });
  };

  const withPlayerBusy = async (playerId: string, mutation: () => Promise<void>) => {
    if (busyPlayers.has(playerId)) return;
    setBusyPlayers((current) => new Set(current).add(playerId));
    try {
      await mutation();
      await load();
    } catch (error: unknown) {
      showError(error);
    } finally {
      setBusyPlayers((current) => {
        const next = new Set(current);
        next.delete(playerId);
        return next;
      });
    }
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

  const createPlayer = async () => {
    const id = newPlayerId.trim();
    const name = newPlayerName.trim();
    if (!id || !name || creating) return;
    setCreating(true);
    try {
      const result = await api.createPlayer({ id, name });
      setRevealedKey({ id: result.player.id, key: result.key });
      setCreateOpen(false);
      setNewPlayerId('');
      setNewPlayerName('');
      show(t('admin.players.created'));
      await load();
    } catch (error: unknown) {
      showError(error);
    } finally {
      setCreating(false);
    }
  };

  const renamePlayer = (player: PlayerInfo) => {
    const name = (nameDrafts.get(player.id) ?? player.name).trim();
    if (!name || name === player.name) return;
    void withPlayerBusy(player.id, async () => {
      await api.updatePlayer(player.id, { name });
      show(t('admin.players.renamed'));
    });
  };

  const togglePlayer = (player: PlayerInfo) => {
    void withPlayerBusy(player.id, async () => {
      await api.updatePlayer(player.id, { active: !player.active });
      show(player.active ? t('admin.players.disabled') : t('admin.players.enabled'));
    });
  };

  const rotatePlayerKey = (player: PlayerInfo) => {
    void withPlayerBusy(player.id, async () => {
      const result = await api.rotatePlayerKey(player.id);
      setRevealedKey({ id: result.player.id, key: result.key });
      show(t('admin.players.rotated'));
    });
  };

  const deletePlayer = (player: PlayerInfo) => {
    void withPlayerBusy(player.id, async () => {
      await api.deletePlayer(player.id);
      setRevealedKey((current) => (current?.id === player.id ? null : current));
      show(t('admin.players.deleted'));
    });
  };

  const assignPlayer = (room: RoomInfo) => {
    const playerId = assignmentDrafts.get(room.id) ?? '';
    if (!playerId) return;
    void withRoomBusy(room.id, async () => {
      await api.bindRoomPlayer(room.id, playerId);
      setAssignmentDraft(room.id, '');
      show(t('admin.players.assignmentSaved', { room: room.name }));
    });
  };

  const unassignPlayer = (target: UnassignTarget) => {
    void withRoomBusy(target.room.id, async () => {
      await api.unbindRoomPlayer(target.room.id, target.player.id);
      show(
        t('admin.players.assignmentRemoved', {
          player: target.player.name || target.player.device || target.player.id,
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
    if (!player.online || !player.caps.includes('volume')) return;
    const value = volumeDrafts.current.get(player.id) ?? player.volume ?? 0;
    const previous = sentVolumes.current.get(player.id) ?? player.volume ?? 0;
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
    if (!player.online || !player.caps.includes('mute') || mutingPlayers.has(player.id)) return;
    setMutingPlayers((current) => new Set(current).add(player.id));
    setPlayers(
      (current) =>
        current?.map((item) => (item.id === player.id ? { ...item, muted } : item)) ?? null,
    );
    try {
      await api.playerCommand(player.id, 'set_mute', muted);
    } catch (error: unknown) {
      setPlayers(
        (current) =>
          current?.map((item) =>
            item.id === player.id ? { ...item, muted: player.muted } : item,
          ) ?? null,
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

  const copyKey = async () => {
    if (!revealedKey) return;
    try {
      await navigator.clipboard.writeText(revealedKey.key);
      show(t('admin.players.keyCopied'));
    } catch (error: unknown) {
      showError(error);
    }
  };

  const confirmation = (() => {
    if (!confirmAction) return null;
    if (confirmAction.type === 'unassign') {
      return {
        title: t('admin.players.unassignTitle'),
        description: t('admin.players.unassignDescription', {
          player:
            confirmAction.target.player.name ||
            confirmAction.target.player.device ||
            confirmAction.target.player.id,
          room: confirmAction.target.room.name,
        }),
        confirmText: t('admin.players.assignmentRemove'),
      };
    }
    const player = confirmAction.player;
    if (confirmAction.type === 'disable') {
      return {
        title: t('admin.players.disableDialogTitle'),
        description: t('admin.players.disableDialogDescription', { name: player.name }),
        confirmText: t('admin.players.disableDialogConfirm'),
      };
    }
    if (confirmAction.type === 'rotate') {
      return {
        title: t('admin.players.rotateDialogTitle'),
        description: t('admin.players.rotateDialogDescription', { name: player.name }),
        confirmText: t('admin.players.rotateDialogConfirm'),
      };
    }
    return {
      title: t('admin.players.deleteDialogTitle'),
      description: t('admin.players.deleteDialogDescription', { name: player.name }),
      confirmText: t('admin.players.deleteDialogConfirm'),
    };
  })();

  return (
    <section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold">{t('admin.players.heading')}</h2>
          <p className="mt-1 text-sm text-muted">{t('admin.players.intro')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setCreateOpen(true)} className={primaryButtonClass}>
            {t('admin.players.newPlayer')}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className={secondaryButtonClass}
          >
            {loading ? t('admin.common.working') : t('admin.common.refresh')}
          </button>
        </div>
      </div>

      {revealedKey && (
        <div className="mb-5 rounded-md border border-[#D7A94A]/40 bg-[#D7A94A]/8 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-paper">
                {t('admin.players.keyOnce', { id: revealedKey.id })}
              </p>
              <p className="mt-1 text-xs text-muted">{t('admin.players.keyWarning')}</p>
            </div>
            <button type="button" onClick={() => void copyKey()} className={secondaryButtonClass}>
              {t('admin.players.copyKey')}
            </button>
          </div>
          <code className="mt-3 block select-all break-all rounded bg-canvas px-3 py-2 text-xs text-paper">
            {revealedKey.key}
          </code>
        </div>
      )}

      <section className="rounded-md border border-hairline bg-panel">
        <header className="border-b border-hairline px-4 py-3.5">
          <h3 className="font-display text-lg font-semibold">{t('admin.players.registryTitle')}</h3>
          <p className="mt-0.5 text-xs text-muted">{t('admin.players.registryIntro')}</p>
        </header>
        {players === null ? (
          <p className="py-8 text-center text-sm text-faint">{t('common.loading')}</p>
        ) : players.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-faint">{t('admin.players.empty')}</p>
        ) : (
          <div className="divide-y divide-hairline">
            {players.map((player) => {
              const busy = busyPlayers.has(player.id);
              const nameDraft = nameDrafts.get(player.id) ?? player.name;
              const canEnable = player.key_configured || player.active;
              return (
                <div
                  key={player.id}
                  className="grid gap-4 px-4 py-4 xl:grid-cols-[minmax(220px,1fr)_minmax(260px,1.2fr)_auto] xl:items-end"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium text-paper">{player.name}</div>
                      <span
                        className={`text-[10px] ${
                          player.active ? 'text-accent' : 'text-faint'
                        }`}
                      >
                        {player.active
                          ? t('admin.players.statusActive')
                          : t('admin.players.statusDisabled')}
                      </span>
                      <span
                        className={`text-[10px] ${
                          player.online ? 'text-accent' : 'text-faint'
                        }`}
                      >
                        {player.online
                          ? t('admin.players.assignmentOnline')
                          : t('admin.players.assignmentOffline')}
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-faint">{player.id}</div>
                    <div className="mt-1 text-xs text-muted">
                      {player.room_id
                        ? roomById.get(player.room_id)?.name ?? player.room_id
                        : t('admin.players.noRoom')}
                      {player.device ? ` · ${player.device}` : ''}
                    </div>
                    {!player.key_configured && (
                      <div className="mt-1 text-[11px] text-[#D7A94A]">
                        {t('admin.players.keyMissing')}
                      </div>
                    )}
                  </div>

                  <label className="block text-xs text-muted">
                    {t('admin.players.playerName')}
                    <input
                      value={nameDraft}
                      onChange={(event) => setNameDraft(player.id, event.target.value)}
                      className={inputClass}
                    />
                  </label>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busy || !nameDraft.trim() || nameDraft.trim() === player.name}
                      onClick={() => renamePlayer(player)}
                      className={secondaryButtonClass}
                    >
                      {t('admin.players.rename')}
                    </button>
                    <button
                      type="button"
                      disabled={busy || (!player.active && !canEnable)}
                      title={
                        !player.active && !player.key_configured
                          ? t('admin.players.enableBlocked')
                          : undefined
                      }
                      onClick={() => {
                        if (player.active) setConfirmAction({ type: 'disable', player });
                        else togglePlayer(player);
                      }}
                      className={secondaryButtonClass}
                    >
                      {player.active ? t('admin.players.disable') : t('admin.players.enable')}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmAction({ type: 'rotate', player })}
                      className={secondaryButtonClass}
                    >
                      {t('admin.players.rotateKey')}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmAction({ type: 'delete', player })}
                      className={removeButtonClass}
                    >
                      {t('admin.players.delete')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-5 rounded-md border border-hairline bg-panel">
        <header className="border-b border-hairline px-4 py-3.5">
          <h3 className="font-display text-lg font-semibold">{t('admin.players.assignmentTitle')}</h3>
          <p className="mt-0.5 text-xs text-muted">{t('admin.players.assignmentIntro')}</p>
        </header>
        {players === null ? (
          <p className="py-8 text-center text-sm text-faint">{t('common.loading')}</p>
        ) : rooms.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-faint">
            {t('admin.players.assignmentRoomsEmpty')}
          </p>
        ) : (
          <div className="divide-y divide-hairline">
            {rooms.map((room) => {
              const assignedPlayers = (roomPlayers.get(room.id) ?? []).filter(
                (player) => player.bound,
              );
              const assignedIds = new Set(assignedPlayers.map((player) => player.id));
              const draft = assignmentDrafts.get(room.id) ?? '';
              const busy = busyRooms.has(room.id);
              const options = assignablePlayers
                .filter((player) => !assignedIds.has(player.id))
                .map((player) => ({
                  value: player.id,
                  label: `${player.name} · ${player.id}${player.online ? '' : ` · ${t('admin.players.assignmentOffline')}`}`,
                }));
              return (
                <div
                  key={room.id}
                  className="grid gap-4 px-4 py-4 xl:grid-cols-[minmax(180px,0.7fr)_minmax(320px,1.5fr)_minmax(300px,1fr)] xl:items-start"
                >
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
                        <div
                          key={player.id}
                          className="flex h-11 items-center gap-3 rounded-md border border-hairline bg-panel-2 px-3"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <span className="truncate text-sm font-medium text-paper">
                              {player.name || player.device || player.id}
                            </span>
                            <span className="truncate font-mono text-[10px] text-faint">
                              {player.id}
                            </span>
                            <span
                              className={`shrink-0 ${
                                player.online
                                  ? 'text-[10px] text-accent'
                                  : 'text-[10px] text-faint'
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
                            onClick={() => setConfirmAction({ type: 'unassign', target: { room, player } })}
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
          <p className="mt-0.5 text-xs text-muted">{t('admin.players.onlineIntro')}</p>
        </div>
        {players === null ? (
          <p className="py-10 text-center text-sm text-faint">{t('common.loading')}</p>
        ) : onlinePlayers.length === 0 ? (
          <p className="rounded-md border border-dashed border-hairline bg-panel px-4 py-10 text-center text-sm text-faint">
            {t('admin.players.onlineEmpty')}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-hairline bg-panel">
            <table className="w-full min-w-[900px] border-collapse text-left text-[13px]">
              <thead className="bg-panel-2 text-[11px] uppercase tracking-[0.08em] text-faint">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('admin.players.device')}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.players.player')}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.players.currentRoom')}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.players.volume')}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.players.sound')}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.players.connectedAt')}</th>
                </tr>
              </thead>
              <tbody>
                {onlinePlayers.map((player) => {
                  const canVolume = player.caps.includes('volume');
                  const canMute = player.caps.includes('mute');
                  const volume = volumes.get(player.id) ?? player.volume ?? 0;
                  const label = player.device || player.name;
                  return (
                    <tr key={player.id} className="border-t border-hairline align-middle">
                      <td className="px-3 py-3">
                        <div className="font-medium">{player.device || player.name}</div>
                        <div className="font-mono text-[10px] text-faint">{player.id}</div>
                        <div className="mt-0.5 font-mono text-[10px] text-faint">
                          {player.version
                            ? t('admin.players.version', { version: player.version })
                            : t('admin.players.versionUnknown')}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-muted">{player.name}</td>
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
                            onChange={(event) =>
                              updateVolumeDraft(player.id, Number(event.target.value))
                            }
                            onPointerUp={() => commitVolume(player)}
                            onBlur={() => commitVolume(player)}
                            aria-label={t('admin.players.volumeFor', { device: label })}
                            title={!canVolume ? t('admin.players.volumeUnsupported') : undefined}
                            className="min-w-0 flex-1 accent-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-35"
                          />
                          <span className="w-8 text-right font-mono text-xs tabular-nums text-muted">
                            {volume}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={!player.muted}
                          aria-label={t('admin.players.soundFor', { device: label })}
                          title={!canMute ? t('admin.players.muteUnsupported') : undefined}
                          disabled={!canMute || mutingPlayers.has(player.id)}
                          onClick={() => void setMuted(player, !player.muted)}
                          className={`relative h-5 w-9 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                            player.muted
                              ? 'border border-hairline bg-[var(--rail)]'
                              : 'bg-accent'
                          }`}
                        >
                          <span
                            className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-[left,background-color] ${
                              player.muted
                                ? 'left-[3px] bg-muted'
                                : 'left-[19px] bg-on-accent'
                            }`}
                          />
                        </button>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs tabular-nums text-muted">
                        {player.connected_at ? formatDateTime(player.connected_at) : t('admin.common.none')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t('admin.players.createDialogTitle')}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void createPlayer();
          }}
        >
          <label className="block text-xs text-muted">
            {t('admin.players.playerId')}
            <input
              required
              value={newPlayerId}
              onChange={(event) => setNewPlayerId(event.target.value)}
              placeholder={t('admin.players.playerIdPlaceholder')}
              className={inputClass}
            />
          </label>
          <label className="mt-4 block text-xs text-muted">
            {t('admin.players.playerName')}
            <input
              required
              value={newPlayerName}
              onChange={(event) => setNewPlayerName(event.target.value)}
              placeholder={t('admin.players.playerNamePlaceholder')}
              className={inputClass}
            />
          </label>
          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              disabled={creating}
              onClick={() => setCreateOpen(false)}
              className={secondaryButtonClass}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={creating || !newPlayerId.trim() || !newPlayerName.trim()}
              className={primaryButtonClass}
            >
              {creating ? t('admin.common.working') : t('admin.players.create')}
            </button>
          </div>
        </form>
      </Dialog>

      {confirmation && (
        <ConfirmDialog
          open={confirmAction !== null}
          onOpenChange={(open) => {
            if (!open) setConfirmAction(null);
          }}
          title={confirmation.title}
          description={confirmation.description}
          confirmText={confirmation.confirmText}
          cancelText={t('common.cancel')}
          danger
          onConfirm={() => {
            const action = confirmAction;
            setConfirmAction(null);
            if (!action) return;
            if (action.type === 'unassign') unassignPlayer(action.target);
            if (action.type === 'disable') togglePlayer(action.player);
            if (action.type === 'rotate') rotatePlayerKey(action.player);
            if (action.type === 'delete') deletePlayer(action.player);
          }}
        />
      )}
    </section>
  );
}
