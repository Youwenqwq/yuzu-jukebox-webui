import { useEffect, useReducer, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { RoomAccessMode, RoomInfo } from '../api/types';
import { api, client, session } from '../app/session';
import { useIdentity } from './hooks';
import ExternalBindingDialog from './ExternalBindingDialog';
import ThemeControls from './ThemeControls';
import { ConfirmDialog, Dialog, Select } from './primitives';
import { useToast } from './toast';

export default function LobbyView() {
  const { t } = useTranslation();
  const identity = useIdentity();
  const isRoomAdmin = identity?.roles.includes('room_admin') ?? false;
  const [rooms, setRooms] = useState<RoomInfo[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = () => {
    setFailed(false);
    api.listRooms().then(setRooms).catch(() => setFailed(true));
  };

  // 大厅实况来自一次性 REST 快照：5s 轮询保活（曲终/换曲/人数变化），
  // 窗口重新聚焦时立即刷新一次
  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  return (
    <div className="view-enter max-w-5xl mx-auto px-7 pb-16">
      <header className="flex items-center gap-4 py-5 border-b border-hairline mb-9">
        <div className="font-display text-xl font-semibold">
          Yuzu <em className="italic font-normal text-accent">Jukebox</em>
        </div>
        <div className="flex-1" />
        <IdentityChip />
        <AdminEntry />
        <ThemeControls />
      </header>

      <div className="font-mono text-[11px] tracking-[0.14em] uppercase text-faint mb-2.5">
        {t('lobby.eyebrow')}
      </div>
      <h1 className="font-display text-4xl font-semibold mb-9">
        {t('lobby.greeting', { period: t(greetingKey()), name: identity?.name ?? '' })}
      </h1>

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
          <RoomCard key={room.id} room={room} isRoomAdmin={isRoomAdmin} onDeleted={load} />
        ))}
        {rooms !== null && isRoomAdmin && <CreateRoomCard onCreated={load} />}
        {rooms?.length === 0 && !isRoomAdmin && <p className="text-muted">{t('lobby.noRooms')}</p>}
      </div>
    </div>
  );
}

/** 按小时取问候语 key */
function greetingKey(): string {
  const h = new Date().getHours();
  if (h < 5) return 'lobby.periodNight';
  if (h < 12) return 'lobby.periodMorning';
  if (h < 14) return 'lobby.periodNoon';
  if (h < 18) return 'lobby.periodAfternoon';
  return 'lobby.periodEvening';
}

function IdentityChip() {
  const { t } = useTranslation();
  const identity = useIdentity();
  const [bindingOpen, setBindingOpen] = useState(false);
  if (!identity) return null;
  return (
    <>
      <div className="flex items-center gap-2.5 text-[13px]">
        <span className="text-muted">{identity.name}</span>
        {identity.kind === 'oidc' && (
          <button
            type="button"
            onClick={() => setBindingOpen(true)}
            className="text-faint hover:text-paper"
          >
            {t('lobby.externalBinding')}
          </button>
        )}
        <button onClick={() => void session.logout()} className="text-faint hover:text-paper">
          {t('lobby.logout')}
        </button>
      </div>
      {identity.kind === 'oidc' && (
        <ExternalBindingDialog open={bindingOpen} onOpenChange={setBindingOpen} />
      )}
    </>
  );
}

function AdminEntry() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const identity = useIdentity();
  const isAdmin = identity?.roles.some((r) => r === 'room_admin' || r === 'media_admin') ?? false;
  if (!isAdmin) return null;
  return (
    <button onClick={() => navigate('/admin')} className="text-[13px] text-muted hover:text-paper">
      {t('admin.entry')}
    </button>
  );
}

