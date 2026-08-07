/**
 * 房间选择 + 房间控制（共享内容）：桌面端在 RoomSwitcher 的 Popover 里，
 * 移动端在账户菜单触发的 Dialog 里。房间实况经 useRooms 共享轮询。
 */
import { useEffect, useReducer, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Pause, Play, SkipForward } from 'lucide-react';
import type { RoomInfo } from '../../api/types';
import { roomStore } from '../../app/session';
import { useRooms, useRoomState } from '../hooks';
import { formatMs } from '../format';
import { useShell } from '../shellContext';
import { positionOf } from './PlayerBar';

export function RoomPickerContent({ onClose }: { onClose: () => void }): JSX.Element {
  const { t } = useTranslation();
  const state = useRoomState();
  const { canControl, joinRoom, leaveRoom } = useShell();
  const rooms = useRooms();
  const [credRoomId, setCredRoomId] = useState<string | null>(null);
  const [credInput, setCredInput] = useState('');
  const [joining, setJoining] = useState(false);
  // 弹窗内进度条 1s 重算（与播放栏同款）
  const [, forceTick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const id = setInterval(forceTick, 1000);
    return () => clearInterval(id);
  }, []);

  const currentId = state.roomId;
  const current = state.playback.current;
  const pos = current ? positionOf(state.playback) : 0;
  const pct = current && current.duration_ms > 0 ? (pos / current.duration_ms) * 100 : 0;

  const tryJoin = async (room: RoomInfo, password?: string) => {
    if (joining) return;
    setJoining(true);
    try {
      const result = await joinRoom(room.id, password);
      if (result === 'joined') {
        setCredRoomId(null);
        setCredInput('');
        onClose();
      } else if (result === 'need_credential') {
        setCredRoomId(room.id);
        setCredInput('');
      }
    } finally {
      setJoining(false);
    }
  };

  return (
    <div>
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
                className="w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-[var(--hover)]"
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

      {/* 房间控制区：controller 专属；与个人收听视图分离 */}
      {canControl && current && (
        <div className="mt-1 border-t border-hairline px-2.5 pt-2.5 pb-1.5">
          <div className="pb-1.5 font-mono text-[11px] tracking-[0.14em] text-faint">
            {t('shell.roomControls')}
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px]">{current.title}</div>
              <div className="truncate text-[11px] text-muted">{current.artist}</div>
            </div>
            <div className="flex flex-none items-center gap-1">
              <button
                type="button"
                title={state.playback.playing ? t('room.pause') : t('room.resume')}
                onClick={() =>
                  void (state.playback.playing ? roomStore.pause() : roomStore.resume()).catch(
                    () => {},
                  )
                }
                className="grid h-8 w-8 place-items-center rounded-full bg-accent text-on-accent hover:brightness-105"
              >
                {state.playback.playing ? (
                  <Pause className="h-4 w-4 fill-current" />
                ) : (
                  <Play className="ml-0.5 h-4 w-4 fill-current" />
                )}
              </button>
              <button
                type="button"
                title={t('room.skip')}
                onClick={() => void roomStore.skip().catch(() => {})}
                className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-[var(--hover)] hover:text-paper"
              >
                <SkipForward className="h-4 w-4 fill-current" />
              </button>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="flex-none font-mono text-[10.5px] text-muted tabular-nums">
              {formatMs(pos)}
            </span>
            <div
              className="flex-1 cursor-pointer [@media(hover:none)]:-my-3 [@media(hover:none)]:py-3"
              onClick={(e) => {
                if (current.duration_ms <= 0) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = (e.clientX - rect.left) / rect.width;
                void roomStore.seek(Math.round(ratio * current.duration_ms)).catch(() => {});
              }}
            >
              {/* 触摸端热区由外层 padding 扩到 27px，视觉轨道仍是 3px */}
              <div className="h-[3px] overflow-hidden rounded bg-[var(--rail)]">
                <div className="progress-glide h-full rounded bg-accent" style={{ width: `${pct}%` }} />
              </div>
            </div>
            <span className="flex-none font-mono text-[10.5px] text-muted tabular-nums">
              {formatMs(current.duration_ms)}
            </span>
          </div>
        </div>
      )}
      {currentId && (
        <button
          type="button"
          onClick={() => {
            onClose();
            void leaveRoom();
          }}
          className="mt-1 w-full rounded-md border-t border-hairline px-2.5 pt-2 pb-1 text-left text-xs text-faint hover:text-paper"
        >
          {t('shell.leaveRoom')}
        </button>
      )}
    </div>
  );
}
