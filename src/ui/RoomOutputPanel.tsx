import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RoomOutput } from '../api/types';
import { api } from '../app/session';
import { formatDateTime } from './format';
import { useToast } from './toast';

const primaryButtonClass =
  'rounded-full bg-accent px-4 py-1.5 text-[13px] font-medium text-on-accent hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40';
const secondaryButtonClass =
  'rounded-full border border-hairline px-4 py-1.5 text-[13px] text-muted hover:border-faint hover:text-paper disabled:cursor-not-allowed disabled:opacity-40';

export function RoomOutputPanel({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  const { show, showError } = useToast();
  const [output, setOutput] = useState<RoomOutput>();
  const [draft, setDraft] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setOutput(undefined);
    setFailed(false);
    try {
      const nextOutput = await api.roomOutput(roomId);
      setOutput(nextOutput);
      setDraft(nextOutput.volume);
    } catch (error: unknown) {
      setFailed(true);
      setOutput({ volume: null });
      showError(error);
    }
  }, [roomId, showError]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (draft === null || saving || draft === output?.volume) return;
    setSaving(true);
    try {
      const result = await api.setRoomOutputVolume(roomId, draft);
      setOutput(result.output);
      setDraft(result.output.volume);
      show(t('roomAdmin.outputSaved'));
    } catch (error: unknown) {
      showError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-4 rounded-md border border-hairline bg-panel-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">{t('roomAdmin.outputTitle')}</h2>
          <p className="mt-0.5 text-xs text-muted">{t('roomAdmin.outputIntro')}</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={output === undefined} className={secondaryButtonClass}>
          {output === undefined ? t('admin.common.working') : t('admin.common.refresh')}
        </button>
      </div>

      {output === undefined ? (
        <p className="py-6 text-center text-sm text-muted">{t('common.loading')}</p>
      ) : failed ? (
        <div className="py-6 text-center text-sm text-muted">
          <p>{t('roomAdmin.outputLoadFailed')}</p>
          <button type="button" onClick={() => void load()} className="mt-2 text-accent hover:underline">
            {t('common.retry')}
          </button>
        </div>
      ) : draft === null ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-md border border-dashed border-hairline bg-panel px-4 py-4">
          <div>
            <p className="text-sm font-medium text-paper">{t('roomAdmin.outputUnset')}</p>
            <p className="mt-1 text-xs text-faint">{t('roomAdmin.outputUnsetHint')}</p>
          </div>
          <button type="button" onClick={() => setDraft(50)} className={primaryButtonClass}>
            {t('roomAdmin.outputSet')}
          </button>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <label className="block text-xs text-muted">
            <span className="flex items-center justify-between gap-3">
              <span>{t('roomAdmin.outputVolume')}</span>
              <output className="font-mono text-base tabular-nums text-paper">{draft}</output>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={draft}
              disabled={saving}
              onChange={(event) => setDraft(Number(event.target.value))}
              className="mt-2 w-full accent-[var(--accent)] disabled:cursor-not-allowed"
            />
          </label>
          <button
            type="button"
            disabled={saving || draft === output.volume}
            onClick={() => void save()}
            className={primaryButtonClass}
          >
            {saving ? t('roomAdmin.outputSaving') : t('roomAdmin.outputSave')}
          </button>
          {output.updated_at ? (
            <p className="text-[11px] text-faint lg:col-span-2">
              {t('roomAdmin.outputUpdatedAt', { time: formatDateTime(output.updated_at) })}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
