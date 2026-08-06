/**
 * 队列抽屉：右侧面板，容纳待播队列（拖拽/移除）、点歌面板、听众与电台。
 * 自 RoomView 的右栏迁移而来；portal 到 body，避免祖先 transform 劫持 fixed 定位。
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { GripVertical, X } from 'lucide-react';
import type { QueueEntry } from '../../protocol/types';
import { roomStore } from '../../app/session';
import { useIdentity, useRoomState } from '../hooks';
import { formatClock, formatMs } from '../format';
import { useToast } from '../toast';
import { useShell } from '../AppShell';
import { RadioPanel } from './RadioPanel';

export function QueueDrawer(): JSX.Element | null {
  const { t } = useTranslation();
  const state = useRoomState();
  const identity = useIdentity();
  const { canControl, nameOf, queueOpen, setQueueOpen, setRoomsOpen } = useShell();
  const { showError } = useToast();
  const panelRef = useRef<HTMLDivElement | null>(null);

  // ESC 或点击面板外部自动收起
  useEffect(() => {
    if (!queueOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setQueueOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      // 触发按钮的 pointerdown 先于 click 到达：若按空白逻辑先收起，
      // 随后按钮 click 的 !queueOpen 会立刻重新展开。触发按钮本身例外。
      if (target instanceof Element && target.closest('[data-queue-toggle]')) return;
      if (!panelRef.current?.contains(target)) setQueueOpen(false);
    };
    document.addEventListener('keydown', onKey);
    // 捕获阶段：确保任何点击（含抽屉内部按钮触发的新 popover）先判定归属
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [queueOpen, setQueueOpen]);

  return createPortal(
    // 纵向夹在顶栏与底部播放栏之间：不遮挡两者
    <div
      ref={panelRef}
      className={`fixed inset-x-0 bottom-18 top-14 z-30 flex flex-col border-t border-l border-r border-hairline bg-panel transition-transform duration-200 md:left-auto md:right-0 md:w-[380px] md:max-w-[92vw] md:top-14 ${
        queueOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
      aria-hidden={!queueOpen}
    >
      <header className="flex flex-none items-baseline justify-between border-b border-hairline px-4.5 py-3.5">
        <span className="font-mono text-[11px] tracking-[0.14em] text-faint">{t('room.queueTitle')}</span>
        <div className="flex items-center gap-3">
          {state.roomId && (
            <span className="font-mono text-xs text-muted tabular-nums">
              {t('room.queueCount', { count: state.queue.length })}
            </span>
          )}
          {canControl && state.queue.length > 0 && (
            <button
              type="button"
              onClick={() => void roomStore.clearQueue().catch(showError)}
              className="text-xs text-muted hover:text-paper"
            >
              {t('room.clearQueue')}
            </button>
          )}
          <button
            type="button"
            aria-label={t('shell.queueClose')}
            onClick={() => setQueueOpen(false)}
            className="grid h-6 w-6 place-items-center rounded-full text-faint hover:bg-[var(--hover)] hover:text-paper"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {!state.roomId ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <p className="text-sm text-muted">{t('shell.noRoomHint')}</p>
          <button
            type="button"
            onClick={() => {
              setQueueOpen(false);
              setRoomsOpen(true);
            }}
            className="rounded-full bg-accent px-5 py-2 text-[13px] font-medium text-on-accent hover:brightness-105"
          >
            {t('shell.selectRoom')}
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {/* 点歌入口已统一到顶栏搜索框，这里不再重复 */}

          {state.queue.length === 0 ? (
            <p className="px-4.5 py-8 text-center text-sm text-muted">{t('room.queueEmpty')}</p>
          ) : (
            <QueueList
              queue={state.queue}
              identityId={identity?.id ?? ''}
              canControl={canControl}
              nameOf={nameOf}
              onError={showError}
            />
          )}

          <RadioPanel />

          <div className="border-t border-hairline px-4.5 py-3 text-[12.5px] text-muted">
            <span>{t('room.listenerCount', { count: state.listeners.length })}</span>
            <span className="ml-3 text-faint">{state.listeners.map((l) => l.name).join('、')}</span>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

// ---------- 队列（点歌小票） ----------

type NameOf = (id: string, snapshot?: string) => string;

