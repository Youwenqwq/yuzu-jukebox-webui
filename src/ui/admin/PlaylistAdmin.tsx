import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListMusic } from 'lucide-react';
import type { PlaylistDetail, PlaylistInfo } from '../../api/types';
import { api } from '../../app/session';
import { coverSrc } from '../cover';
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
  const [importBind, setImportBind] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [bindActionBusy, setBindActionBusy] = useState(false);
  const [itemActionOrd, setItemActionOrd] = useState<number | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
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
      const imported =
        importMode === 'external' && importBind
          ? await api.bindPlaylist({
              provider: importProvider.trim(),
              playlist_id: importPlaylistId.trim(),
              name: importName.trim() || undefined,
            })
          : await api.importPlaylist(
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
      setImportBind(false);
      show(
        importMode === 'external' && importBind
          ? t('admin.playlist.bound', { name: imported.name })
          : t('admin.playlist.imported', { name: imported.name }),
      );
      await loadPlaylists();
      await openPlaylist(imported.id);
    } catch (error: unknown) {
      showError(error);
    } finally {
      setImportBusy(false);
    }
  };

  /** 绑定歌单：手动同步 / 解除绑定（只读语义见 spec「Provider 绑定歌单」）。 */
  const syncBound = async () => {
    if (!detail || bindActionBusy) return;
    setBindActionBusy(true);
    try {
      await api.syncPlaylist(detail.playlist.id);
      show(t('admin.playlist.synced'));
      await openPlaylist(detail.playlist.id);
      await loadPlaylists();
    } catch (error: unknown) {
      showError(error);
    } finally {
      setBindActionBusy(false);
    }
  };

  const detachBound = async () => {
    if (!detail || bindActionBusy) return;
    setBindActionBusy(true);
    try {
      await api.detachPlaylist(detail.playlist.id);
      show(t('admin.playlist.detached'));
      await openPlaylist(detail.playlist.id);
      await loadPlaylists();
    } catch (error: unknown) {
      showError(error);
    } finally {
      setBindActionBusy(false);
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

  /** 自建歌单封面：multipart 上传（image/*，≤8MB）；绑定歌单由服务端 409 拒绝。 */
  const applyCover = async (file: File) => {
    if (!detail || coverBusy) return;
    if (file.size > 8 * 1024 * 1024) {
      show(t('admin.playlist.coverTooLarge'));
      return;
    }
    setCoverBusy(true);
    try {
      await api.setPlaylistCover(detail.playlist.id, file);
      show(t('admin.playlist.coverSet'));
      await openPlaylist(detail.playlist.id);
      await loadPlaylists();
    } catch (error: unknown) {
      showError(error);
    } finally {
      setCoverBusy(false);
    }
  };

  const clearCover = async () => {
    if (!detail || coverBusy) return;
    setCoverBusy(true);
    try {
      await api.clearPlaylistCover(detail.playlist.id);
      show(t('admin.playlist.coverCleared'));
      await openPlaylist(detail.playlist.id);
      await loadPlaylists();
    } catch (error: unknown) {
      showError(error);
    } finally {
      setCoverBusy(false);
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
          {detail?.playlist.cover_url ? (
            <img
              src={coverSrc(detail.playlist.cover_url)}
              alt=""
              className="h-24 w-24 flex-none rounded-lg object-cover"
            />
          ) : (
            <span className="grid h-24 w-24 flex-none place-items-center rounded-lg bg-panel-2 text-faint">
              <ListMusic className="h-8 w-8" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-2xl font-semibold">
              {detail?.playlist.name ?? t('common.loading')}
            </h2>
            {detail?.playlist.description && (
              <p className="mt-1 text-sm text-muted">{detail.playlist.description}</p>
            )}
          </div>
          {detail && !detail.playlist.bound_provider && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setAddOpen(true)} className={primaryButtonClass}>
                {t('admin.playlist.addTracks')}
              </button>
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                disabled={coverBusy}
                className={secondaryButtonClass}
              >
                {coverBusy ? t('admin.common.working') : t('admin.playlist.setCover')}
              </button>
              {detail.playlist.cover_url && (
                <button
                  type="button"
                  onClick={() => void clearCover()}
                  disabled={coverBusy}
                  className={secondaryButtonClass}
                >
                  {t('admin.playlist.clearCover')}
                </button>
              )}
            </div>
          )}
          {detail?.playlist.bound_provider && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void syncBound()}
                disabled={bindActionBusy}
                className={primaryButtonClass}
              >
                {bindActionBusy ? t('admin.common.working') : t('admin.playlist.syncNow')}
              </button>
              <button
                type="button"
                onClick={() => void detachBound()}
                disabled={bindActionBusy}
                className={secondaryButtonClass}
              >
                {t('admin.playlist.detach')}
              </button>
            </div>
          )}
        </div>

        {/* 绑定歌单：只读提示 + 同步状态（失败保留旧快照，原因可见） */}
        {detail?.playlist.bound_provider && (
          <div className="mb-4 rounded-md border border-hairline bg-panel px-4 py-3 text-xs text-muted">
            <span className="text-accent">
              {t('admin.playlist.boundBadge', { provider: detail.playlist.bound_provider })}
            </span>
            <span className="ml-3">{t('admin.playlist.boundReadonly')}</span>
            {detail.playlist.last_sync_at !== undefined && detail.playlist.last_sync_at > 0 && (
              <span className="ml-3 text-faint">
                {t('admin.playlist.lastSync', { time: formatDateTime(detail.playlist.last_sync_at) })}
              </span>
            )}
            {detail.playlist.last_sync_error && (
              <div className="mt-1.5 text-[#D05A4E]">{detail.playlist.last_sync_error}</div>
            )}
          </div>
        )}

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
                          {/* 绑定歌单只读：items 变更会被服务端 409，直接不渲染操作 */}
                          {!detail.playlist.bound_provider && (
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
                          )}
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

        {/* 封面文件选择：由「设置封面」按钮触发；选择即上传 */}
        <input
          ref={coverInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void applyCover(file);
            event.target.value = '';
          }}
        />

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
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setImportOpen(true)} className={secondaryButtonClass}>
            {t('admin.playlist.import')}
          </button>
          <button type="button" onClick={() => setCreateOpen(true)} className={primaryButtonClass}>
            {t('admin.playlist.new')}
          </button>
        </div>
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
                    {playlist.bound_provider && (
                      <span className="ml-2 rounded-full border border-hairline px-2 py-0.5 text-[10.5px] text-faint">
                        {t('admin.playlist.boundBadge', { provider: playlist.bound_provider })}
                      </span>
                    )}
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
              <label className="flex items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={importBind}
                  onChange={(event) => setImportBind(event.target.checked)}
                  className="yuzu-checkbox"
                />
                {t('admin.playlist.bindFollow')}
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
