/**
 * 搜索页：顶栏搜索框的落点。URL 驱动（?q= &p=），无独立导航入口。
 * 分类 chips 由 provider 的 capabilities.search_categories 驱动——
 * 只渲染服务端报告的分类（能力不对称是正常状态，不占位造假）。
 * artist/album 实体可钻取为可入队曲目；playlist 实体走导入（media_admin）。
 */
import { useEffect, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Disc3, ListMusic, ListPlus, Radio, Search as SearchIcon, User } from 'lucide-react';
import type { SearchCategory, SearchEntity, SearchTrack } from '../api/types';
import { api, roomStore } from '../app/session';
import { useIdentity, useProviders, useRoomState } from './hooks';
import { coverSrc } from './cover';
import { composeSource, entityRadioSource } from './radioSources';
import { formatMs } from './format';
import { useToast } from './toast';
import { SEARCH_PROVIDER_KEY, useShell } from './AppShell';

type Chip = 'all' | SearchCategory;

const CHIP_KEYS: Record<Chip, string> = {
  all: 'searchPage.catAll',
  song: 'searchPage.catSongs',
  artist: 'searchPage.catArtists',
  album: 'searchPage.catAlbums',
  playlist: 'searchPage.catPlaylists',
};

interface DrillTarget {
  type: 'artist' | 'album';
  id: string;
  name: string;
  coverUrl?: string;
  detail?: string;
}

/**
 * 曲目封面：track.cover_url 为空 = 源站没给封面；回退代理路径让 GetTrack 再试一次。
 */
function trackCover(track: SearchTrack): string {
  return coverSrc(track.cover_url || `/api/v1/cover/${encodeURIComponent(track.track_ref)}`);
}