function CreateRoomCard({ onCreated }: { onCreated: () => void }) {
  const { t } = useTranslation();
  const { show, showError } = useToast();
  const [open, setOpen] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [name, setName] = useState('');
  const [accessMode, setAccessMode] = useState<RoomAccessMode>('open');
  const [guestPassword, setGuestPassword] = useState('');
  const [codePeriodHours, setCodePeriodHours] = useState('24');
  const [creating, setCreating] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-40 rounded-md border border-dashed border-hairline bg-transparent p-5 text-left text-muted transition-colors hover:border-accent hover:bg-panel hover:text-accent"
      >
        <span className="block font-display text-xl font-semibold">{t('lobby.createRoom')}</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen} title={t('lobby.createRoomTitle')}>
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
                guest_password:
                  accessMode === 'static_password' ? guestPassword : undefined,
                guest_code_period_seconds:
                  accessMode === 'rotating_code' ? periodHours * 3600 : undefined,
              })
              .then(() => {
                show(t('lobby.roomCreated', { name: trimmedName }));
                setOpen(false);
                setRoomId('');
                setName('');
                setAccessMode('open');
                setGuestPassword('');
                setCodePeriodHours('24');
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
          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              disabled={creating}
              onClick={() => setOpen(false)}
              className="rounded-full border border-hairline px-4 py-1.5 text-sm text-muted hover:border-faint hover:text-paper disabled:opacity-40"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={
                creating ||
                !name.trim() ||
                (accessMode === 'static_password' && !guestPassword)
              }
              className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-on-accent hover:brightness-105 disabled:opacity-40"
            >
              {creating ? t('lobby.creatingRoom') : t('lobby.createRoomConfirm')}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

function RoomCard({
  room,
  isRoomAdmin,
  onDeleted,
}: {
  room: RoomInfo;
  isRoomAdmin: boolean;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { show, showError } = useToast();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
    <>
      <div className="group relative">
        <button
          type="button"
          onClick={() => navigate(`/room/${encodeURIComponent(room.id)}`)}
          className="h-full w-full cursor-pointer rounded-md border border-hairline bg-panel p-4.5 text-left transition-colors hover:border-faint hover:bg-panel-2"
        >
          <h2 className="pr-8 font-display text-xl font-semibold">{room.name}</h2>
          <div className="mt-0.5 flex flex-wrap gap-3 text-[12.5px] text-muted">
            {np ? (
              np.playing ? (
                <span className="inline-flex items-center gap-1.5 text-accent">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                  {t('lobby.playing')}
                </span>
              ) : (
                <span className="text-faint">{t('lobby.paused')}</span>
              )
            ) : (
              <span className="text-faint">{t('lobby.idle')}</span>
            )}
            <span>{t('lobby.listenerCount', { count: room.listener_count })}</span>
            <span className="text-faint">
              {t(
                room.guest_access.mode === 'static_password'
                  ? 'lobby.accessBadgeStatic'
                  : room.guest_access.mode === 'rotating_code'
                    ? 'lobby.accessBadgeRotating'
                    : 'lobby.accessBadgeOpen',
              )}
            </span>
          </div>

          <div className="mt-3.5 border-t border-hairline pt-3">
            {np ? (
              <div className="flex items-center gap-2.5">
                {np.cover_url ? (
                  <img src={np.cover_url} alt="" className="h-8.5 w-8.5 flex-none rounded object-cover" />
                ) : (
                  <div className="h-8.5 w-8.5 flex-none rounded bg-panel-2" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px]">{np.title}</div>
                  <div className="truncate text-xs text-muted">{np.artist}</div>
                  <div className="mt-1.5 h-0.5 overflow-hidden rounded bg-[var(--rail)]">
                    <div
                      className="progress-glide h-full bg-accent"
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

        {isRoomAdmin && (
          <button
            type="button"
            aria-label={t('lobby.deleteRoom', { name: room.name })}
            onClick={(event) => {
              event.stopPropagation();
              setDeleteOpen(true);
            }}
            className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full border border-transparent text-lg leading-none text-faint opacity-0 transition-all hover:border-hairline hover:bg-panel-2 hover:text-paper focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
          >
            ×
          </button>
        )}
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('lobby.deleteRoomTitle')}
        description={t('lobby.deleteRoomDescription', { name: room.name })}
        confirmText={deleting ? t('lobby.deletingRoom') : t('lobby.deleteRoomConfirm')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => {
          if (deleting) return;
          setDeleting(true);
          void api
            .deleteRoom(room.id)
            .then(() => {
              setDeleteOpen(false);
              show(t('lobby.roomDeleted', { name: room.name }));
              onDeleted();
            })
            .catch(showError)
            .finally(() => setDeleting(false));
        }}
      />
    </>
  );
}
