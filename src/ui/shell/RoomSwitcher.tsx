/**
 * 房间切换器：Spotify Connect 设备菜单的对应物。
 * 房间 = 共享播放设备；实况（在听人数 / now playing）经 useRooms 共享轮询，
 * 底部栏收起态也能显示房间显示名（不再退回 ID）。受保护房间行内输入凭据。
 */
import { useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover } from 'radix-ui';
import { MonitorSpeaker } from 'lucide-react';
import type { RoomInfo } from '../../api/types';
import { useRooms, useRoomState } from '../hooks';
import { useShell } from '../AppShell';

export function RoomSwitcher(): JSX.Element {
  const { t } = useTranslation();
  const state = useRoomState();
  const { roomsOpen, setRoomsOpen, joinRoom, leaveRoom } = useShell();
  const rooms = useRooms();
  const [credRoomId, setCredRoomId] = useState<string | null>(null);
  const [credInput, setCredInput] = useState('');
  const [joining, setJoining] = useState(false);

  const tryJoin = async (room: RoomInfo, password?: string) => {
    if (joining) return;
    setJoining(true);
    try {
      const result = await joinRoom(room.id, password);
      if (result === 'joined') {
        setCredRoomId(null);
        setCredInput('');
        setRoomsOpen(false);
      } else if (result === 'need_credential') {
        setCredRoomId(room.id);
        setCredInput('');
      }
    } finally {
      setJoining(false);
    }
  };

  const currentId = state.roomId;
  const currentRoom = (rooms ?? []).find((room) => room.id === currentId);

  return (
    <Popover.Root open={roomsOpen} onOpenChange={setRoomsOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title={t('shell.roomSwitch')}
          className="flex min-w-0 max-w-60 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-muted hover:bg-[var(--hover)] hover:text-paper"
        >
          <MonitorSpeaker className="h-4 w-4 flex-none" />
          <span className="min-w-0 flex-1">
            <span className="block truncate">
              {currentId ? (currentRoom?.name ?? currentId) : t('shell.selectRoom')}
            </span>
            {currentId && (
              <span className="block font-mono text-[10.5px] leading-tight text-faint">
                {t('room.listenerCount', { count: state.listeners.length })}
              </span>
            )}
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={10}
          className="menu-content z-50 w-80 rounded-lg border border-hairline bg-panel-2 p-2"
        >
          <div className="px-2.5 pb-1.5 pt-1 font-mono text-[11px] tracking-[0.14em] text-faint">
            {t('shell.roomSwitch')}
          </div>
          {rooms === null && <p className="px-2.5 py-4 text-sm text-muted">{t('common.loading')}</p>}
          {rooms?.length === 0 && <p className="px-2.5 py-4 text-sm text-muted">{t('lobby.noRooms')}</p>}
          <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
            {(rooms ?? []).map((room) => {
              const np = room.now_playing;
              const isCurrent = room.id === currentId;
              return (
                <div key={room.id}>
                  <button
                    type="button"
                    disabled={joining}
                    onClick={() => void tryJoin(room)}
                    className={`w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-[var(--hover)] ${
                      isCurrent ? 'shadow-[inset_2px_0_0_var(--accent)]' : ''
                    }`}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className={`truncate text-[13.5px] ${isCurrent ? 'text-accent' : ''}`}>
                        {room.name}
                      </span>
                      <span className="ml-auto flex-none text-[11px] text-faint">
                        {t('lobby.listenerCount', { count: room.listener_count })}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted">
                      {np ? (
                        <>
                          {np.playing && (
                            <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent align-middle" />
                          )}
                          {np.title} · {np.artist}
                        </>
                      ) : (
                        <span className="text-faint">{t('lobby.emptyQueue')}</span>
                      )}
                    </div>
                  </button>
                  {credRoomId === room.id && (
                    <form
                      className="flex gap-2 px-2.5 pb-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (credInput) void tryJoin(room, credInput);
                      }}
                    >
                      <input
                        type="password"
                        autoFocus
                        value={credInput}
                        onChange={(event) => setCredInput(event.target.value)}
                        placeholder={t('room.credentialPlaceholder')}
                        className="min-w-0 flex-1 rounded-md border border-hairline bg-panel px-2.5 py-1.5 text-[12.5px] placeholder:text-faint"
                      />
                      <button
                        type="submit"
                        disabled={!credInput || joining}
                        className="flex-none rounded-full bg-accent px-3 py-1 text-xs font-medium text-on-accent disabled:opacity-40"
                      >
                        {t('room.join')}
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
          {currentId && (
            <button
              type="button"
              onClick={() => {
                setRoomsOpen(false);
                void leaveRoom();
              }}
              className="mt-1 w-full rounded-md border-t border-hairline px-2.5 pt-2 pb-1 text-left text-xs text-faint hover:text-paper"
            >
              {t('shell.leaveRoom')}
            </button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
