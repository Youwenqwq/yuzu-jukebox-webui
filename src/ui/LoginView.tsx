import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OidcConfig } from '../api/types';
import { adminPasswordEnabled, httpBase, oidcClientId } from '../config';
import { YuzuError } from '../protocol/types';
import { api, oidcFlow, session } from '../app/session';
import { isNativeApp } from '../app/nativemedia';
import { errorKey } from './errors';
import { ServerAddressEditor } from './ServerSettings';

/** Zitadel roles scope：让 roles 随 token 下发，不依赖 console 应用级设置 */
const OIDC_SCOPES = ['urn:zitadel:iam:org:projects:roles'];

export default function LoginView({ oidcError, onDone }: { oidcError: YuzuError | null; onDone: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<YuzuError | null>(oidcError);
  const [busy, setBusy] = useState(false);
  const [oidc, setOidc] = useState<OidcConfig | null>(null);
  const [serverEditorOpen, setServerEditorOpen] = useState(false);

  useEffect(() => {
    api.oidcConfig().then(setOidc).catch(() => setOidc(null));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await session.loginGuest(
        name.trim(),
        adminPasswordEnabled ? password || undefined : undefined,
      );
      onDone();
    } catch (err) {
      setError(err instanceof YuzuError ? err : new YuzuError('unknown', String(err)));
    } finally {
      setBusy(false);
    }
  };

  const startOidc = async () => {
    if (!oidc || busy) return;
    setBusy(true);
    setError(null);
    try {
      await oidcFlow.begin(oidc, {
        clientId: oidcClientId || undefined,
        scopes: OIDC_SCOPES,
      });
    } catch (err) {
      setError(err instanceof YuzuError ? err : new YuzuError('unknown', String(err)));
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
          className={`w-full bg-panel border border-hairline rounded-md px-4 py-2.5 placeholder:text-faint ${
            adminPasswordEnabled ? 'mb-3' : 'mb-6'
          }`}
        />
        {adminPasswordEnabled && (
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('login.passwordPlaceholder')}
            className="w-full bg-panel border border-hairline rounded-md px-4 py-2.5 mb-6 placeholder:text-faint"
          />
        )}

        {error && (
          <p className="text-sm text-[#D05A4E] mb-4">{t(errorKey(error), { message: error.message })}</p>
        )}

        <button
          type="submit"
          disabled={!name.trim() || busy}
          className="w-full bg-accent text-on-accent font-medium rounded-full py-2.5 disabled:opacity-40 hover:brightness-105"
        >
          {busy ? t('common.loading') : t('login.submit')}
        </button>

        {oidc && (
          <>
            <div className="flex items-center gap-3 my-5 text-faint text-xs">
              <span className="flex-1 border-t border-hairline" />
              {t('login.oidcDivider')}
              <span className="flex-1 border-t border-hairline" />
            </div>
            <button
              type="button"
              onClick={() => void startOidc()}
              disabled={busy}
              className="w-full border border-hairline text-muted rounded-full py-2.5 hover:text-paper hover:border-faint disabled:opacity-40"
            >
              {t('login.oidcButton')}
            </button>
          </>
        )}

        {isNativeApp && (
          <div className="mt-8 border-t border-hairline pt-4 font-mono text-[11px] text-faint">
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0">{t('serverPicker.label')}</span>
              <span className="min-w-0 flex-1 truncate">{httpBase || t('serverPicker.unset')}</span>
              <button
                type="button"
                onClick={() => setServerEditorOpen(true)}
                className="shrink-0 text-muted hover:text-paper"
              >
                {t('serverPicker.change')}
              </button>
            </div>
            {serverEditorOpen && (
              <div className="mt-3">
                <ServerAddressEditor onCancel={() => setServerEditorOpen(false)} />
              </div>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