function QueueList({
  queue,
  identityId,
  canControl,
  nameOf,
  onError,
}: {
  queue: QueueEntry[];
  identityId: string;
  canControl: boolean;
  nameOf: NameOf;
  onError: (err: unknown) => void;
}) {
  // 拖拽排序（controller）：dragIndex = 被拖条目序号，dropSlot = 插入缝（0..N）
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropSlot, setDropSlot] = useState<number | null>(null);

  const dropAt = (slot: number) => {
    if (dragIndex === null) return;
    const entry = queue[dragIndex];
    setDragIndex(null);
    setDropSlot(null);
    if (!entry || slot === dragIndex || slot === dragIndex + 1) return; // 落回原位
    // 服务端 to_index = 删除该条目后的插入位（0-based）：向下拖要减 1
    const toIndex = slot < dragIndex ? slot : slot - 1;
    void roomStore.moveQueue(entry.entry_id, toIndex).catch(onError);
  };

  const endDrag = () => {
    setDragIndex(null);
    setDropSlot(null);
  };

  return (
    <>
      {queue.map((entry, i) => (
        <div key={entry.entry_id}>
          {canControl && dropSlot === i && <div className="mx-2 h-0.5 rounded bg-accent" />}
          <Ticket
            entry={entry}
            index={i + 1}
            mine={entry.requested_by === identityId}
            canControl={canControl}
            nameOf={nameOf}
            onError={onError}
            dragging={dragIndex === i}
            dnd={
              canControl
                ? {
                    onDragStart: (e) => {
                      setDragIndex(i);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', entry.entry_id);
                    },
                    onDragOver: (e) => {
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      setDropSlot(e.clientY < rect.top + rect.height / 2 ? i : i + 1);
                    },
                    onDrop: (e) => {
                      e.preventDefault();
                      dropAt(dropSlot ?? i);
                    },
                    onDragEnd: endDrag,
                  }
                : undefined
            }
          />
        </div>
      ))}
      {canControl && dropSlot === queue.length && queue.length > 0 && (
        <div className="mx-2 h-0.5 rounded bg-accent" />
      )}
    </>
  );
}

function Ticket({
  entry,
  index,
  mine,
  canControl,
  nameOf,
  onError,
  dragging,
  dnd,
}: {
  entry: QueueEntry;
  index: number;
  mine: boolean;
  canControl: boolean;
  nameOf: NameOf;
  onError: (err: unknown) => void;
  dragging?: boolean;
  dnd?: {
    onDragStart: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    onDragEnd: () => void;
  };
}) {
  const { t } = useTranslation();
  const canRemove = mine || canControl;
  const requesterName = nameOf(entry.requested_by, entry.requester_name);
  return (
    <div
      draggable={dnd !== undefined}
      onDragStart={dnd?.onDragStart}
      onDragOver={dnd?.onDragOver}
      onDrop={dnd?.onDrop}
      onDragEnd={dnd?.onDragEnd}
      className={`ticket-enter group grid grid-cols-[34px_1fr_auto] gap-3 border-b border-hairline px-4.5 py-3 last:border-b-0 hover:bg-panel-2 ${mine ? 'shadow-[inset_2px_0_0_var(--accent)]' : ''} ${dnd ? 'cursor-grab active:cursor-grabbing' : ''} ${dragging ? 'opacity-40' : ''}`}
    >
      <span className="pt-1 font-mono text-xs text-faint tabular-nums">{String(index).padStart(2, '0')}</span>
      <div className="min-w-0">
        <div className="truncate text-sm">{entry.title}</div>
        <div className="mt-0.5 truncate text-xs text-muted">
          {entry.artist}
          {entry.album ? ` · ${entry.album}` : ''}
        </div>
        <div className="mt-1 flex gap-2 text-[11.5px] text-faint">
          <span className={mine ? 'text-accent' : 'text-muted'}>
            {mine ? t('room.mine', { name: requesterName }) : requesterName}
          </span>
          <time className="font-mono text-[10.5px]">{formatClock(entry.added_at)}</time>
        </div>
      </div>
      <div className="flex flex-col items-end justify-between">
        <span className="font-mono text-[11.5px] text-muted tabular-nums">{formatMs(entry.duration_ms)}</span>
        {canRemove && (
          <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100">
            {canControl && (
              <span className="px-1 text-faint" title={t('room.moveAdmin')}>
                <GripVertical className="h-3.5 w-3.5" />
              </span>
            )}
            <button
              title={mine ? t('room.removeOwn') : t('room.removeAdmin')}
              onClick={() => void roomStore.removeQueue(entry.entry_id).catch(onError)}
              className="px-1 text-faint hover:text-[#D05A4E]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
