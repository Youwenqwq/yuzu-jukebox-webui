import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ExternalBindingCode } from '../api/types';
import { api, client } from '../app/session';
import { Dialog } from './primitives';
import { useToast } from './toast';

export default function ExternalBindingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { show, showError } = useToast();
  const [issued, setIssued] = useState<ExternalBindingCode | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [serverNow, setServerNow] = useState(() => client.clock.serverNow());

  useEffect(() => {
    if (!open || !issued) return;

    const updateNow = () => setServerNow(client.clock.serverNow());
    updateNow();
    const timer = window.setInterval(updateNow, 1000);
    return () => window.clearInterval(timer);
  }, [issued, open]);

  const remainingSeconds = issued
    ? Math.max(0, Math.ceil((issued.expires_at - serverNow) / 1000))
    : 0;
  const expired = issued !== null && remainingSeconds === 0;

  const issueCode = async () => {
    if (issuing) return;
    setIssuing(true);
    try {
      const next = await api.issueExternalBindingCode();
      setIssued(next);
      setServerNow(client.clock.serverNow());
    } catch (error) {
      showError(error);
    } finally {
      setIssuing(false);
    }
  };

  const copyCode = () => {
    if (!issued || expired) return;
    void navigator.clipboard
      .writeText(issued.code)
      .then(() => show(t('lobby.externalBindingCopied')))
      .catch(showError);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('lobby.externalBindingTitle')}>
      <p className="text-sm leading-6 text-muted">{t('lobby.externalBindingIntro')}</p>

      {issued ? (
        <div className="mt-5 rounded-md border border-hairline bg-panel p-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-faint">
            {t('lobby.externalBindingCodeLabel')}
          </p>
          <output
            aria-live="polite"
            className="mt-2 block select-all font-mono text-2xl font-semibold tracking-[0.08em] text-paper"
          >
            {issued.code}
          </output>
          <p className={`mt-2 font-mono text-xs ${expired ? 'text-[#D05A4E]' : 'text-accent'}`}>
            {expired
              ? t('lobby.externalBindingExpired')
              : t('lobby.externalBindingRemaining', { time: formatRemaining(remainingSeconds) })}
          </p>
        </div>
      ) : (
        <p className="mt-5 rounded-md border border-hairline bg-panel p-4 text-xs leading-5 text-faint">
          {t('lobby.externalBindingHint')}
        </p>
      )}

      {issued && (
        <button
          type="button"
          disabled={expired}
          onClick={copyCode}
          className="mt-3 w-full rounded-full border border-hairline px-4 py-2 text-sm text-muted hover:border-faint hover:text-paper disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('lobby.externalBindingCopy')}
        </button>
      )}

      {issued && (
        <p className="mt-4 text-xs leading-5 text-faint">{t('lobby.externalBindingReissueHint')}</p>
      )}

      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          disabled={issuing}
          onClick={() => onOpenChange(false)}
          className="rounded-full border border-hairline px-4 py-1.5 text-sm text-muted hover:border-faint hover:text-paper disabled:opacity-40"
        >
          {t('common.close')}
        </button>
        <button
          type="button"
          disabled={issuing}
          onClick={() => void issueCode()}
          className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-on-accent hover:brightness-105 disabled:opacity-40"
        >
          {issuing
            ? t('lobby.externalBindingIssuing')
            : issued
              ? t('lobby.externalBindingReissue')
              : t('lobby.externalBindingIssue')}
        </button>
      </div>
    </Dialog>
  );
}

function formatRemaining(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
