import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toDataURL } from 'qrcode';
import type { CacheOverview, LocalMediaInfo, ProviderInfo } from '../../api/types';
import { api } from '../../app/session';
import { formatBytes, formatDateTime, formatMs } from '../format';
import { ConfirmDialog, Dialog } from '../primitives';
import { useToast } from '../toast';

const inputClass =
  'w-full bg-panel border border-hairline rounded-md px-3 py-2 text-[13px] placeholder:text-faint focus:border-accent focus:outline-none';
const primaryButtonClass =
  'rounded-full bg-accent px-4 py-1.5 text-[13px] font-medium text-on-accent hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40';
const secondaryButtonClass =
  'rounded-full border border-hairline px-4 py-1.5 text-[13px] text-muted hover:border-faint hover:text-paper disabled:cursor-not-allowed disabled:opacity-40';
const credentialStatusKeys: Record<string, string> = {
  ok: 'admin.media.credentialStatusOk',
  invalid: 'admin.media.credentialStatusInvalid',
  unset: 'admin.media.credentialStatusUnset',
};
const downloadStatusKeys: Record<string, string> = {
  downloading: 'admin.media.downloadStatusDownloading',
  ok: 'admin.media.downloadStatusOk',
  failed: 'admin.media.downloadStatusFailed',
};
const qrStatusKeys: Record<string, string> = {
  waiting: 'admin.media.qrWaiting',
  scanned: 'admin.media.qrScanned',
  ok: 'admin.media.qrOk',
  expired: 'admin.media.qrExpired',
  error: 'admin.media.qrError',
};

