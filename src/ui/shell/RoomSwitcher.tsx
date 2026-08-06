/**
 * 房间切换器（桌面）：Spotify Connect 设备菜单的对应物。
 * 房间 = 共享播放设备；实况经 useRooms 共享轮询，收起态显示房间显示名。
 * 内容（房间列表 + controller 控制区）抽到 RoomPickerContent，移动端复用。
 */
import { type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover } from 'radix-ui';
import { MonitorSpeaker } from 'lucide-react';
import { useRooms, useRoomState } from '../hooks';
import { useShell } from '../shellContext';
import { RoomPickerContent } from './RoomPickerContent';

export function RoomSwitcher(): JSX.Element {
  const { t } = useTranslation();
  const state = useRoomState();
  const { roomsOpen, setRoomsOpen } = useShell();
  const rooms = useRooms();

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
          <RoomPickerContent onClose={() => setRoomsOpen(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