export default function SearchView(): JSX.Element {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const providers = useProviders();
  const query = params.get('q')?.trim() ?? '';
  const provider = params.get('p') || localStorage.getItem(SEARCH_PROVIDER_KEY) || 'ncm';
  const [mobileKeyword, setMobileKeyword] = useState(query);

  // 能力报告驱动 chips；未报告分类能力的 provider 只有单曲
  const supported: SearchCategory[] =
    providers?.find((p) => p.id === provider)?.capabilities?.search_categories ?? ['song'];
  const chips: Chip[] = ['all', ...supported];

  const [category, setCategory] = useState<Chip>('all');
  const [drill, setDrill] = useState<DrillTarget | null>(null);

  // 换词/换源：回全部、退出钻取；provider 不支持当前分类时同样回退
  useEffect(() => {
    setDrill(null);
    setCategory((current) =>
      current !== 'all' && !supported.includes(current) ? 'all' : current,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, provider]);

  return (
    <div className="view-enter mx-auto max-w-5xl px-4 pt-4 pb-10 md:px-7 md:pt-7">
      {/* 移动端输入框：顶栏搜索 icon 跳转到这里，页面自带输入（桌面端用顶栏输入框） */}
      <form
        className="mb-5 flex items-center gap-2 rounded-full border border-hairline bg-panel px-3.5 py-2 md:hidden"
        onSubmit={(event) => {
          event.preventDefault();
          const q = mobileKeyword.trim();
          if (q) navigate(`/search?q=${encodeURIComponent(q)}&p=${encodeURIComponent(provider)}`);
        }}
      >
        <SearchIcon className="h-3.5 w-3.5 flex-none text-faint" />
        <input
          value={mobileKeyword}
          onChange={(event) => setMobileKeyword(event.target.value)}
          placeholder={t('search.placeholder')}
          className="search-input w-full min-w-0 bg-transparent text-[13px] placeholder:text-faint focus:outline-none"
        />
      </form>

      <div className="mb-6 flex flex-wrap gap-2">
        {chips.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => {
              setCategory(chip);
              setDrill(null);
            }}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] transition-colors ${
              category === chip && drill === null
                ? 'bg-accent text-on-accent'
                : 'border border-hairline text-muted hover:border-faint hover:text-paper'
            }`}
          >
            {t(CHIP_KEYS[chip])}
          </button>
        ))}
      </div>

      {!query && <p className="py-16 text-center text-sm text-muted">{t('searchPage.noQuery')}</p>}

      {query && drill !== null && (
        <EntityDrill provider={provider} drill={drill} onBack={() => setDrill(null)} onDrill={setDrill} />
      )}

      {query &&
        drill === null &&
        (category === 'all' || category === 'song' ? (
          <>
            {/* 「全部」的选择性采纳：最匹配歌手 + 单曲列表；其余分类留给独立 tab */}
            {category === 'all' && supported.includes('artist') && (
              <TopArtistResult provider={provider} query={query} onDrill={setDrill} />
            )}
            <SongResults provider={provider} query={query} />
          </>
        ) : (
          <EntitySection provider={provider} query={query} category={category} onDrill={setDrill} />
        ))}
    </div>
  );
}

// ---------- 入队共享 ----------

function useEnqueue() {
  const { t } = useTranslation();
  const state = useRoomState();
  const { setRoomsOpen } = useShell();
  const { show, showError } = useToast();

  const enqueue = (refs: string[], toastTitle?: string) => {
    if (!state.roomId) {
      show(t('home.needRoom'));
      setRoomsOpen(true);
      return;
    }
    void (async () => {
      for (let offset = 0; offset < refs.length; offset += 100) {
        await roomStore.addQueue(refs.slice(offset, offset + 100));
      }
      show(
        refs.length === 1 && toastTitle
          ? t('room.addedToast', { title: toastTitle })
          : t('room.addedBatchToast', { count: refs.length }),
      );
    })().catch(showError);
  };

  return enqueue;
}

// ---------- 曲目列表（搜索结果与钻取结果共用） ----------

function TrackList({
  tracks,
  onLoadMore,
  loadingMore = false,
}: {
  tracks: SearchTrack[];
  onLoadMore?: () => void;
  loadingMore?: boolean;
}) {
  const { t } = useTranslation();
  const enqueue = useEnqueue();
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(() => new Set());

  // 新一批结果清空选择
  useEffect(() => {
    setSelectedRefs(new Set());
  }, [tracks]);

  const toggleRef = (trackRef: string) => {
    setSelectedRefs((current) => {
      const next = new Set(current);
      if (next.has(trackRef)) next.delete(trackRef);
      else next.add(trackRef);
      return next;
    });
  };

  return (
    <div>
      {selectedRefs.size > 0 && (
        <div className="mb-2.5 flex justify-end">
          <button
            type="button"
            onClick={() => {
              enqueue(Array.from(selectedRefs));
              setSelectedRefs(new Set());
            }}
            className="rounded-full bg-accent px-3.5 py-1 text-xs font-medium text-on-accent hover:brightness-105"
          >
            {t('batch.addSelected')} · {t('batch.selectedCount', { count: selectedRefs.size })}
          </button>
        </div>
      )}
      <div className="overflow-hidden rounded-lg border border-hairline bg-panel">
        {tracks.map((track, index) => {
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
              className={`flex cursor-pointer items-center gap-3 border-b border-l-2 border-hairline px-3.5 py-2 select-none last:border-b-0 ${
                selected ? 'border-l-accent bg-panel-2' : 'border-l-transparent hover:bg-panel-2'
              }`}
            >
              <span className="w-5 flex-none text-right font-mono text-[11px] text-faint tabular-nums">
                {index + 1}
              </span>
              <img
                src={trackCover(track)}
                alt=""
                className="h-9 w-9 flex-none rounded object-cover"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px]">{track.title}</div>
                <div className="mt-0.5 truncate text-[11.5px] text-muted">
                  {track.artist}
                  {track.album ? ` · ${track.album}` : ''}
                </div>
              </div>
              <span className="flex-none font-mono text-[11px] text-faint tabular-nums">
                {formatMs(track.duration_ms)}
              </span>
              <button
                type="button"
                title={t('search.add')}
                onClick={(event) => {
                  event.stopPropagation();
                  enqueue([track.track_ref], track.title);
                }}
                className="flex-none px-1.5 text-lg leading-none text-accent hover:brightness-110"
              >
                +
              </button>
            </div>
          );
        })}
        {onLoadMore && (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="w-full border-t border-hairline py-2.5 text-xs text-accent hover:bg-panel-2 disabled:opacity-40"
          >
            {loadingMore ? t('common.loading') : t('searchPage.loadMore')}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- 单曲结果（真实检索，分页） ----------

const PAGE_SIZE = 30;

function SongResults({ provider, query }: { provider: string; query: string }) {
  const { t } = useTranslation();
  const { showError } = useToast();
  const [results, setResults] = useState<SearchTrack[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setResults(null);
    let dead = false;
    setBusy(true);
    api
      .search(provider, query, { limit: PAGE_SIZE })
      .then((tracks) => {
        if (!dead) setResults(tracks);
      })
      .catch((err: unknown) => {
        if (!dead) {
          setResults([]);
          showError(err);
        }
      })
      .finally(() => {
        if (!dead) setBusy(false);
      });
    return () => {
      dead = true;
    };
  }, [query, provider, showError]);

  const loadMore = () => {
    if (!results || loadingMore) return;
    setLoadingMore(true);
    api
      .search(provider, query, { limit: PAGE_SIZE, offset: results.length })
      .then((more) => setResults((current) => [...(current ?? []), ...more]))
      .catch(showError)
      .finally(() => setLoadingMore(false));
  };

  return (
    <section>
      <h2 className="mt-8 mb-3 font-mono text-[11px] tracking-[0.14em] uppercase text-faint first:mt-0">
        {t('searchPage.catSongs')}
      </h2>
      {busy && <p className="py-6 text-sm text-muted">{t('common.loading')}</p>}
      {!busy && results?.length === 0 && <p className="py-6 text-sm text-faint">{t('search.empty')}</p>}
      {!busy && results && results.length > 0 && (
        <TrackList
          tracks={results}
          onLoadMore={results.length % PAGE_SIZE === 0 ? loadMore : undefined}
          loadingMore={loadingMore}
        />
      )}
    </section>
  );
}

// ---------- 分类实体（歌手/专辑/歌单） ----------

const ENTITY_ICONS = { artist: User, album: Disc3, playlist: ListMusic } as const;

function EntitySection({
  provider,
  query,
  category,
  onDrill,
}: {
  provider: string;
  query: string;
  category: SearchCategory;
  onDrill: (target: DrillTarget) => void;
}) {
  const { t } = useTranslation();
  const { show, showError } = useToast();
  const navigate = useNavigate();
  const identity = useIdentity();
  const state = useRoomState();
  const providers = useProviders();
  const { canRadio, setRoomsOpen } = useShell();
  const [results, setResults] = useState<SearchEntity[] | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const canImport = identity?.roles.includes('media_admin') ?? false;
  // 歌单实体可作电台播放（ncm playlist:<id> / bili fav:<media_id>，无需导入）
  const radioSource = category === 'playlist' ? entityRadioSource(providers, provider) : null;

  useEffect(() => {
    setResults(null);
    let dead = false;
    api
      .searchCategory(provider, query, category, { limit: PAGE_SIZE })
      .then((entities) => {
        if (!dead) setResults(entities);
      })
      .catch(() => {
        if (!dead) setResults([]);
      });
    return () => {
      dead = true;
    };
  }, [query, provider, category]);

  const loadMore = () => {
    if (!results || loadingMore) return;
    setLoadingMore(true);
    api
      .searchCategory(provider, query, category, { limit: PAGE_SIZE, offset: results.length })
      .then((more) => setResults((current) => [...(current ?? []), ...more]))
      .catch(showError)
      .finally(() => setLoadingMore(false));
  };

  if (results === null || results.length === 0) return null;

  const Icon = ENTITY_ICONS[category as 'artist' | 'album' | 'playlist'] ?? Disc3;

  const importEntity = (entity: SearchEntity) => {
    // 歌单实体 = 导入动作（media_admin 写权限）
    if (!entity.entity_id || !canImport || importBusy) return;
    setImportBusy(true);
    void api
      .importPlaylist({ provider, playlist_id: entity.entity_id })
      .then((playlist) => {
        show(t('searchPage.imported', { name: playlist.name }));
        navigate(`/playlist/${encodeURIComponent(playlist.id)}`);
      })
      .catch(showError)
      .finally(() => setImportBusy(false));
  };

  const playAsRadio = (entity: SearchEntity) => {
    if (!entity.entity_id || !radioSource) return;
    if (!state.roomId) {
      show(t('home.needRoom'));
      setRoomsOpen(true);
      return;
    }
    if (!canRadio) {
      show(t('home.radioNeedControl'));
      return;
    }
    const source = composeSource(provider, radioSource, undefined, entity.entity_id);
    if (!source) return;
    void roomStore
      .radioPlay(source)
      .then(() => show(t('roomAdmin.radioStarted')))
      .catch(showError);
  };

  const open = (entity: SearchEntity) => {
    if (!entity.entity_id) return;
    if (category === 'playlist') {
      // 主操作：能作电台则作电台，否则（media_admin）导入
      if (radioSource) playAsRadio(entity);
      else importEntity(entity);
      return;
    }
    onDrill({
      type: category as 'artist' | 'album',
      id: entity.entity_id,
      name: entity.name ?? '',
      coverUrl: entity.cover_url,
      detail: entity.detail,
    });
  };

  // 与单曲一致的条目列举：封面 + 名称 + 次要信息 + 进入指示
  return (
    <section className="mb-8">
      <h2 className="mb-3 font-mono text-[11px] tracking-[0.14em] uppercase text-faint">
        {t(CHIP_KEYS[category])}
      </h2>
      <div className="overflow-hidden rounded-lg border border-hairline bg-panel">
        {results.map((entity) => {
          const dead = category === 'playlist' && !radioSource && !canImport;
          return (
            <div
              key={entity.entity_id ?? entity.name}
              role="button"
              tabIndex={dead ? -1 : 0}
              aria-disabled={dead}
              title={dead ? t('searchPage.importNeedAdmin') : undefined}
              onClick={() => {
                if (!dead) open(entity);
              }}
              onKeyDown={(event) => {
                if (!dead && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  open(entity);
                }
              }}
              className={`flex w-full items-center gap-3 border-b border-hairline px-3.5 py-2.5 text-left transition-colors last:border-b-0 hover:bg-panel-2 ${
                dead ? 'opacity-50' : 'cursor-pointer'
              }`}
            >
              {entity.cover_url ? (
                <img
                  src={coverSrc(entity.cover_url)}
                  alt=""
                  className={`h-10 w-10 flex-none object-cover ${
                    category === 'artist' ? 'rounded-full' : 'rounded'
                  }`}
                />
              ) : (
                <div
                  className={`grid h-10 w-10 flex-none place-items-center bg-panel-2 text-faint ${
                    category === 'artist' ? 'rounded-full' : 'rounded'
                  }`}
                >
                  <Icon className="h-4.5 w-4.5" />
                </div>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px]">{entity.name}</span>
                {entity.detail && (
                  <span className="mt-0.5 block truncate text-[11.5px] text-muted">{entity.detail}</span>
                )}
              </span>
              {category === 'playlist' && radioSource && (
                <button
                  type="button"
                  title={t('searchPage.playAsRadio')}
                  onClick={(event) => {
                    event.stopPropagation();
                    playAsRadio(entity);
                  }}
                  className="grid h-7 w-7 flex-none place-items-center rounded-full border border-hairline text-muted hover:border-accent hover:text-accent"
                >
                  <Radio className="h-3.5 w-3.5" />
                </button>
              )}
              {category === 'playlist' && canImport && (
                <button
                  type="button"
                  title={t('searchPage.importAction')}
                  onClick={(event) => {
                    event.stopPropagation();
                    importEntity(entity);
                  }}
                  className="grid h-7 w-7 flex-none place-items-center rounded-full border border-hairline text-muted hover:border-accent hover:text-accent"
                >
                  <ListPlus className="h-3.5 w-3.5" />
                </button>
              )}
              {category !== 'playlist' && <ChevronRight className="h-4 w-4 flex-none text-faint" />}
            </div>
          );
        })}
        {results.length % PAGE_SIZE === 0 && (
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="w-full border-t border-hairline py-2.5 text-xs text-accent hover:bg-panel-2 disabled:opacity-40"
          >
            {loadingMore ? t('common.loading') : t('searchPage.loadMore')}
          </button>
        )}
      </div>
    </section>
  );
}

// ---------- 「全部」的最匹配歌手（Spotify top result 的对应物） ----------

function TopArtistResult({
  provider,
  query,
  onDrill,
}: {
  provider: string;
  query: string;
  onDrill: (target: DrillTarget) => void;
}) {
  const { t } = useTranslation();
  const [top, setTop] = useState<SearchEntity | null>(null);

  useEffect(() => {
    setTop(null);
    let dead = false;
    api
      .searchCategory(provider, query, 'artist', { limit: 1 })
      .then((entities) => {
        if (!dead) setTop(entities.find((e) => e.entity_id) ?? null);
      })
      .catch(() => {
        if (!dead) setTop(null);
      });
    return () => {
      dead = true;
    };
  }, [query, provider]);

  if (!top) return null;

  return (
    <section className="mb-8">
      <button
        type="button"
        onClick={() =>
          onDrill({
            type: 'artist',
            id: top.entity_id!,
            name: top.name ?? '',
            coverUrl: top.cover_url,
            detail: top.detail,
          })
        }
        className="flex w-full items-center gap-5 rounded-lg border border-hairline bg-panel px-6 py-5 text-left transition-colors hover:border-faint hover:bg-panel-2"
      >
        {top.cover_url ? (
          <img src={coverSrc(top.cover_url)} alt="" className="h-20 w-20 flex-none rounded-full object-cover" />
        ) : (
          <div className="grid h-20 w-20 flex-none place-items-center rounded-full bg-panel-2 text-faint">
            <User className="h-8 w-8" />
          </div>
        )}
        <span className="min-w-0">
          <span className="block truncate font-display text-2xl font-semibold">{top.name}</span>
          <span className="mt-1 block text-xs text-muted">{t('searchPage.catArtists')}</span>
        </span>
      </button>
    </section>
  );
}

// ---------- 实体钻取（artist/album → Spotify 式艺人/专辑页） ----------

/** 歌手页「专辑」区块：into=albums 实体列表，点击再钻到专辑曲目（终点归一）。 */
function AlbumGrid({
  provider,
  artistId,
  onDrill,
}: {
  provider: string;
  artistId: string;
  onDrill: (target: DrillTarget) => void;
}) {
  const { t } = useTranslation();
  const { showError } = useToast();
  const [albums, setAlbums] = useState<SearchEntity[] | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setAlbums(null);
    let dead = false;
    api
      .searchEntityAlbums(provider, artistId, { limit: PAGE_SIZE })
      .then((list) => {
        if (!dead) setAlbums(list);
      })
      .catch(() => {
        if (!dead) setAlbums([]);
      });
    return () => {
      dead = true;
    };
  }, [provider, artistId]);

  const loadMore = () => {
    if (!albums || loadingMore) return;
    setLoadingMore(true);
    api
      .searchEntityAlbums(provider, artistId, { limit: PAGE_SIZE, offset: albums.length })
      .then((more) => setAlbums((current) => [...(current ?? []), ...more]))
      .catch(showError)
      .finally(() => setLoadingMore(false));
  };

  if (albums === null) return <p className="py-6 text-sm text-muted">{t('common.loading')}</p>;
  if (albums.length === 0) return <p className="py-6 text-sm text-faint">{t('search.empty')}</p>;

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {albums.map((album) => (
          <button
            key={album.entity_id ?? album.name}
            type="button"
            disabled={!album.entity_id}
            onClick={() =>
              onDrill({
                type: 'album',
                id: album.entity_id!,
                name: album.name ?? '',
                coverUrl: album.cover_url,
                detail: album.detail,
              })
            }
            className="group rounded-lg border border-hairline bg-panel p-3 text-left transition-colors hover:border-accent hover:bg-panel-2 disabled:opacity-40"
          >
            {album.cover_url ? (
              <img
                src={coverSrc(album.cover_url)}
                alt=""
                className="aspect-square w-full rounded object-cover"
              />
            ) : (
              <span className="grid aspect-square w-full place-items-center rounded bg-panel-2 text-faint">
                <Disc3 className="h-8 w-8" />
              </span>
            )}
            <div className="mt-2 truncate text-[13px] font-medium">{album.name}</div>
            {album.detail && <div className="mt-0.5 truncate text-[11px] text-faint">{album.detail}</div>}
          </button>
        ))}
      </div>
      {albums.length % PAGE_SIZE === 0 && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="mt-3 w-full rounded-md border border-hairline py-2.5 text-xs text-accent hover:bg-panel disabled:opacity-40"
        >
          {loadingMore ? t('common.loading') : t('searchPage.loadMore')}
        </button>
      )}
    </div>
  );
}

function EntityDrill({
  provider,
  drill,
  onBack,
  onDrill,
}: {
  provider: string;
  drill: DrillTarget;
  onBack: () => void;
  onDrill: (target: DrillTarget) => void;
}) {
  const { t } = useTranslation();
  const { showError } = useToast();
  const enqueue = useEnqueue();
  const providers = useProviders();
  const [tracks, setTracks] = useState<SearchTrack[] | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // 歌手页视图：热门曲目 / 专辑（后者仅当 provider 报告 entity_albums 能力）
  const supportsAlbums =
    drill.type === 'artist' &&
    (providers?.find((p) => p.id === provider)?.capabilities?.entity_albums ?? false);
  const [view, setView] = useState<'tracks' | 'albums'>('tracks');

  useEffect(() => {
    setTracks(null);
    setView('tracks');
    let dead = false;
    api
      .searchEntity(provider, drill.type, drill.id, { limit: PAGE_SIZE })
      .then((list) => {
        if (!dead) setTracks(list);
      })
      .catch((err: unknown) => {
        if (!dead) {
          setTracks([]);
          showError(err);
        }
      });
    return () => {
      dead = true;
    };
  }, [provider, drill, showError]);

  const loadMore = () => {
    if (!tracks || loadingMore) return;
    setLoadingMore(true);
    api
      .searchEntity(provider, drill.type, drill.id, { limit: PAGE_SIZE, offset: tracks.length })
      .then((more) => setTracks((current) => [...(current ?? []), ...more]))
      .catch(showError)
      .finally(() => setLoadingMore(false));
  };

  return (
    <section>
      <button
        type="button"
        onClick={onBack}
        className="mb-4 grid h-8 w-8 place-items-center rounded-full border border-hairline text-muted hover:text-paper"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>

      {/* hero：圆形艺人头像 / 方形专辑封面 + 大名 */}
      <div className="mb-6 flex items-end gap-6">
        {drill.coverUrl ? (
          <img
            src={coverSrc(drill.coverUrl)}
            alt=""
            className={`h-36 w-36 flex-none object-cover ${
              drill.type === 'artist' ? 'rounded-full' : 'rounded-lg'
            }`}
            style={{ boxShadow: 'var(--cover-shadow)' }}
          />
        ) : (
          <div
            className={`grid h-36 w-36 flex-none place-items-center bg-panel-2 text-faint ${
              drill.type === 'artist' ? 'rounded-full' : 'rounded-lg'
            }`}
          >
            {drill.type === 'artist' ? <User className="h-12 w-12" /> : <Disc3 className="h-12 w-12" />}
          </div>
        )}
        <div className="min-w-0 pb-1">
          <div className="font-mono text-[11px] tracking-[0.14em] uppercase text-faint">
            {t(drill.type === 'artist' ? 'searchPage.catArtists' : 'searchPage.catAlbums')}
          </div>
          <h2 className="mt-1 truncate font-display text-4xl font-semibold">{drill.name}</h2>
          {drill.detail && <div className="mt-1.5 truncate text-[13px] text-muted">{drill.detail}</div>}
          {tracks && tracks.length > 0 && (
            <button
              type="button"
              onClick={() => enqueue(tracks.map((track) => track.track_ref))}
              className="mt-3 rounded-full bg-accent px-4 py-1.5 text-[13px] font-medium text-on-accent hover:brightness-105"
            >
              {t('batch.addPlaylist')}
            </button>
          )}
        </div>
      </div>

      {supportsAlbums && (
        <div className="mb-4 flex gap-1 border-b border-hairline">
          {(['tracks', 'albums'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`-mb-px border-b-2 px-3.5 py-2 text-[13.5px] transition-colors ${
                view === v
                  ? 'border-accent text-paper'
                  : 'border-transparent text-muted hover:text-paper'
              }`}
            >
              {t(v === 'tracks' ? 'searchPage.popularTracks' : 'searchPage.albumsTab')}
            </button>
          ))}
        </div>
      )}

      {view === 'albums' ? (
        <AlbumGrid provider={provider} artistId={drill.id} onDrill={onDrill} />
      ) : (
        <>
          {!supportsAlbums && (
            <h3 className="mb-3 font-mono text-[11px] tracking-[0.14em] uppercase text-faint">
              {t(drill.type === 'artist' ? 'searchPage.popularTracks' : 'searchPage.tracksTitle')}
            </h3>
          )}
          {tracks === null && <p className="py-6 text-sm text-muted">{t('common.loading')}</p>}
          {tracks?.length === 0 && <p className="py-6 text-sm text-faint">{t('search.empty')}</p>}
          {tracks && tracks.length > 0 && (
            <TrackList
              tracks={tracks}
              onLoadMore={tracks.length % PAGE_SIZE === 0 ? loadMore : undefined}
              loadingMore={loadingMore}
            />
          )}
        </>
      )}
    </section>
  );
}
