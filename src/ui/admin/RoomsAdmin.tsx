/**
 * 房间治理（/admin）：建删房间 + 单房管理（策略/访问/授权/输出/历史）。
 * 自大厅陈列页与房间内管理面板迁入——房间对普通用户是「设备」，
 * 治理动作收敛到管理页。电台开停留在播放器侧（队列抽屉的电台面板）。
 */
import { useEffect, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import type { RoomAccessMode, RoomInfo } from '../../api/types';
import { api } from '../../app/session';
import { ConfirmDialog, Dialog, Select } from '../primitives';
import { RoomAdminPanel } from '../RoomAdminPanel';
import { useToast } from '../toast';

export default function RoomsAdmin(): JSX.Element {
  const { t } = useTranslation();
  const { show, showError } = useToast();
  const [rooms, setRooms] = useState<RoomInfo[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RoomInfo | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    setFailed(false);
    api.listRooms().then(setRooms).catch(() => setFailed(true));
  };

  useEffect(load, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] tracking-[0.14em] text-faint">
          {t('roomsAdmin.count', { count: rooms?.length ?? 0 })}
        </span>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="rounded-full bg-accent px-4 py-1.5 text-[13px] font-medium text-on-accent hover:brightness-105"
        >
          {t('lobby.createRoom')}
        </button>
      </div>

      {rooms === null && !failed && <p className="text-muted">{t('common.loading')}</p>}
      {failed && (
        <div className="text-muted">
          {t('error.internal')}
          <button onClick={load} className="ml-3 text-accent">
            {t('common.retry')}
          </button>
        </div>
      )}
      {rooms?.length === 0 && (
        <p className="rounded-md border border-dashed border-hairline bg-panel px-4 py-10 text-center text-sm text-faint">
          {t('roomsAdmin.empty')}
        </p>
      )}

      {(rooms ?? []).map((room) => (
        <div key={room.id} className="rounded-lg border border-hairline bg-panel">
          <div className="flex items-center gap-3 px-4.5 py-3.5">
            <button
              type="button"
              onClick={() => setSelectedId(selectedId === room.id ? null : room.id)}
              className="min-w-0 flex-1 text-left"
            >
              <span className="font-display text-[15px] font-semibold">{room.name}</span>
              <span className="ml-3 text-xs text-muted">
                {t('lobby.listenerCount', { count: room.listener_count })}
              </span>
              <span className="ml-2 text-xs text-faint">
                {t(
                  room.guest_access.mode === 'static_password'
                    ? 'lobby.accessBadgeStatic'
                    : room.guest_access.mode === 'rotating_code'
                      ? 'lobby.accessBadgeRotating'
                      : 'lobby.accessBadgeOpen',
                )}
              </span>
            </button>
            <button
              type="button"
              aria-label={t('lobby.deleteRoom', { name: room.name })}
              onClick={() => setDeleteTarget(room)}
              className="grid h-7 w-7 flex-none place-items-center rounded-full text-lg leading-none text-faint hover:border hover:border-hairline hover:bg-panel-2 hover:text-paper"
            >
              ×
            </button>
          </div>
          {selectedId === room.id && (
            <div className="border-t border-hairline px-4.5 pb-4">
              <RoomAdminPanel roomId={room.id} canManagePolicy requesterNames={new Map()} />
            </div>
          )}
        </div>
      ))}

      <CreateRoomDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={load} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t('lobby.deleteRoomTitle')}
        description={t('lobby.deleteRoomDescription', { name: deleteTarget?.name ?? '' })}
        confirmText={deleting ? t('lobby.deletingRoom') : t('lobby.deleteRoomConfirm')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => {
          if (!deleteTarget || deleting) return;
          setDeleting(true);
          void api
            .deleteRoom(deleteTarget.id)
            .then(() => {
              show(t('lobby.roomDeleted', { name: deleteTarget.name }));
              setDeleteTarget(null);
              if (selectedId === deleteTarget.id) setSelectedId(null);
              load();
            })
            .catch(showError)
            .finally(() => setDeleting(false));
        }}
      />
    </div>
  );
}

function CreateRoomDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const { show, showError } = useToast();
  const [roomId, setRoomId] = useState('');
  const [name, setName] = useState('');
  const [accessMode, setAccessMode] = useState<RoomAccessMode>('open');
  const [guestPassword, setGuestPassword] = useState('');
  const [codePeriodHours, setCodePeriodHours] = useState('24');
  const [trustedRoles, setTrustedRoles] = useState('');
  const [creating, setCreating] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('lobby.createRoomTitle')}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const trimmedName = name.trim();
          if (!trimmedName || creating) return;
          if (accessMode === 'static_password' && !guestPassword) return;
          const periodHours = Math.max(1, Math.floor(Number(codePeriodHours) || 24));
          setCreating(true);
          void api
            .createRoom({
              id: roomId.trim() || undefined,
              name: trimmedName,
              guest_access_mode: accessMode,
              guest_password: accessMode === 'static_password' ? guestPassword : undefined,
              guest_code_period_seconds:
                accessMode === 'rotating_code' ? periodHours * 3600 : undefined,
              trusted_roles: trustedRoles
                .split(',')
                .map((role) => role.trim())
                .filter(Boolean),
            })
            .then(() => {
              show(t('lobby.roomCreated', { name: trimmedName }));
              onOpenChange(false);
              setRoomId('');
              setName('');
              setAccessMode('open');
              setGuestPassword('');
              setCodePeriodHours('24');
              setTrustedRoles('');
              onCreated();
            })
            .catch(showError)
            .finally(() => setCreating(false));
        }}
      >
        <label className="block text-xs text-muted">
          {t('lobby.roomId')}
          <input
            value={roomId}
            onChange={(event) => setRoomId(event.target.value)}
            placeholder={t('lobby.roomIdPlaceholder')}
            className="mt-1.5 w-full rounded-md border border-hairline bg-panel px-3 py-2 text-[13px] placeholder:text-faint"
          />
        </label>
        <label className="mt-4 block text-xs text-muted">
          {t('lobby.roomName')}
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('lobby.roomNamePlaceholder')}
            className="mt-1.5 w-full rounded-md border border-hairline bg-panel px-3 py-2 text-[13px] placeholder:text-faint"
          />
        </label>
        <div className="mt-4">
          <span className="block text-xs text-muted">{t('lobby.accessMode')}</span>
          <Select
            value={accessMode}
            onValueChange={(value) => setAccessMode(value as RoomAccessMode)}
            options={[
              { value: 'open', label: t('lobby.accessModeOpen') },
              { value: 'static_password', label: t('lobby.accessModeStatic') },
              { value: 'rotating_code', label: t('lobby.accessModeRotating') },
            ]}
            ariaLabel={t('lobby.accessMode')}
            className="mt-1.5 w-full"
          />
        </div>
        {accessMode === 'static_password' && (
          <label className="mt-4 block text-xs text-muted">
            {t('lobby.guestPassword')}
            <input
              type="password"
              required
              value={guestPassword}
              onChange={(event) => setGuestPassword(event.target.value)}
              placeholder={t('lobby.guestPasswordRequiredPlaceholder')}
              className="mt-1.5 w-full rounded-md border border-hairline bg-panel px-3 py-2 text-[13px] placeholder:text-faint"
            />
          </label>
        )}
        {accessMode === 'rotating_code' && (
          <label className="mt-4 block text-xs text-muted">
            {t('lobby.codePeriodHours')}
            <input
              type="number"
              min={1}
              max={720}
              step={1}
              value={codePeriodHours}
              onChange={(event) => setCodePeriodHours(event.target.value)}
              className="mt-1.5 w-full rounded-md border border-hairline bg-panel px-3 py-2 text-[13px] tabular-nums"
            />
            <span className="mt-1 block text-[11px] text-faint">{t('lobby.codePeriodHint')}</span>
          </label>
        )}
        <label className="mt-4 block text-xs text-muted">
          {t('lobby.trustedRoles')}
          <input
            value={trustedRoles}
            onChange={(event) => setTrustedRoles(event.target.value)}
            placeholder={t('lobby.trustedRolesPlaceholder')}
            className="mt-1.5 w-full rounded-md border border-hairline bg-panel px-3 py-2 text-[13px] placeholder:text-faint"
          />
          <span className="mt-1 block text-[11px] text-faint">{t('lobby.trustedRolesHint')}</span>
        </label>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            disabled={creating}
            onClick={() => onOpenChange(false)}
            className="rounded-full border border-hairline px-4 py-1.5 text-sm text-muted hover:border-faint hover:text-paper disabled:opacity-40"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={
              creating || !name.trim() || (accessMode === 'static_password' && !guestPassword)
            }
            className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-on-accent hover:brightness-105 disabled:opacity-40"
          >
            {creating ? t('lobby.creatingRoom') : t('lobby.createRoomConfirm')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
