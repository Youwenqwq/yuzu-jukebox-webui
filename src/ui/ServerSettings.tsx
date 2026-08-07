import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NATIVE_SERVER_KEY, httpBase } from '../config';
import { isNativeApp } from '../app/nativemedia';
import { Dialog } from './primitives';

const SESSION_KEYS = ['yuzu-session', 'yuzu-room-credentials', 'yuzu-last-room'] as const;

interface ServerAddressEditorProps {
  onCancel?: () => void;
}

export function ServerAddressEditor(props: ServerAddressEditorProps = {}) {
  if (!isNativeApp) return null;
  return <NativeServerAddressEditor {...props} />;
}

function NativeServerAddressEditor({ onCancel }: ServerAddressEditorProps) {
  const { t } = useTranslation();
  const [address, setAddress] = useState(
    () => localStorage.getItem(NATIVE_SERVER_KEY) ?? httpBase,
  );
  const [invalid, setInvalid] = useState(false);

  const save = () => {
    const next = address.trim();

    if (next) {
      try {
        const parsed = new URL(next);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new TypeError();
      } catch {
        setInvalid(true);
        return;
      }
      localStorage.setItem(NATIVE_SERVER_KEY, next.replace(/\/+$/, ''));
    } else {
      localStorage.removeItem(NATIVE_SERVER_KEY);
    }

    for (const key of SESSION_KEYS) localStorage.removeItem(key);
    location.reload();
  };

  return (
    <div>
      <label className="block font-mono text-[11px] tracking-[0.08em] text-faint">
        {t('serverPicker.label')}
        <input
          autoFocus
          type="text"
          inputMode="url"
          value={address}
          onChange={(event) => {
            setAddress(event.target.value);
            if (invalid) setInvalid(false);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            save();
          }}
          placeholder={t('serverPicker.placeholder')}
          aria-invalid={invalid}
          className="mt-2 w-full rounded-md border border-hairline bg-panel px-3 py-2 font-mono text-[13px] tracking-normal text-paper placeholder:text-faint"
        />
      </label>
      {invalid && (
        <p role="alert" className="mt-2 text-xs text-accent">
          {t('serverPicker.invalid')}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-hairline px-4 py-1.5 text-sm text-muted hover:border-faint hover:text-paper"
          >
            {t('serverPicker.cancel')}
          </button>
        )}
        <button
          type="button"
          onClick={save}
          className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-on-accent hover:brightness-105"
        >
          {t('serverPicker.save')}
        </button>
      </div>
    </div>
  );
}

export function ServerAddressDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!isNativeApp) return null;
  return <NativeServerAddressDialog open={open} onOpenChange={onOpenChange} />;
}

function NativeServerAddressDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('serverPicker.dialogTitle')}>
      <ServerAddressEditor onCancel={() => onOpenChange(false)} />
    </Dialog>
  );
}
