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
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-7 bottom-7 z-50 flex flex-col items-end gap-2 max-[560px]:right-4 max-[560px]:bottom-4 max-[560px]:left-4 max-[560px]:items-stretch"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`bg-panel-2 border border-hairline border-l-[3px] border-l-accent rounded-lg px-4.5 py-3 text-[13.5px] [box-shadow:var(--toast-shadow)] transition-[opacity,transform] duration-[var(--speed)] ease-out ${toast.visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'}`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastActions {
  const actions = useContext(ToastContext);
  if (!actions) throw new Error('useToast must be used within ToastProvider');
  return actions;
}
