import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlaylistDetail, PlaylistInfo } from '../../api/types';
import { api } from '../../app/session';
import { formatDateTime, formatMs } from '../format';
import { ConfirmDialog, Dialog, Select } from '../primitives';
import { useToast } from '../toast';

const PLAYLIST_PAGE_SIZE = 200;
const ADD_LIMIT = 100;
const inputClass =
  'w-full bg-panel border border-hairline rounded-md px-3 py-2 text-[13px] placeholder:text-faint focus:border-accent focus:outline-none';
const primaryButtonClass =
  'rounded-full bg-accent px-4 py-1.5 text-[13px] font-medium text-on-accent hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40';
const secondaryButtonClass =
  'rounded-full border border-hairline px-4 py-1.5 text-[13px] text-muted hover:border-faint hover:text-paper disabled:cursor-not-allowed disabled:opacity-40';

export default function PlaylistAdmin() {
  const { t } = useTranslation();
  const { show, showError } = useToast();
  const [playlists, setPlaylists] = useState<PlaylistInfo[] | null>(null);
  const [listBusy, setListBusy] = useState(false);
  const [detail, setDetail] = useState<PlaylistDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PlaylistInfo | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [trackRefsText, setTrackRefsText] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState('external');
  const [importProvider, setImportProvider] = useState('ncm');
  const [importPlaylistId, setImportPlaylistId] = useState('');
  const [importSource, setImportSource] = useState('');
  const [importName, setImportName] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [itemActionOrd, setItemActionOrd] = useState<number | null>(null);
  const activePlaylistId = useRef<string | null>(null);

  const loadPlaylists = useCallback(async () => {
    setListBusy(true);
    try {
      setPlaylists(await api.listPlaylists());
    } catch (error: unknown) {
      setPlaylists([]);
      showError(error);
    } finally {
      setListBusy(false);
    }
  }, [showError]);

  useEffect(() => {
    void loadPlaylists();
    return () => {
      activePlaylistId.current = null;
    };
  }, [loadPlaylists]);

  const openPlaylist = async (playlistId: string) => {
    activePlaylistId.current = playlistId;
    setDetailBusy(true);
    try {
      const next = await api.getPlaylist(playlistId, 0, PLAYLIST_PAGE_SIZE);
      if (activePlaylistId.current === playlistId) setDetail(next);
    } catch (error: unknown) {
      if (activePlaylistId.current === playlistId) showError(error);
    } finally {
      if (activePlaylistId.current === playlistId) setDetailBusy(false);
    }
  };

  const closeDetail = () => {
    activePlaylistId.current = null;
    setDetail(null);
    setDetailBusy(false);
    setLoadingMore(false);
  };

  const createPlaylist = async () => {
    const name = createName.trim();
    if (!name || createBusy) return;
    setCreateBusy(true);
    try {
      const created = await api.createPlaylist({
        name,
        description: createDescription.trim() || undefined,
      });
      setCreateOpen(false);
      setCreateName('');
      setCreateDescription('');
      show(t('admin.playlist.created'));
      await loadPlaylists();
      await openPlaylist(created.id);
    } catch (error: unknown) {
      showError(error);
    } finally {
      setCreateBusy(false);
    }
  };

  const deletePlaylist = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await api.deletePlaylist(target.id);
      if (detail?.playlist.id === target.id) closeDetail();
      show(t('admin.playlist.deleted'));
      await loadPlaylists();
    } catch (error: unknown) {
      showError(error);
    }
  };

  const parsedTrackRefs = trackRefsText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const tooManyTrackRefs = parsedTrackRefs.length > ADD_LIMIT;

  const addTracks = async () => {
    if (!detail || parsedTrackRefs.length === 0 || tooManyTrackRefs || addBusy) return;
    const playlistId = detail.playlist.id;
    setAddBusy(true);
    try {
      const result = await api.addPlaylistItems(playlistId, parsedTrackRefs);
      setAddOpen(false);
      setTrackRefsText('');
      show(t('admin.playlist.added', { count: result.added }));
      await openPlaylist(playlistId);
      await loadPlaylists();
    } catch (error: unknown) {
      showError(error);
    } finally {
      setAddBusy(false);
    }
  };

  const importPlaylist = async () => {
    const externalReady = importProvider.trim() && importPlaylistId.trim();
    const sourceReady = importSource.trim();
    if ((importMode === 'external' ? !externalReady : !sourceReady) || importBusy) return;
    setImportBusy(true);
    try {
      const imported = await api.importPlaylist(
        importMode === 'external'
          ? {
              provider: importProvider.trim(),
              playlist_id: importPlaylistId.trim(),
              name: importName.trim() || undefined,
            }
          : {
              source: importSource.trim(),
              name: importName.trim() || undefined,
            },
      );
      setImportOpen(false);
      setImportPlaylistId('');
      setImportSource('');
      setImportName('');
      show(t('admin.playlist.imported', { name: imported.name }));
      await loadPlaylists();
      await openPlaylist(imported.id);
    } catch (error: unknown) {
      showError(error);
    } finally {
      setImportBusy(false);
    }
  };

  const deleteItem = async (ord: number) => {
    if (!detail || itemActionOrd !== null) return;
    const playlistId = detail.playlist.id;
    setItemActionOrd(ord);
    try {
      await api.deletePlaylistItem(playlistId, ord);
      show(t('admin.playlist.itemDeleted'));
      await openPlaylist(playlistId);
      await loadPlaylists();
    } catch (error: unknown) {
      showError(error);
    } finally {
      setItemActionOrd(null);
    }
  };

  const moveItem = async (ord: number, destination: number) => {
    if (!detail || itemActionOrd !== null) return;
    const playlistId = detail.playlist.id;
    setItemActionOrd(ord);
    try {
      await api.movePlaylistItem(playlistId, ord, destination);
      show(t('admin.playlist.itemMoved'));
      await openPlaylist(playlistId);
    } catch (error: unknown) {
      showError(error);
    } finally {
      setItemActionOrd(null);
    }
  };

  const loadMore = async () => {
    if (!detail || loadingMore) return;
    const playlistId = detail.playlist.id;
    setLoadingMore(true);
    try {
      const page = await api.getPlaylist(playlistId, detail.items.length, PLAYLIST_PAGE_SIZE);
      setDetail((current) => {
        if (!current || current.playlist.id !== playlistId) return current;
        return { ...page, offset: 0, items: [...current.items, ...page.items] };
      });
    } catch (error: unknown) {
      showError(error);
    } finally {
      setLoadingMore(false);
    }
  };

  if (detail || detailBusy) {
    return (
      <section>
        <div className="mb-5 flex flex-wrap items-start gap-3 border-b border-hairline pb-5">
          <button type="button" onClick={closeDetail} className="text-[13px] text-muted hover:text-paper">
            {t('admin.playlist.backToList')}
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-2xl font-semibold">
              {detail?.playlist.name ?? t('common.loading')}
            </h2>
            {detail?.playlist.description && (
              <p className="mt-1 text-sm text-muted">{detail.playlist.description}</p>
            )}
          </div>
          {detail && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setImportOpen(true)} className={secondaryButtonClass}>
                {t('admin.playlist.import')}
              </button>
              <button type="button" onClick={() => setAddOpen(true)} className={primaryButtonClass}>
                {t('admin.playlist.addTracks')}
              </button>
            </div>
          )}
        </div>

        {detailBusy && !detail ? (
          <p className="py-10 text-center text-sm text-faint">{t('common.loading')}</p>
        ) : detail && detail.items.length === 0 ? (
          <p className="rounded-md border border-dashed border-hairline bg-panel px-4 py-10 text-center text-sm text-faint">
            {t('admin.playlist.emptyItems')}
          </p>
        ) : (
          detail && (
            <div className="overflow-x-auto rounded-md border border-hairline bg-panel">
              <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
                <thead className="bg-panel-2 text-[11px] uppercase tracking-[0.08em] text-faint">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t('admin.playlist.ord')}</th>
                    <th className="px-3 py-2 font-medium">{t('admin.playlist.trackTitle')}</th>
                    <th className="px-3 py-2 font-medium">{t('admin.playlist.artist')}</th>
                    <th className="px-3 py-2 font-medium">{t('admin.playlist.duration')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('admin.playlist.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((item) => {
                    const rowBusy = itemActionOrd === item.ord;
                    return (
                      <tr key={`${item.ord}:${item.track_ref}`} className="border-t border-hairline">
                        <td className="px-3 py-2.5 font-mono text-xs tabular-nums text-faint">{item.ord}</td>
                        <td className="max-w-[260px] px-3 py-2.5">
                          <div className="truncate font-medium">{item.title}</div>
                          <div className="truncate font-mono text-[10px] text-faint">{item.track_ref}</div>
                        </td>
                        <td className="max-w-[180px] truncate px-3 py-2.5 text-muted">{item.artist}</td>
                        <td className="px-3 py-2.5 font-mono text-xs tabular-nums text-muted">
                          {formatMs(item.duration_ms)}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => void moveItem(item.ord, item.ord - 1)}
                              disabled={item.ord <= 1 || itemActionOrd !== null}
                              aria-label={t('admin.playlist.moveUp', { title: item.title })}
                              title={t('admin.playlist.moveUp', { title: item.title })}
                              className="rounded border border-hairline px-2 py-1 text-xs text-muted hover:border-faint hover:text-paper disabled:opacity-30"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => void moveItem(item.ord, item.ord + 1)}
                              disabled={item.ord >= detail.playlist.track_count || itemActionOrd !== null}
                              aria-label={t('admin.playlist.moveDown', { title: item.title })}
                              title={t('admin.playlist.moveDown', { title: item.title })}
                              className="rounded border border-hairline px-2 py-1 text-xs text-muted hover:border-faint hover:text-paper disabled:opacity-30"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteItem(item.ord)}
                              disabled={itemActionOrd !== null}
                              className="px-2 py-1 text-xs text-[#D05A4E] hover:brightness-110 disabled:opacity-30"
                            >
                              {rowBusy ? t('admin.common.working') : t('admin.playlist.removeItem')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {detail.items.length < detail.playlist.track_count && (
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="w-full border-t border-hairline py-3 text-xs text-accent hover:bg-panel-2 disabled:opacity-40"
                >
                  {loadingMore ? t('admin.playlist.loadingMore') : t('admin.playlist.loadMore')}
                </button>
              )}
            </div>
          )
        )}

        <Dialog open={addOpen} onOpenChange={setAddOpen} title={t('admin.playlist.addDialogTitle')}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void addTracks();
            }}
          >
            <label className="block text-xs text-muted" htmlFor="admin-playlist-track-refs">
              {t('admin.playlist.trackRefsLabel')}
            </label>
            <textarea
              id="admin-playlist-track-refs"
              value={trackRefsText}
              onChange={(event) => setTrackRefsText(event.target.value)}
              rows={8}
              placeholder={t('admin.playlist.trackRefsPlaceholder')}
              className={`${inputClass} mt-1.5 resize-y font-mono`}
            />
            <p className={`mt-2 text-xs ${tooManyTrackRefs ? 'text-[#D05A4E]' : 'text-faint'}`}>
              {tooManyTrackRefs
                ? t('admin.playlist.tooManyTracks', { count: parsedTrackRefs.length, limit: ADD_LIMIT })
                : t('admin.playlist.trackRefCount', { count: parsedTrackRefs.length })}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setAddOpen(false)} className={secondaryButtonClass}>
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={addBusy || parsedTrackRefs.length === 0 || tooManyTrackRefs}
                className={primaryButtonClass}
              >
                {addBusy ? t('admin.common.working') : t('admin.playlist.addTracks')}
              </button>
            </div>
          </form>
        </Dialog>

        <Dialog open={importOpen} onOpenChange={setImportOpen} title={t('admin.playlist.importDialogTitle')}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void importPlaylist();
            }}
          >
            <label className="block text-xs text-muted">{t('admin.playlist.importModeLabel')}</label>
            <Select
              value={importMode}
              onValueChange={setImportMode}
              options={[
                { value: 'external', label: t('admin.playlist.importExternal') },
                { value: 'source', label: t('admin.playlist.importSource') },
              ]}
              className="mt-1.5 w-full"
            />
            {importMode === 'external' ? (
              <div className="mt-4 grid gap-4">
                <label className="text-xs text-muted">
                  {t('admin.playlist.providerLabel')}
                  <input
                    value={importProvider}
                    onChange={(event) => setImportProvider(event.target.value)}
                    className={`${inputClass} mt-1.5`}
                    required
                  />
                </label>
                <label className="text-xs text-muted">
                  {t('admin.playlist.playlistIdLabel')}
                  <input
                    value={importPlaylistId}
                    onChange={(event) => setImportPlaylistId(event.target.value)}
                    placeholder={t('admin.playlist.playlistIdPlaceholder')}
                    className={`${inputClass} mt-1.5`}
                    required
                  />
                </label>
              </div>
            ) : (
              <label className="mt-4 block text-xs text-muted">
                {t('admin.playlist.sourceLabel')}
                <input
                  value={importSource}
                  onChange={(event) => setImportSource(event.target.value)}
                  placeholder={t('admin.playlist.sourcePlaceholder')}
                  className={`${inputClass} mt-1.5`}
                  required
                />
              </label>
            )}
            <label className="mt-4 block text-xs text-muted">
              {t('admin.playlist.importNameLabel')}
              <input
                value={importName}
                onChange={(event) => setImportName(event.target.value)}
                placeholder={t('admin.playlist.importNamePlaceholder')}
                className={`${inputClass} mt-1.5`}
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setImportOpen(false)} className={secondaryButtonClass}>
                {t('common.cancel')}
              </button>
              <button type="submit" disabled={importBusy} className={primaryButtonClass}>
                {importBusy ? t('admin.common.working') : t('admin.playlist.import')}
              </button>
            </div>
          </form>
        </Dialog>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold">{t('admin.playlist.heading')}</h2>
          <p className="mt-1 text-sm text-muted">{t('admin.playlist.intro')}</p>
        </div>
        <button type="button" onClick={() => setCreateOpen(true)} className={primaryButtonClass}>
          {t('admin.playlist.new')}
        </button>
      </div>

      {playlists === null || (listBusy && playlists.length === 0) ? (
        <p className="py-10 text-center text-sm text-faint">{t('common.loading')}</p>
      ) : playlists.length === 0 ? (
        <p className="rounded-md border border-dashed border-hairline bg-panel px-4 py-10 text-center text-sm text-faint">
          {t('admin.playlist.empty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-hairline bg-panel">
          <table className="w-full min-w-[680px] border-collapse text-left text-[13px]">
            <thead className="bg-panel-2 text-[11px] uppercase tracking-[0.08em] text-faint">
              <tr>
                <th className="px-4 py-2 font-medium">{t('admin.playlist.name')}</th>
                <th className="px-4 py-2 font-medium">{t('admin.playlist.trackCount')}</th>
                <th className="px-4 py-2 font-medium">{t('admin.playlist.description')}</th>
                <th className="px-4 py-2 font-medium">{t('admin.playlist.updatedAt')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('admin.playlist.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {playlists.map((playlist) => (
                <tr key={playlist.id} className="border-t border-hairline hover:bg-panel-2">
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => void openPlaylist(playlist.id)}
                      className="font-medium text-paper hover:text-accent"
                    >
                      {playlist.name}
                    </button>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted">
                    {playlist.track_count}
                  </td>
                  <td className="max-w-[260px] truncate px-4 py-3 text-muted">
                    {playlist.description || t('admin.common.none')}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted">
                    {formatDateTime(playlist.updated_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(playlist)}
                      className="text-xs text-[#D05A4E] hover:brightness-110"
                    >
                      {t('admin.playlist.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen} title={t('admin.playlist.createDialogTitle')}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void createPlaylist();
          }}
        >
          <label className="block text-xs text-muted" htmlFor="admin-playlist-name">
            {t('admin.playlist.nameLabel')}
          </label>
          <input
            id="admin-playlist-name"
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            placeholder={t('admin.playlist.namePlaceholder')}
            className={`${inputClass} mt-1.5`}
            required
          />
          <label className="mt-4 block text-xs text-muted" htmlFor="admin-playlist-description">
            {t('admin.playlist.descriptionLabel')}
          </label>
          <textarea
            id="admin-playlist-description"
            value={createDescription}
            onChange={(event) => setCreateDescription(event.target.value)}
            placeholder={t('admin.playlist.descriptionPlaceholder')}
            rows={3}
            className={`${inputClass} mt-1.5 resize-y`}
          />
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setCreateOpen(false)} className={secondaryButtonClass}>
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={createBusy || !createName.trim()} className={primaryButtonClass}>
              {createBusy ? t('admin.common.working') : t('admin.playlist.create')}
            </button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t('admin.playlist.deleteDialogTitle')}
        description={t('admin.playlist.deleteDialogDescription', { name: deleteTarget?.name ?? '' })}
        confirmText={t('admin.playlist.delete')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => void deletePlaylist()}
      />
    </section>
  );
}
