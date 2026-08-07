import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { YuzuError } from '../protocol/types';
import { errorKey } from './errors';

interface ToastItem {
  id: number;
  message: string;
  visible: boolean;
}

interface ToastTimers {
  enter: number;
  hide: number;
  remove?: number;
}

interface ToastActions {
  show: (msg: string) => void;
  showError: (err: unknown) => void;
}

const ToastContext = createContext<ToastActions | null>(null);
const DISPLAY_MS = 2600;
const TRANSITION_MS = 240;

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ToastTimers>());

  const show = useCallback((message: string) => {
    const id = ++nextId.current;
    setToasts((current) => [...current, { id, message, visible: false }]);

    const enter = window.setTimeout(() => {
      setToasts((current) => current.map((toast) => (toast.id === id ? { ...toast, visible: true } : toast)));
    });
    const hide = window.setTimeout(() => {
      setToasts((current) => current.map((toast) => (toast.id === id ? { ...toast, visible: false } : toast)));
      const toastTimers = timers.current.get(id);
      if (!toastTimers) return;
      toastTimers.remove = window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
        timers.current.delete(id);
      }, TRANSITION_MS);
    }, DISPLAY_MS);

    timers.current.set(id, { enter, hide });
  }, []);

  const dismiss = useCallback((id: number) => {
    const toastTimers = timers.current.get(id);
    if (toastTimers) {
      clearTimeout(toastTimers.enter);
      clearTimeout(toastTimers.hide);
      clearTimeout(toastTimers.remove);
      timers.current.delete(id);
    }
    setToasts((current) => current.map((toast) => (toast.id === id ? { ...toast, visible: false } : toast)));
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, TRANSITION_MS);
  }, []);

  const showError = useCallback(
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      show(err instanceof YuzuError ? t(errorKey(err), { message }) : t('error.unknown', { message }));
    },
    [show, t],
  );

  useEffect(
    () => () => {
      for (const toastTimers of timers.current.values()) {
        clearTimeout(toastTimers.enter);
        clearTimeout(toastTimers.hide);
        clearTimeout(toastTimers.remove);
      }
      timers.current.clear();
    },
    [],
  );

  const actions = useMemo(() => ({ show, showError }), [show, showError]);

  return (
    <ToastContext.Provider value={actions}>
      {children}
      {/* 定位锚定壳高变量（含安全区）：始终浮在底部 chrome 之上，不压播放栏 */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-7 bottom-[calc(var(--chrome-b)+8px)] z-50 flex flex-col items-end gap-2 max-[560px]:right-4 max-[560px]:left-4 max-[560px]:items-stretch"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** 单条 toast：可点按/拖拽划掉。拖拽时 transform 归 style 管（无过渡），松手未达阈值经 class 过渡弹回。 */
function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: number) => void;
}): JSX.Element {
  const pointer = useRef<{ id: number; startX: number; startY: number } | null>(null);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);

  return (
    <div
      className={`bg-panel-2 border border-hairline border-l-[3px] border-l-accent rounded-lg px-4.5 py-3 text-[13.5px] [box-shadow:var(--toast-shadow)] pointer-events-auto touch-none select-none transition-[opacity,transform] duration-[var(--speed)] ease-out ${toast.visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'}`}
      style={
        offset
          ? { transform: `translate(${offset.x}px, ${offset.y}px)`, transition: 'none' }
          : undefined
      }
      onPointerDown={(event) => {
        if (!event.isPrimary) return;
        pointer.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const active = pointer.current;
        if (!active || active.id !== event.pointerId) return;
        setOffset({ x: event.clientX - active.startX, y: event.clientY - active.startY });
      }}
      onPointerUp={(event) => {
        const active = pointer.current;
        if (!active || active.id !== event.pointerId) return;
        pointer.current = null;
        const dx = event.clientX - active.startX;
        const dy = event.clientY - active.startY;
        setOffset(null);
        // 轻点（≈无位移）或划动超阈值都视为丢弃
        if (Math.hypot(dx, dy) < 8 || Math.abs(dx) > 64 || Math.abs(dy) > 48) {
          onDismiss(toast.id);
        }
      }}
      onPointerCancel={() => {
        pointer.current = null;
        setOffset(null);
      }}
    >
      {toast.message}
    </div>
  );
}

export function useToast(): ToastActions {
  const actions = useContext(ToastContext);
  if (!actions) throw new Error('useToast must be used within ToastProvider');
  return actions;
}