export default function MediaAdmin() {
  const { t } = useTranslation();
  const { show, showError } = useToast();
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [cache, setCache] = useState<CacheOverview | null>(null);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [media, setMedia] = useState<LocalMediaInfo[] | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LocalMediaInfo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [mediaExpanded, setMediaExpanded] = useState(false);
  const [pruneOpen, setPruneOpen] = useState(false);
  const [pruneDays, setPruneDays] = useState('7');
  const [pruneBusy, setPruneBusy] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadArtist, setUploadArtist] = useState('');
  const [uploadBusy, setUploadBusy] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null);
  const [credentialProvider, setCredentialProvider] = useState<string | null>(null);
  const [credentialPayload, setCredentialPayload] = useState('');
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [evictingRefs, setEvictingRefs] = useState<Set<string>>(() => new Set());
  const [qrProvider, setQrProvider] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrStatus, setQrStatus] = useState('waiting');
  const [qrStarting, setQrStarting] = useState(false);
  const qrInterval = useRef(0);
  const qrGeneration = useRef(0);

  const loadProviders = useCallback(async () => {
    try {
      setProviders(await api.listProviders());
    } catch (error: unknown) {
      setProviders([]);
      showError(error);
    }
  }, [showError]);

  const loadCache = useCallback(async () => {
    setCacheBusy(true);
    try {
      setCache(await api.listCache());
    } catch (error: unknown) {
      setCache({ entries: [], downloads: [], history: [], total_bytes: 0, max_bytes: 0 });
      showError(error);
    } finally {
      setCacheBusy(false);
    }
  }, [showError]);

  const loadMedia = useCallback(async () => {
    setMediaBusy(true);
    try {
      setMedia(await api.listMedia());
    } catch (error: unknown) {
      setMedia([]);
      showError(error);
    } finally {
      setMediaBusy(false);
    }
  }, [showError]);

  useEffect(() => {
    void loadProviders();
    void loadCache();
    void loadMedia();
    return () => {
      qrGeneration.current += 1;
      clearInterval(qrInterval.current);
    };
  }, [loadCache, loadProviders, loadMedia]);

  const runPrune = async () => {
    const days = Math.max(0, Math.floor(Number(pruneDays) || 0));
    if (pruneBusy) return;
    setPruneBusy(true);
    try {
      const result = await api.pruneCache(days);
      show(t('admin.media.prunedToast', { count: result.evicted, freed: formatBytes(result.freed_bytes) }));
      setPruneOpen(false);
      await loadCache();
    } catch (error: unknown) {
      showError(error);
    } finally {
      setPruneBusy(false);
    }
  };

  const confirmDeleteMedia = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await api.deleteMedia(deleteTarget.track_ref);
      show(t('admin.media.deletedToast', { title: deleteTarget.title }));
      setDeleteTarget(null);
      await loadMedia();
    } catch (error: unknown) {
      showError(error);
    } finally {
      setDeleting(false);
    }
  };

  const upload = async () => {
    if (!uploadFile || uploadBusy) return;
    setUploadBusy(true);
    try {
      const track = await api.uploadMedia(uploadFile, {
        title: uploadTitle.trim() || undefined,
        artist: uploadArtist.trim() || undefined,
      });
      show(t('admin.media.uploaded', { title: track.title }));
      setUploadFile(null);
      setUploadTitle('');
      setUploadArtist('');
      if (uploadInput.current) uploadInput.current.value = '';
      await loadCache();
      await loadMedia();
    } catch (error: unknown) {
      showError(error);
    } finally {
      setUploadBusy(false);
    }
  };

  const saveCredential = async () => {
    if (!credentialProvider || !credentialPayload.trim() || credentialBusy) return;
    setCredentialBusy(true);
    try {
      await api.setCredential(credentialProvider, credentialPayload.trim());
      show(t('admin.media.credentialSaved', { provider: credentialProvider }));
      setCredentialProvider(null);
      setCredentialPayload('');
      await loadProviders();
    } catch (error: unknown) {
      showError(error);
    } finally {
      setCredentialBusy(false);
    }
  };

  const startQrLogin = async (providerId: string) => {
    const generation = qrGeneration.current + 1;
    qrGeneration.current = generation;
    clearInterval(qrInterval.current);
    qrInterval.current = 0;
    setQrProvider(providerId);
    setQrDataUrl('');
    setQrStatus('waiting');
    setQrStarting(true);
    try {
      const session = await api.qrLoginStart(providerId);
      const dataUrl = await toDataURL(session.qr_content, {
        width: 264,
        margin: 2,
        color: { dark: '#111111', light: '#ffffff' },
      });
      if (qrGeneration.current !== generation) return;
      setQrDataUrl(dataUrl);
      setQrStarting(false);
      let polling = false;
      const poll = async () => {
        if (polling || qrGeneration.current !== generation) return;
        polling = true;
        try {
          const result = await api.qrLoginPoll(providerId, session.key);
          if (qrGeneration.current !== generation) return;
          setQrStatus(result.status);
          if (result.status === 'ok' || result.status === 'expired') {
            clearInterval(qrInterval.current);
            qrInterval.current = 0;
            if (result.status === 'ok') {
              show(t('admin.media.qrSuccess', { provider: providerId }));
              await loadProviders();
            }
          }
        } catch (error: unknown) {
          if (qrGeneration.current !== generation) return;
          clearInterval(qrInterval.current);
          qrInterval.current = 0;
          setQrStatus('error');
          showError(error);
        } finally {
          polling = false;
        }
      };
      qrInterval.current = window.setInterval(() => void poll(), 2000);
    } catch (error: unknown) {
      if (qrGeneration.current !== generation) return;
      setQrStarting(false);
      setQrStatus('error');
      showError(error);
    }
  };

  const closeQrDialog = () => {
    qrGeneration.current += 1;
    clearInterval(qrInterval.current);
    qrInterval.current = 0;
    setQrProvider(null);
    setQrDataUrl('');
    setQrStatus('waiting');
    setQrStarting(false);
  };

  const evict = async (trackRef: string) => {
    if (evictingRefs.has(trackRef)) return;
    setEvictingRefs((current) => new Set(current).add(trackRef));
    try {
      await api.evictCache(trackRef);
      show(t('admin.media.cacheEvicted'));
      await loadCache();
    } catch (error: unknown) {
      showError(error);
    } finally {
      setEvictingRefs((current) => {
        const next = new Set(current);
        next.delete(trackRef);
        return next;
      });
    }
  };

  return (
    <div className="grid gap-7">
      <section className="rounded-md border border-hairline bg-panel p-5">
        <div className="mb-4">
          <h2 className="font-display text-xl font-semibold">{t('admin.media.uploadHeading')}</h2>
          <p className="mt-1 text-sm text-muted">{t('admin.media.uploadIntro')}</p>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void upload();
          }}
          className="grid gap-3 md:grid-cols-[minmax(180px,1.2fr)_1fr_1fr_auto] md:items-end"
        >
          <label className="text-xs text-muted">
            {t('admin.media.fileLabel')}
            <input
              ref={uploadInput}
              type="file"
              accept="audio/*"
              onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
              className="mt-1.5 block w-full text-xs text-muted file:mr-3 file:rounded-full file:border file:border-hairline file:bg-panel-2 file:px-3 file:py-1.5 file:text-xs file:text-paper"
              required
            />
          </label>
          <label className="text-xs text-muted">
            {t('admin.media.titleLabel')}
            <input
              value={uploadTitle}
              onChange={(event) => setUploadTitle(event.target.value)}
              placeholder={t('admin.media.titlePlaceholder')}
              className={`${inputClass} mt-1.5`}
            />
          </label>
          <label className="text-xs text-muted">
            {t('admin.media.artistLabel')}
            <input
              value={uploadArtist}
              onChange={(event) => setUploadArtist(event.target.value)}
              placeholder={t('admin.media.artistPlaceholder')}
              className={`${inputClass} mt-1.5`}
            />
          </label>
          <button type="submit" disabled={!uploadFile || uploadBusy} className={primaryButtonClass}>
            {uploadBusy ? t('admin.media.uploading') : t('admin.media.upload')}
          </button>
        </form>
      </section>

      <section>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold">{t('admin.media.libraryHeading')}</h2>
            <p className="mt-1 text-sm text-muted">{t('admin.media.libraryIntro')}</p>
          </div>
          <button type="button" onClick={() => void loadMedia()} disabled={mediaBusy} className={secondaryButtonClass}>
            {mediaBusy ? t('admin.common.working') : t('admin.common.refresh')}
          </button>
        </div>
        {media === null ? (
          <p className="py-6 text-center text-sm text-faint">{t('common.loading')}</p>
        ) : media.length === 0 ? (
          <p className="py-6 text-center text-sm text-faint">{t('admin.media.libraryEmpty')}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-hairline">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-hairline text-xs text-faint">
                  <th className="px-3 py-2 font-medium">{t('admin.media.colTitle')}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.media.colArtist')}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.media.durationLabel')}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.media.sizeLabel')}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.media.uploadedByLabel')}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.media.createdAtLabel')}</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {(mediaExpanded ? media : media.slice(0, 10)).map((item) => (
                  <tr key={item.track_ref} className="border-b border-hairline last:border-b-0 hover:bg-panel-2">
                    <td className="max-w-[220px] truncate px-3 py-2.5">{item.title}</td>
                    <td className="max-w-[160px] truncate px-3 py-2.5 text-muted">{item.artist || t('admin.common.none')}</td>
                    <td className="px-3 py-2.5 font-mono tabular-nums text-muted">{formatMs(item.duration_ms)}</td>
                    <td className="px-3 py-2.5 font-mono tabular-nums text-muted">{formatBytes(item.size_bytes)}</td>
                    <td className="max-w-[120px] truncate px-3 py-2.5 font-mono text-xs text-muted">{item.uploaded_by}</td>
                    <td className="px-3 py-2.5 font-mono tabular-nums text-muted">{formatDateTime(item.created_at)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(item)}
                        className="text-xs text-muted hover:text-[#D05A4E]"
                      >
                        {t('admin.media.deleteAction')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!mediaExpanded && media.length > 10 && (
              <button
                type="button"
                onClick={() => setMediaExpanded(true)}
                className="w-full border-t border-hairline py-2.5 text-xs text-accent"
              >
                {t('admin.media.showAllCount', { count: media.length })}
              </button>
            )}
          </div>
        )}
      </section>

      <section>
        <div className="mb-4">
          <h2 className="font-display text-xl font-semibold">{t('admin.media.providersHeading')}</h2>
          <p className="mt-1 text-sm text-muted">{t('admin.media.providersIntro')}</p>
        </div>
        {providers === null ? (
          <p className="py-6 text-center text-sm text-faint">{t('common.loading')}</p>
        ) : providers.length === 0 ? (
          <p className="rounded-md border border-dashed border-hairline bg-panel px-4 py-8 text-center text-sm text-faint">
            {t('admin.media.providersEmpty')}
          </p>
        ) : (
          <div className="grid gap-2">
            {providers.map((provider) => {
              const statusKey =
                credentialStatusKeys[provider.credential_status ?? ''] ?? 'admin.media.credentialStatusUnavailable';
              return (
                <div
                  key={provider.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-hairline bg-panel px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-sm font-medium">{provider.id}</div>
                    <div className="mt-0.5 text-xs text-muted">{t(statusKey)}</div>
                  </div>
                  {provider.credential_status !== undefined && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setCredentialPayload('');
                          setCredentialProvider(provider.id);
                        }}
                        className={secondaryButtonClass}
                      >
                        {t('admin.media.updateCredential')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void startQrLogin(provider.id)}
                        className={secondaryButtonClass}
                      >
                        {t('admin.media.qrLogin')}
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold">{t('admin.media.cacheHeading')}</h2>
            <p className="mt-1 text-sm text-muted">{t('admin.media.cacheIntro')}</p>
            {cache && (
              <p className="mt-1 font-mono text-xs text-faint tabular-nums">
                {t('admin.media.cacheTotal', {
                  used: formatBytes(cache.total_bytes),
                  max: formatBytes(cache.max_bytes),
                })}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPruneOpen(true)} className={secondaryButtonClass}>
              {t('admin.media.pruneAction')}
            </button>
            <button type="button" onClick={() => void loadCache()} disabled={cacheBusy} className={secondaryButtonClass}>
              {cacheBusy ? t('admin.common.working') : t('admin.common.refresh')}
            </button>
          </div>
        </div>

        {cache === null ? (
          <p className="py-8 text-center text-sm text-faint">{t('common.loading')}</p>
        ) : (
          <div className="grid gap-5">
            <CacheEntries
              cache={cache}
              evictingRefs={evictingRefs}
              onEvict={(trackRef) => void evict(trackRef)}
            />
            <CacheDownloads cache={cache} />
            <CacheHistory cache={cache} />
          </div>
        )}
      </section>

      <Dialog
        open={credentialProvider !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCredentialProvider(null);
            setCredentialPayload('');
          }
        }}
        title={t('admin.media.credentialDialogTitle', { provider: credentialProvider ?? '' })}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void saveCredential();
          }}
        >
          <label className="block text-xs text-muted" htmlFor="admin-credential-payload">
            {t('admin.media.credentialPayloadLabel')}
          </label>
          <textarea
            id="admin-credential-payload"
            value={credentialPayload}
            onChange={(event) => setCredentialPayload(event.target.value)}
            placeholder={t('admin.media.credentialPayloadPlaceholder')}
            rows={5}
            className={`${inputClass} mt-1.5 resize-y font-mono`}
            required
          />
          <p className="mt-2 text-xs text-faint">{t('admin.media.credentialNote')}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setCredentialProvider(null);
                setCredentialPayload('');
              }}
              className={secondaryButtonClass}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={!credentialPayload.trim() || credentialBusy}
              className={primaryButtonClass}
            >
              {credentialBusy ? t('admin.common.working') : t('admin.media.saveCredential')}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={qrProvider !== null}
        onOpenChange={(open) => {
          if (!open) closeQrDialog();
        }}
        title={t('admin.media.qrDialogTitle', { provider: qrProvider ?? '' })}
      >
        <div className="text-center">
          {qrStarting ? (
            <div className="grid min-h-64 place-items-center rounded-md border border-hairline bg-white text-sm text-[#555]">
              {t('admin.media.qrStarting')}
            </div>
          ) : qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={t('admin.media.qrCodeAlt', { provider: qrProvider ?? '' })}
              className="mx-auto w-64 rounded-md border border-hairline bg-white"
            />
          ) : (
            <div className="grid min-h-64 place-items-center rounded-md border border-hairline bg-panel text-sm text-faint">
              {t(qrStatusKeys[qrStatus] ?? qrStatusKeys.error)}
            </div>
          )}
          <p
            className={`mt-4 text-sm ${
              qrStatus === 'ok' ? 'text-accent' : qrStatus === 'expired' || qrStatus === 'error' ? 'text-[#D05A4E]' : 'text-muted'
            }`}
          >
            {qrStarting ? t('admin.media.qrStarting') : t(qrStatusKeys[qrStatus] ?? qrStatusKeys.error)}
          </p>
          <div className="mt-5 flex justify-center gap-2">
            {(qrStatus === 'expired' || qrStatus === 'error') && qrProvider && (
              <button type="button" onClick={() => void startQrLogin(qrProvider)} className={primaryButtonClass}>
                {t('admin.media.qrRestart')}
              </button>
            )}
            <button type="button" onClick={closeQrDialog} className={secondaryButtonClass}>
              {t('admin.common.close')}
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={pruneOpen}
        onOpenChange={setPruneOpen}
        title={t('admin.media.pruneTitle')}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void runPrune();
          }}
        >
          <label className="block text-xs text-muted">
            {t('admin.media.pruneDaysLabel')}
            <input
              type="number"
              min="0"
              step="1"
              value={pruneDays}
              onChange={(event) => setPruneDays(event.target.value)}
              className={`${inputClass} mt-1.5`}
              required
            />
          </label>
          <p className="mt-2 text-xs text-faint">{t('admin.media.pruneNote')}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setPruneOpen(false)} className={secondaryButtonClass}>
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={pruneBusy} className={primaryButtonClass}>
              {pruneBusy ? t('admin.common.working') : t('admin.media.pruneConfirm')}
            </button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t('admin.media.deleteTitle')}
        description={deleteTarget ? t('admin.media.deleteConfirm', { title: deleteTarget.title }) : undefined}
        confirmText={deleting ? t('admin.common.working') : t('admin.media.deleteAction')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => void confirmDeleteMedia()}
      />
    </div>
  );
}

