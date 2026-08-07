/**
 * 有限电台源的集合页（每日推荐/新歌等）：展示方式复用曲库歌单详情——
 * 头部（名称 + 曲目数 + 整单入队）+ 共享 TrackList（点选 + FAB）。
 * 数据源是 /api/v1/radio/tracks 的一次性物化，spec 以 provider:spec 形态入路由。
 */
import { useCallback, useEffect, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { ListMusic } from 'lucide-react';
import type { SearchTrack } from '../api/types';
import { api } from '../app/session';
import { useProviders } from './hooks';
import { TrackList, useEnqueue } from './TrackList';
import { useToast } from './toast';

const PAGE_SIZE = 50;

export default function SourceCollectionView(): JSX.Element {
  const { t } = useTranslation();
  const { spec: rawSpec } = useParams();
  const source = decodeURIComponent(rawSpec ?? '');
  const providers = useProviders();
  const { showError } = useToast();
  const enqueue = useEnqueue();

  const [tracks, setTracks] = useState<SearchTrack[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [lastPageFull, setLastPageFull] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);

  // 展示名：从 provider 能力目录查源名，查不到退回源规格本身
  const sep = source.indexOf(':');
  const title =
    providers
      ?.find((p) => p.id === source.slice(0, sep))
      ?.capabilities?.radio_sources?.find((s) => s.spec === source.slice(sep + 1))?.name ?? source;

  useEffect(() => {
    if (!source) return;
    let dead = false;
    setTracks(null);
    setTotal(null);
    api
      .radioTracks(source, { limit: PAGE_SIZE })
      .then((page) => {
        if (dead) return;
        setTracks(page.tracks);
        setTotal(page.total);
        setLastPageFull(page.tracks.length === PAGE_SIZE);
      })
      .catch((err: unknown) => {
        if (dead) return;
        setTracks([]);
        showError(err);
      });
    return () => {
      dead = true;
    };
  }, [source, showError]);

  const loadMore = useCallback(() => {
    if (!tracks || loadingMore) return;
    setLoadingMore(true);
    api
      .radioTracks(source, { limit: PAGE_SIZE, offset: tracks.length })
      .then((page) => {
        setTracks((current) => [...(current ?? []), ...page.tracks]);
        setTotal(page.total);
        setLastPageFull(page.tracks.length === PAGE_SIZE);
      })
      .catch(showError)
      .finally(() => setLoadingMore(false));
  }, [tracks, loadingMore, source, showError]);

  /** 整单入队：拉齐全部页（total 未知时以短页为尾）再统一提交（useEnqueue 内部分块）。 */
  const addAll = () => {
    if (busy || !tracks) return;
    setBusy(true);
    void (async () => {
      const refs = tracks.map((track) => track.track_ref);
      let offset = tracks.length;
      while (total === null ? lastPageFull : offset < total) {
        const page = await api.radioTracks(source, { limit: PAGE_SIZE, offset });
        refs.push(...page.tracks.map((track) => track.track_ref));
        if (page.tracks.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
      enqueue(refs);
    })()
      .catch(showError)
      .finally(() => setBusy(false));
  };

  const hasMore = tracks !== null && (total !== null ? tracks.length < total : lastPageFull);

  return (
    <div className="view-enter mx-auto max-w-3xl px-4 pt-4 pb-10 md:px-7 md:pt-7">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div className="flex min-w-0 items-end gap-4">
          <span className="grid h-24 w-24 flex-none place-items-center rounded-lg bg-panel-2 text-faint">
            <ListMusic className="h-8 w-8" />
          </span>
          <div className="min-w-0">
            <h1 className="line-clamp-2 font-display text-xl leading-snug font-semibold md:text-3xl">
              {title}
            </h1>
            {total !== null && (
              <div className="mt-1.5 text-[13px] text-muted">
                {t('batch.trackCount', { count: total })}
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          disabled={busy || !tracks || tracks.length === 0}
          onClick={addAll}
          className="flex-none rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-on-accent hover:brightness-105 disabled:opacity-40"
        >
          {busy ? t('batch.adding') : t('batch.addPlaylist')}
        </button>
      </div>

      {tracks === null ? (
        <p className="py-6 text-center text-sm text-faint">{t('common.loading')}</p>
      ) : tracks.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">{t('search.empty')}</p>
      ) : (
        <TrackList
          tracks={tracks}
          onLoadMore={hasMore ? loadMore : undefined}
          loadingMore={loadingMore}
        />
      )}
    </div>
  );
}
