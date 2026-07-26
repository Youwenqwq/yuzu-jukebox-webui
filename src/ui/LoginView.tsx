import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { YuzuError } from '../protocol/types';
import { session } from '../app/session';
import { errorKey } from './errors';

export default function LoginView({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<YuzuError | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await session.loginGuest(name.trim(), password || undefined);
      onDone();
    } catch (err) {
      setError(err instanceof YuzuError ? err : new YuzuError('unknown', String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm">
        <div className="font-mono text-[11px] tracking-[0.14em] uppercase text-faint mb-2">
          Yuzu Jukebox
        </div>
        <h1 className="font-display text-3xl font-semibold mb-8">{t('login.title')}</h1>

        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('login.namePlaceholder')}
          className="w-full bg-panel border border-hairline rounded-md px-4 py-2.5 mb-3 placeholder:text-faint"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('login.passwordPlaceholder')}
          className="w-full bg-panel border border-hairline rounded-md px-4 py-2.5 mb-6 placeholder:text-faint"
        />

        {error && (
          <p className="text-sm text-[#D05A4E] mb-4">{t(errorKey(error), { message: error.message })}</p>
        )}

        <button
          type="submit"
          disabled={!name.trim() || busy}
          className="w-full bg-accent text-on-accent font-medium rounded-full py-2.5 disabled:opacity-40 hover:brightness-107"
        >
          {busy ? t('common.loading') : t('login.submit')}
        </button>
      </form>
    </div>
  );
}