function CacheEntries({
  cache,
  evictingRefs,
  onEvict,
}: {
  cache: CacheOverview;
  evictingRefs: Set<string>;
  onEvict: (trackRef: string) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const visibleEntries = expanded ? cache.entries : cache.entries.slice(0, 10);
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">{t('admin.media.cacheEntriesHeading')}</h3>
      {cache.entries.length === 0 ? (
        <p className="rounded-md border border-dashed border-hairline bg-panel px-4 py-6 text-center text-xs text-faint">
          {t('admin.media.cacheEntriesEmpty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-hairline bg-panel">
          <table className="w-full min-w-[700px] border-collapse text-left text-xs">
            <thead className="bg-panel-2 text-[10px] uppercase tracking-[0.08em] text-faint">
              <tr>
                <th className="px-3 py-2 font-medium">{t('admin.media.trackRef')}</th>
                <th className="px-3 py-2 font-medium">{t('admin.media.size')}</th>
                <th className="px-3 py-2 font-medium">{t('admin.media.bitrate')}</th>
                <th className="px-3 py-2 font-medium">{t('admin.media.lastAccess')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('admin.playlist.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {visibleEntries.map((entry) => (
                <tr key={entry.track_ref} className="border-t border-hairline">
                  <td className="max-w-[300px] truncate px-3 py-2.5 font-mono">{entry.track_ref}</td>
                  <td className="px-3 py-2.5 font-mono tabular-nums text-muted">
                    {formatBytes(entry.size_bytes)}
                  </td>
                  <td className="px-3 py-2.5 font-mono tabular-nums text-muted">
                    {t('admin.media.bitrateValue', { value: entry.bitrate_kbps })}
                  </td>
                  <td className="px-3 py-2.5 font-mono tabular-nums text-muted">
                    {formatDateTime(entry.last_accessed_at)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => onEvict(entry.track_ref)}
                      disabled={evictingRefs.has(entry.track_ref)}
                      className="text-xs text-[#D05A4E] hover:brightness-110 disabled:opacity-40"
                    >
                      {evictingRefs.has(entry.track_ref)
                        ? t('admin.common.working')
                        : t('admin.media.evictCache')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!expanded && cache.entries.length > 10 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="w-full border-t border-hairline py-2.5 text-xs text-accent"
            >
              {t('admin.media.showAllCount', { count: cache.entries.length })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CacheDownloads({ cache }: { cache: CacheOverview }) {
  const { t } = useTranslation();
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">{t('admin.media.downloadsHeading')}</h3>
      {cache.downloads.length === 0 ? (
        <p className="rounded-md border border-dashed border-hairline bg-panel px-4 py-6 text-center text-xs text-faint">
          {t('admin.media.downloadsEmpty')}
        </p>
      ) : (
        <div className="grid gap-2">
          {cache.downloads.map((download) => {
            const progress =
              download.total_bytes > 0
                ? Math.min(100, Math.max(0, (download.fetched_bytes / download.total_bytes) * 100))
                : 0;
            return (
              <div key={`${download.track_ref}:${download.started_at}`} className="rounded-md border border-hairline bg-panel p-3">
                <div className="flex items-center justify-between gap-4 text-xs">
                  <span className="min-w-0 truncate font-mono">{download.track_ref}</span>
                  <span className="shrink-0 font-mono tabular-nums text-muted">
                    {formatBytes(download.fetched_bytes)} / {formatBytes(download.total_bytes)}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--rail)]">
                  <div className="h-full bg-accent transition-[width]" style={{ width: `${progress}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CacheHistory({ cache }: { cache: CacheOverview }) {
  const { t } = useTranslation();
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">{t('admin.media.historyHeading')}</h3>
      {cache.history.length === 0 ? (
        <p className="rounded-md border border-dashed border-hairline bg-panel px-4 py-6 text-center text-xs text-faint">
          {t('admin.media.historyEmpty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-hairline bg-panel">
          <table className="w-full min-w-[620px] border-collapse text-left text-xs">
            <thead className="bg-panel-2 text-[10px] uppercase tracking-[0.08em] text-faint">
              <tr>
                <th className="px-3 py-2 font-medium">{t('admin.media.trackRef')}</th>
                <th className="px-3 py-2 font-medium">{t('admin.media.status')}</th>
                <th className="px-3 py-2 font-medium">{t('admin.media.size')}</th>
                <th className="px-3 py-2 font-medium">{t('admin.media.finishedAt')}</th>
              </tr>
            </thead>
            <tbody>
              {cache.history.map((download) => (
                <tr key={`${download.track_ref}:${download.started_at}`} className="border-t border-hairline">
                  <td className="max-w-[300px] truncate px-3 py-2.5 font-mono">{download.track_ref}</td>
                  <td className="px-3 py-2.5 text-muted">
                    {t(downloadStatusKeys[download.status] ?? 'admin.media.downloadStatusUnknown')}
                  </td>
                  <td className="px-3 py-2.5 font-mono tabular-nums text-muted">
                    {formatBytes(download.fetched_bytes)}
                  </td>
                  <td className="px-3 py-2.5 font-mono tabular-nums text-muted">
                    {formatDateTime(download.finished_at ?? download.started_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
