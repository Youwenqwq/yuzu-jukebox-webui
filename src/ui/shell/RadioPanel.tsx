/**
 * 电台面板：曲目源目录由 provider 能力报告驱动（capabilities.radio_sources），
 * 前端不再硬编码源规格；通用源 playlist:<id> 由房间层提供、恒可用。
 * 启停授权看 capabilities.radio（policy.radio_control 推导），不再是 controller 专属。
 */
import { useEffect, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlaylistInfo } from '../../api/types';
import { api, roomStore } from '../../app/session';
import { useProviders, useRoomState } from '../hooks';
import { composeSource, SOURCE_DESC_KEYS } from '../radioSources';
import { Select } from '../primitives';
import { useToast } from '../toast';
import { useShell } from '../AppShell';

export function RadioPanel(): JSX.Element | null {
  const { t } = useTranslation();
  const state = useRoomState();
  const { canRadio } = useShell();
  const providers = useProviders();
  const { show, showError } = useToast();
  const radio = state.radio;

  const [playlists, setPlaylists] = useState<PlaylistInfo[] | null>(null);
  const [playlistId, setPlaylistId] = useState('');
  const [shuffle, setShuffle] = useState(false);
  const [once, setOnce] = useState(false);
  const [rawSource, setRawSource] = useState('');
  const [busy, setBusy] = useState(false);

  // 只有能启停电台时才需要拉歌单列表（通用源选择器）
  useEffect(() => {
    if (!canRadio) return;
    api
      .listPlaylists()
      .then(setPlaylists)
      .catch(() => setPlaylists([]));
  }, [canRadio]);

  if (!canRadio && !radio) return null;

  const start = (source: string, sourceShuffle = false, sourceOnce = false) => {
    if (busy) return;
    setBusy(true);
    void roomStore
      .radioPlay(source, sourceShuffle, sourceOnce)
      .then(() => show(t('roomAdmin.radioStarted')))
      .catch(showError)
      .finally(() => setBusy(false));
  };

  const stop = () => {
    if (busy) return;
    setBusy(true);
    void roomStore
      .radioStop()
      .then(() => show(t('roomAdmin.radioStopped')))
      .catch(showError)
      .finally(() => setBusy(false));
  };

  if (radio) {
    return (
      <div className="border-t border-hairline px-4.5 py-3">
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="h-1.5 w-1.5 flex-none animate-pulse rounded-full bg-accent" />
          <span className="min-w-0 truncate font-mono text-xs text-muted">
            {t('room.radioOn', { source: radio.source })}
          </span>
          {canRadio && (
            <button
              type="button"
              disabled={busy}
              onClick={stop}
              className="ml-auto flex-none text-xs text-faint hover:text-[#D05A4E] disabled:opacity-40"
            >
              {busy ? t('roomAdmin.radioStopping') : t('roomAdmin.radioStop')}
            </button>
          )}
        </div>
        <p className="mt-1.5 text-[11px] text-faint">{t('room.radioNote')}</p>
      </div>
    );
  }

  const catalog = (providers ?? []).flatMap((p) =>
    (p.capabilities?.radio_sources ?? []).map((source) => ({ providerId: p.id, source })),
  );
  const currentRef = state.playback.current?.track_ref;

  return (
    <div className="border-t border-hairline px-4.5 py-3.5">
      <div className="font-mono text-[11px] tracking-[0.14em] text-faint">{t('roomAdmin.radioTitle')}</div>

      {catalog.length > 0 && (
        <div className="mt-2.5 grid grid-cols-2 gap-1.5">
          {catalog.map(({ providerId, source }) => {
            const composed = composeSource(providerId, source, currentRef);
            return (
              <button
                key={`${providerId}:${source.spec}`}
                type="button"
                disabled={busy || composed === null}
                title={
                  composed === null
                    ? t('radio.seedNeed')
                    : source.arg
                      ? undefined
                      : (SOURCE_DESC_KEYS[source.spec] ? t(SOURCE_DESC_KEYS[source.spec]) : undefined)
                }
                onClick={() => start(composed!)}
                className="rounded-md border border-hairline bg-panel px-2.5 py-2 text-left transition-colors hover:border-accent disabled:opacity-40"
              >
                <div className="text-[12.5px]">{source.name ?? source.spec}</div>
                {SOURCE_DESC_KEYS[source.spec] && (
                  <div className="mt-0.5 text-[11px] text-faint">{t(SOURCE_DESC_KEYS[source.spec])}</div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {playlists && playlists.length > 0 && (
        <div className="mt-3">
          <Select
            value={playlistId}
            onValueChange={setPlaylistId}
            options={[
              { value: '', label: t('radio.playlistPick') },
              ...playlists.map((p) => ({
                value: p.id,
                label: `${p.name} · ${t('batch.trackCount', { count: p.track_count })}`,
              })),
            ]}
            ariaLabel={t('radio.playlistSource')}
            className="w-full"
          />
          {playlistId && (
            <div className="mt-2 flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={shuffle}
                  onChange={(e) => setShuffle(e.target.checked)}
                  className="yuzu-checkbox"
                />
                {t('roomAdmin.radioShuffle')}
              </label>
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={once}
                  onChange={(e) => setOnce(e.target.checked)}
                  className="yuzu-checkbox"
                />
                {t('roomAdmin.radioOnce')}
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => start(`playlist:${playlistId}`, shuffle, once)}
                className="ml-auto rounded-full bg-accent px-3.5 py-1 text-xs font-medium text-on-accent hover:brightness-105 disabled:opacity-40"
              >
                {t('roomAdmin.radioStart')}
              </button>
            </div>
          )}
        </div>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-[11px] text-faint hover:text-muted">
          {t('radio.advancedTitle')}
        </summary>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const source = rawSource.trim();
            if (source) start(source);
          }}
        >
          <input
            value={rawSource}
            onChange={(event) => setRawSource(event.target.value)}
            placeholder={t('roomAdmin.radioSourcePlaceholder')}
            className="min-w-0 flex-1 rounded-md border border-hairline bg-panel px-2.5 py-1.5 font-mono text-[12px] placeholder:text-faint"
          />
          <button
            type="submit"
            disabled={!rawSource.trim() || busy}
            className="flex-none rounded-full border border-hairline px-3 py-1 text-xs text-muted hover:text-paper disabled:opacity-40"
          >
            {t('roomAdmin.radioStart')}
          </button>
        </form>
      </details>
    </div>
  );
}
