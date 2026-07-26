import { useEffect, useRef, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlaylistDetail, PlaylistInfo, SearchTrack } from '../api/types';
import { api, roomStore } from '../app/session';
import { formatMs } from './format';

type BatchTab = 'search' | 'playlist';

interface BatchAddPanelProps {
  onToast: (msg: string) => void;
  onError: (err: unknown) => void;
}

const PLAYLIST_PAGE_SIZE = 50;
const QUEUE_CHUNK_SIZE = 100;

export function BatchAddPanel({ onToast, onError }: BatchAddPanelProps): JSX.Element {
  const { t } = useTranslation();
  const [tab, setTab] = useState<BatchTab>('search');
  const [providers, setProviders] = useState<string[]>([]);
  const [provider, setProvider] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchTrack[] | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(() => new Set());
  const [playlists, setPlaylists] = useState<PlaylistInfo[] | null>(null);
  const [playlistDetail, setPlaylistDetail] = useState<PlaylistDetail | null>(null);
  const [playlistBusy, setPlaylistBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [queueBusy, setQueueBusy] = useState(false);
  const playlistRequest = useRef(0);

  useEffect(() => {
    let cancelled = false;
    api
      .listProviders()
      .then((list) => {
        if (cancelled) return;
        const ids = list.map((item) => item.id);
        setProviders(ids);
        if (ids.length > 0) setProvider((current) => current || ids[0]);
      })
      .catch(onError);
    return () => {
      cancelled = true;
    };
  }, [onError]);

  useEffect(() => {
    let cancelled = false;
    api
      .listPlaylists()
      .then((list) => {
        if (!cancelled) setPlaylists(list);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPlaylists([]);
        onError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [onError]);

  const runSearch = () => {
    if (!query.trim() || !provider) return;
    setSearchBusy(true);
    api
      .search(provider, query.trim())
      .then(setResults)
      .catch((error: unknown) => {
        setResults([]);
        onError(error);
      })
      .finally(() => setSearchBusy(false));
  };

  const toggleRef = (trackRef: string) => {
    setSelectedRefs((current) => {
      const next = new Set(current);
      if (next.has(trackRef)) next.delete(trackRef);
      else next.add(trackRef);
      return next;
    });
  };

  const enqueueRefs = async (refs: string[]) => {
    for (let offset = 0; offset < refs.length; offset += QUEUE_CHUNK_SIZE) {
      await roomStore.addQueue(refs.slice(offset, offset + QUEUE_CHUNK_SIZE));
    }
    onToast(t('room.addedBatchToast', { count: refs.length }));
  };

  const submitSelected = async () => {
    const refs = Array.from(selectedRefs);
    if (refs.length === 0 || queueBusy) return;
    setQueueBusy(true);
    try {
      await enqueueRefs(refs);
      setSelectedRefs(new Set());
    } catch (error: unknown) {
      onError(error);
    } finally {
      setQueueBusy(false);
    }
  };

  const openPlaylist = async (playlist: PlaylistInfo) => {
    const request = playlistRequest.current + 1;
    playlistRequest.current = request;
    setPlaylistDetail(null);
    setPlaylistBusy(true);
    try {
      const detail = await api.getPlaylist(playlist.id, 0, PLAYLIST_PAGE_SIZE);
      if (playlistRequest.current === request) setPlaylistDetail(detail);
    } catch (error: unknown) {
      if (playlistRequest.current === request) onError(error);
    } finally {
      if (playlistRequest.current === request) setPlaylistBusy(false);
    }
  };

  const closePlaylist = () => {
    playlistRequest.current += 1;
    setPlaylistDetail(null);
    setPlaylistBusy(false);
    setLoadingMore(false);
  };

  const loadMoreTracks = async () => {
    if (!playlistDetail || loadingMore) return;
    const offset = playlistDetail.offset + playlistDetail.limit;
    setLoadingMore(true);
    try {
      const page = await api.getPlaylist(playlistDetail.playlist.id, offset, PLAYLIST_PAGE_SIZE);
      setPlaylistDetail((current) => {
        if (!current || current.playlist.id !== page.playlist.id) return current;
        return { ...page, items: [...current.items, ...page.items] };
      });
    } catch (error: unknown) {
      onError(error);
    } finally {
      setLoadingMore(false);
    }
  };

  const submitWholePlaylist = async () => {
    if (!playlistDetail || queueBusy) return;
    setQueueBusy(true);
    try {
      const items = [...playlistDetail.items];
      let offset = playlistDetail.offset + playlistDetail.limit;
      while (offset < playlistDetail.playlist.track_count) {
        const page = await api.getPlaylist(playlistDetail.playlist.id, offset, PLAYLIST_PAGE_SIZE);
        if (page.items.length === 0) throw new Error(t('batch.playlistIncomplete'));
        items.push(...page.items);
        offset = page.offset + page.limit;
      }
      await enqueueRefs(items.map((item) => item.track_ref));
    } catch (error: unknown) {
      onError(error);
    } finally {
      setQueueBusy(false);
    }
  };

  const selectedCount = selectedRefs.size;

  return (
    <section className="mt-3 border border-hairline rounded-lg bg-panel overflow-hidden">
      <div className="grid grid-cols-2 border-b border-hairline">
        {(['search', 'playlist'] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={`px-3 py-2 text-xs tracking-wide transition-colors ${
              tab === item ? 'bg-panel-2 text-accent' : 'text-muted hover:text-paper'
            }`}
          >
            {t(item === 'search' ? 'batch.tabSearch' : 'batch.tabPlaylist')}
          </button>
        ))}
      </div>

      {tab === 'search' ? (
        <div className="p-3">
          <div className="flex gap-2">
            {providers.length > 1 && (
              <select
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
                className="bg-panel-2 border border-hairline rounded-md px-2 text-xs"
              >
                {providers.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            )}
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && runSearch()}
              placeholder={t('search.placeholder')}
              className="flex-1 min-w-0 bg-panel-2 border border-hairline rounded-md px-3 py-1.5 text-[13px] placeholder:text-faint"
            />
            <button
              type="button"
              onClick={runSearch}
              disabled={searchBusy}
              className="text-accent text-[13px] px-2 disabled:opacity-40"
            >
              {t('search.submit')}
            </button>
          </div>

          {results && (
            <div className="mt-2 max-h-72 overflow-y-auto">
              {results.length === 0 && (
                <p className="text-xs text-faint py-3 text-center">{t('search.empty')}</p>
              )}
              {results.map((track) => {
                const selected = selectedRefs.has(track.track_ref);
                return (
                  <div
                    key={track.track_ref}
                    role="checkbox"
                    aria-checked={selected}
                    tabIndex={0}
                    onClick={() => toggleRef(track.track_ref)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleRef(track.track_ref);
                      }
                    }}
                    className={`flex items-center gap-2.5 py-2 border-b border-l-2 border-hairline last:border-b-0 cursor-pointer select-none ${
                      selected ? 'border-l-accent bg-panel-2' : 'border-l-transparent hover:bg-panel-2'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] truncate">{track.title}</div>
                      <div className="text-[11px] text-muted truncate">{track.artist}</div>
                    </div>
                    <span className="font-mono text-[11px] text-faint tabular-nums">
                      {formatMs(track.duration_ms)}
                    </span>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void roomStore
                          .addQueue([track.track_ref])
                          .then(() => onToast(t('room.addedToast', { title: track.title })))
                          .catch(onError);
                      }}
                      className="text-accent text-lg leading-none px-1.5 hover:brightness-110"
                      title={t('search.add')}
                    >
                      +
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="p-3">
          {playlistDetail || playlistBusy ? (
            <div>
              <div className="flex items-center justify-between gap-3 pb-2 border-b border-hairline">
                <button type="button" onClick={closePlaylist} className="text-xs text-muted hover:text-paper">
                  {t('batch.playlistBack')}
                </button>
                {playlistDetail && (
                  <button
                    type="button"
                    onClick={() => void submitWholePlaylist()}
                    disabled={queueBusy || playlistDetail.playlist.track_count === 0}
                    className="text-xs text-accent disabled:opacity-40"
                  >
                    {queueBusy ? t('batch.adding') : t('batch.addPlaylist')}
                  </button>
                )}
              </div>

              {playlistBusy && (
                <p className="text-xs text-faint py-6 text-center">{t('batch.playlistLoading')}</p>
              )}

              {playlistDetail && (
                <>
                  <div className="py-3 border-b border-hairline">
                    <div className="text-sm font-medium">{playlistDetail.playlist.name}</div>
                    {playlistDetail.playlist.description && (
                      <p className="mt-1 text-xs text-muted">{playlistDetail.playlist.description}</p>
                    )}
                  </div>
                  {playlistDetail.items.length === 0 ? (
                    <p className="text-xs text-faint py-6 text-center">{t('batch.playlistEmpty')}</p>
                  ) : (
                    <div className="max-h-80 overflow-y-auto">
                      {playlistDetail.items.map((item) => {
                        const selected = selectedRefs.has(item.track_ref);
                        return (
                          <div
                            key={item.ord}
                            role="checkbox"
                            aria-checked={selected}
                            tabIndex={0}
                            onClick={() => toggleRef(item.track_ref)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                toggleRef(item.track_ref);
                              }
                            }}
                            className={`flex items-center gap-2.5 py-2 border-b border-l-2 border-hairline last:border-b-0 cursor-pointer select-none ${
                              selected ? 'border-l-accent bg-panel-2' : 'border-l-transparent hover:bg-panel-2'
                            }`}
                          >
                                    <span className="w-6 text-right font-mono text-[10px] text-faint tabular-nums">
                              {item.ord}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="text-[13px] truncate">{item.title}</div>
                              <div className="text-[11px] text-muted truncate">{item.artist}</div>
                            </div>
                            <span className="font-mono text-[11px] text-faint tabular-nums">
                              {formatMs(item.duration_ms)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {playlistDetail.offset + playlistDetail.limit < playlistDetail.playlist.track_count && (
                    <button
                      type="button"
                      onClick={() => void loadMoreTracks()}
                      disabled={loadingMore}
                      className="w-full py-2.5 text-xs text-accent disabled:opacity-40 border-t border-hairline"
                    >
                      {loadingMore ? t('batch.loadingMore') : t('batch.loadMore')}
                    </button>
                  )}
                </>
              )}
            </div>
          ) : playlists === null ? (
            <p className="text-xs text-faint py-6 text-center">{t('batch.playlistsLoading')}</p>
          ) : playlists.length === 0 ? (
            <p className="text-xs text-faint py-6 text-center">{t('batch.playlistsEmpty')}</p>
          ) : (
            <div className="divide-y divide-hairline">
              {playlists.map((playlist) => (
                <button
                  key={playlist.id}
                  type="button"
                  onClick={() => void openPlaylist(playlist)}
                  aria-label={t('batch.openPlaylist', { name: playlist.name })}
                  className="w-full flex items-start justify-between gap-4 py-3 text-left hover:bg-panel-2 transition-colors"
                >
                  <span className="min-w-0">
                    <span className="block text-[13px] truncate">{playlist.name}</span>
                    {playlist.description && (
                      <span className="block mt-1 text-[11px] text-muted line-clamp-2">{playlist.description}</span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-faint tabular-nums">
                    {t('batch.trackCount', { count: playlist.track_count })}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedCount > 0 && (
        <div className="sticky bottom-0 flex items-center gap-3 px-3 py-2.5 bg-panel-2 border-t border-hairline">
          <span className="mr-auto text-xs text-muted tabular-nums">
            {t('batch.selectedCount', { count: selectedCount })}
          </span>
          <button
            type="button"
            onClick={() => void submitSelected()}
            disabled={queueBusy}
            className="text-xs text-accent disabled:opacity-40"
          >
            {queueBusy ? t('batch.adding') : t('batch.addSelected')}
          </button>
          <button
            type="button"
            onClick={() => setSelectedRefs(new Set())}
            disabled={queueBusy}
            className="text-xs text-muted hover:text-paper disabled:opacity-40"
          >
            {t('batch.clear')}
          </button>
        </div>
      )}
    </section>
  );
}
