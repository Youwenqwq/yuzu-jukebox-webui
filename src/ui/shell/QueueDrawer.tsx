/**
 * 队列抽屉：右侧面板，容纳待播队列（拖拽/移除）、点歌面板、听众与电台。
 * 自 RoomView 的右栏迁移而来；portal 到 body，避免祖先 transform 劫持 fixed 定位。
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type PointerEventHandler,
} from 'react';
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
    // 纵向夹在顶栏与底部 chrome 之间：壳高变量定义在 tokens.css :root
    //（本抽屉 portal 到 body，继承不到壳容器变量）。移动端满宽，不带左右 border。
    <div
      ref={panelRef}
      className={`fixed inset-x-0 top-(--header-h) bottom-(--chrome-b) z-30 flex flex-col border-t border-hairline bg-panel transition-transform duration-200 md:left-auto md:right-0 md:w-[380px] md:max-w-[92vw] md:border-r md:border-l ${
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
            className="relative grid h-6 w-6 place-items-center rounded-full text-faint after:absolute after:-inset-2 after:content-[''] hover:bg-[var(--hover)] hover:text-paper"
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

type RowMeasure = {
  top: number;
  height: number;
};

type QueueDrag = {
  pointerId: number;
  index: number;
  entryId: string;
  entryIdsKey: string;
  startY: number;
  startScrollTop: number;
  dy: number;
  slot: number;
  rows: RowMeasure[];
  phase: 'dragging' | 'settling';
};

type DragHandleProps = {
  onPointerDown: PointerEventHandler<HTMLSpanElement>;
  onPointerMove: PointerEventHandler<HTMLSpanElement>;
  onPointerUp: PointerEventHandler<HTMLSpanElement>;
  onPointerCancel: PointerEventHandler<HTMLSpanElement>;
};

const DRAG_TRANSITION_MS = 180;
const AUTO_SCROLL_EDGE_PX = 48;
const AUTO_SCROLL_MAX_PX = 14;

function dragAtClientY(drag: QueueDrag, clientY: number, scrollTop: number): QueueDrag {
  const dy = clientY - drag.startY + scrollTop - drag.startScrollTop;
  const dragged = drag.rows[drag.index];
  if (!dragged) return drag;

  const centerY = dragged.top + dragged.height / 2 + dy;
  let indexAfterRemoval = 0;
  for (let i = 0; i < drag.rows.length; i += 1) {
    if (i === drag.index) continue;
    const row = drag.rows[i];
    if (row && centerY > row.top + row.height / 2) indexAfterRemoval += 1;
  }

  // slot 是原队列中的插入缝；跨过被拖行自身时补回它占用的一个位置。
  const slot = indexAfterRemoval < drag.index ? indexAfterRemoval : indexAfterRemoval + 1;
  if (dy === drag.dy && slot === drag.slot) return drag;
  return { ...drag, dy, slot };
}

function settledDy(drag: QueueDrag): number {
  const dragged = drag.rows[drag.index];
  if (!dragged || drag.slot === drag.index || drag.slot === drag.index + 1) return 0;
  if (drag.slot < drag.index) return (drag.rows[drag.slot]?.top ?? dragged.top) - dragged.top;

  const previous = drag.rows[drag.slot - 1];
  if (!previous) return 0;
  return previous.top + previous.height - dragged.height - dragged.top;
}

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
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const dragRef = useRef<QueueDrag | null>(null);
  const captureRef = useRef<{ element: HTMLSpanElement; pointerId: number } | null>(null);
  const pointerYRef = useRef(0);
  const settleTimerRef = useRef<number | null>(null);
  const [drag, setDragState] = useState<QueueDrag | null>(null);
  const entryIdsKey = queue.map((entry) => entry.entry_id).join('\u0000');
  const entryIdsKeyRef = useRef(entryIdsKey);
  entryIdsKeyRef.current = entryIdsKey;

  const setDrag = useCallback((next: QueueDrag | null) => {
    dragRef.current = next;
    setDragState(next);
  }, []);

  const releaseCapture = useCallback(() => {
    const capture = captureRef.current;
    captureRef.current = null;
    if (capture?.element.hasPointerCapture(capture.pointerId)) {
      capture.element.releasePointerCapture(capture.pointerId);
    }
  }, []);

  const clearDrag = useCallback(() => {
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    releaseCapture();
    setDrag(null);
  }, [releaseCapture, setDrag]);

  const updateDrag = useCallback(
    (clientY: number) => {
      const current = dragRef.current;
      if (!current || current.phase !== 'dragging') return;
      const scrollTop = listRef.current?.parentElement?.scrollTop ?? current.startScrollTop;
      setDrag(dragAtClientY(current, clientY, scrollTop));
    },
    [setDrag],
  );

  const finishDrag = useCallback(
    (pointerId: number, commit: boolean) => {
      const current = dragRef.current;
      if (!current || current.pointerId !== pointerId || current.phase !== 'dragging') return;
      releaseCapture();

      const queueStillMatches = current.entryIdsKey === entryIdsKeyRef.current;
      const moved =
        queueStillMatches && current.slot !== current.index && current.slot !== current.index + 1;
      if (commit && moved) {
        // 服务端 to_index = 删除该条目后的插入位（0-based）：向下拖要减 1。
        const toIndex = current.slot < current.index ? current.slot : current.slot - 1;
        void roomStore.moveQueue(current.entryId, toIndex).catch(onError);
      }

      const next = {
        ...current,
        dy: commit && queueStillMatches ? settledDy(current) : 0,
        phase: 'settling' as const,
      };
      setDrag(next);
      settleTimerRef.current = window.setTimeout(clearDrag, DRAG_TRANSITION_MS);
    },
    [clearDrag, onError, releaseCapture, setDrag],
  );

  useEffect(() => {
    const current = dragRef.current;
    if (current && (current.entryIdsKey !== entryIdsKey || !canControl)) clearDrag();
  }, [canControl, clearDrag, entryIdsKey]);

  const draggingPointerId = drag?.phase === 'dragging' ? drag.pointerId : null;
  useEffect(() => {
    if (draggingPointerId === null) return;
    let frame = 0;
    const tick = () => {
      const current = dragRef.current;
      const scroller = listRef.current?.parentElement;
      if (!current || current.phase !== 'dragging' || !scroller) return;

      const y = pointerYRef.current;
      const rect = scroller.getBoundingClientRect();
      let speed = 0;
      if (y < rect.top + AUTO_SCROLL_EDGE_PX) {
        const proximity = Math.min(1, Math.max(0, (rect.top + AUTO_SCROLL_EDGE_PX - y) / AUTO_SCROLL_EDGE_PX));
        speed = -AUTO_SCROLL_MAX_PX * proximity;
      } else if (y > rect.bottom - AUTO_SCROLL_EDGE_PX) {
        const proximity = Math.min(
          1,
          Math.max(0, (y - (rect.bottom - AUTO_SCROLL_EDGE_PX)) / AUTO_SCROLL_EDGE_PX),
        );
        speed = AUTO_SCROLL_MAX_PX * proximity;
      }

      if (speed !== 0) {
        const previousScrollTop = scroller.scrollTop;
        scroller.scrollTop += speed;
        if (scroller.scrollTop !== previousScrollTop) updateDrag(y);
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [draggingPointerId, updateDrag]);

  useEffect(() => clearDrag, [clearDrag]);

  const dragHandleProps = (index: number, entryId: string): DragHandleProps => ({
    onPointerDown: (event) => {
      if (!canControl || !event.isPrimary || event.button !== 0 || dragRef.current) return;
      const rows: RowMeasure[] = [];
      for (let rowIndex = 0; rowIndex < queue.length; rowIndex += 1) {
        const rect = rowRefs.current[rowIndex]?.getBoundingClientRect();
        if (!rect) return;
        rows.push({ top: rect.top, height: rect.height });
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      captureRef.current = { element: event.currentTarget, pointerId: event.pointerId };
      pointerYRef.current = event.clientY;
      const scrollTop = listRef.current?.parentElement?.scrollTop ?? 0;
      setDrag({
        pointerId: event.pointerId,
        index,
        entryId,
        entryIdsKey,
        startY: event.clientY,
        startScrollTop: scrollTop,
        dy: 0,
        slot: index + 1,
        rows,
        phase: 'dragging',
      });
    },
    onPointerMove: (event) => {
      if (dragRef.current?.pointerId !== event.pointerId) return;
      event.preventDefault();
      pointerYRef.current = event.clientY;
      updateDrag(event.clientY);
    },
    onPointerUp: (event) => finishDrag(event.pointerId, true),
    onPointerCancel: (event) => finishDrag(event.pointerId, false),
  });

  return (
    <div ref={listRef}>
      {queue.map((entry, i) => {
        const dragging = drag?.index === i;
        let translateY = 0;
        if (drag) {
          if (dragging) {
            translateY = drag.dy;
          } else if (drag.slot < drag.index && i >= drag.slot && i < drag.index) {
            translateY = drag.rows[drag.index]?.height ?? 0;
          } else if (drag.slot > drag.index + 1 && i > drag.index && i < drag.slot) {
            translateY = -(drag.rows[drag.index]?.height ?? 0);
          }
        }
        const rowStyle: CSSProperties | undefined = drag
          ? {
              transform: `translate3d(0, ${translateY}px, 0)${dragging && drag.phase === 'dragging' ? ' scale(1.015)' : ''}`,
              transition:
                dragging && drag.phase === 'dragging'
                  ? 'none'
                  : `transform ${DRAG_TRANSITION_MS}ms ease`,
              boxShadow: dragging
                ? '0 5px 16px color-mix(in srgb, var(--paper) 10%, transparent)'
                : undefined,
            }
          : undefined;

        return (
          <div
            key={entry.entry_id}
            ref={(node) => {
              rowRefs.current[i] = node;
            }}
            style={rowStyle}
            className={dragging ? 'relative z-10 bg-panel' : undefined}
          >
            <Ticket
              entry={entry}
              index={i + 1}
              mine={entry.requested_by === identityId}
              canControl={canControl}
              nameOf={nameOf}
              onError={onError}
              dragging={dragging}
              dragHandleProps={canControl ? dragHandleProps(i, entry.entry_id) : undefined}
            />
          </div>
        );
      })}
    </div>
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
  dragHandleProps,
}: {
  entry: QueueEntry;
  index: number;
  mine: boolean;
  canControl: boolean;
  nameOf: NameOf;
  onError: (err: unknown) => void;
  dragging?: boolean;
  dragHandleProps?: DragHandleProps;
}) {
  const { t } = useTranslation();
  const canRemove = mine || canControl;
  const requesterName = nameOf(entry.requested_by, entry.requester_name);
  return (
    <div
      className={`ticket-enter group grid grid-cols-[34px_1fr_auto] gap-3 border-b border-hairline px-4.5 py-3 last:border-b-0 ${dragging ? 'bg-panel' : 'hover:bg-panel-2'} ${mine ? 'shadow-[inset_2px_0_0_var(--accent)]' : ''}`}
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
          <div className="flex items-center gap-3">
            {dragHandleProps && (
              <span
                {...dragHandleProps}
                className="relative grid h-5 w-5 touch-none select-none place-items-center text-faint after:absolute after:-inset-2.5 after:content-[''] hover:text-paper cursor-grab active:cursor-grabbing"
                title={t('room.moveAdmin')}
              >
                <GripVertical className="h-3.5 w-3.5" />
              </span>
            )}
            <button
              title={mine ? t('room.removeOwn') : t('room.removeAdmin')}
              onClick={() => void roomStore.removeQueue(entry.entry_id).catch(onError)}
              className="px-1 text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-[#D05A4E] [@media(hover:none)]:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
