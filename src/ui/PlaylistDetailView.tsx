/**
 * 歌单详情页：浏览歌单条目、单首点歌、整单入队。
 * 入队目标恒为当前房间——未入房时按钮引导先选房间。
 */
import { useEffect, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { ListMusic } from 'lucide-react';
import type { PlaylistDetail } from '../api/types';
import { api, roomStore } from '../app/session';
import { coverSrc } from './cover';
import { useRoomState } from './hooks';
import { formatMs } from './format';
import { useToast } from './toast';
import { useShell } from './AppShell';

const PAGE_SIZE = 50;
const QUEUE_CHUNK_SIZE = 100;

export default function PlaylistDetailView(): JSX.Element {
  const { t } = useTranslation();
  const { playlistId = '' } = useParams();
  const state = useRoomState();
  const { setRoomsOpen } = useShell();
  const { show, showError } = useToast();

  const [detail, setDetail] = useState<PlaylistDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setDetail(null);
    setFailed(false);
    let dead = false;
    api
      .getPlaylist(playlistId, 0, PAGE_SIZE)
      .then((res) => {
        if (!dead) setDetail(res);
      })
      .catch((err: unknown) => {
        if (!dead) {
          setFailed(true);
          showError(err);
        }
      });
    return () => {
      dead = true;
    };
  }, [playlistId, showError]);

  /** 追加下一页（分页契约：GET /playlists/{id}?offset=&limit=，默认 50/上限 200）。 */
  const loadMore = () => {
    if (!detail || loadingMore || detail.items.length >= detail.playlist.track_count) return;
    setLoadingMore(true);
    api
      .getPlaylist(playlistId, detail.items.length, PAGE_SIZE)
      .then((page) => {
        setDetail((current) => {
          if (!current || current.playlist.id !== playlistId) return current;
          return { ...page, offset: 0, items: [...current.items, ...page.items] };
        });
      })
      .catch(showError)
      .finally(() => setLoadingMore(false));
  };

  const requireRoom = (): boolean => {
    if (state.roomId) return true;
    show(t('home.needRoom'));
    setRoomsOpen(true);
    return false;
  };

  const addOne = (trackRef: string, title: string) => {
    if (!requireRoom()) return;
    void roomStore
      .addQueue([trackRef])
      .then(() => show(t('room.addedToast', { title })))
      .catch(showError);
  };

  const addAll = () => {
    if (!requireRoom() || busy) return;
    setBusy(true);
    void (async () => {
      // 拉齐全部分页再按 100 条/批原子入队（与服务端批量上限对齐）
      const refs: string[] = [];
      let offset = 0;
      for (;;) {
        const page = await api.getPlaylist(playlistId, offset, PAGE_SIZE);
        refs.push(...page.items.map((item) => item.track_ref));
        if (page.items.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
      for (let i = 0; i < refs.length; i += QUEUE_CHUNK_SIZE) {
        await roomStore.addQueue(refs.slice(i, i + QUEUE_CHUNK_SIZE));
      }
      show(t('room.addedBatchToast', { count: refs.length }));
    })()
      .catch(showError)
      .finally(() => setBusy(false));
  };

  if (failed) {
    return (
      <div className="view-enter mx-auto max-w-3xl px-7 pt-7 pb-10">
        <p className="text-muted">{t('error.internal')}</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="view-enter mx-auto max-w-3xl px-7 pt-7 pb-10">
        <p className="text-muted">{t('batch.playlistLoading')}</p>
      </div>
    );
  }

  return (
    <div className="view-enter mx-auto max-w-3xl px-7 pt-7 pb-10">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div className="flex min-w-0 items-end gap-4">
          {detail.playlist.cover_url ? (
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
          <div className="min-w-0">
            <h1 className="truncate font-display text-3xl font-semibold">{detail.playlist.name}</h1>
            <div className="mt-1.5 text-[13px] text-muted">
              {t('batch.trackCount', { count: detail.playlist.track_count })}
              {detail.playlist.description && (
                <span className="ml-3 text-faint">{detail.playlist.description}</span>
              )}
            </div>
          </div>
        </div>
        <button
          type="button"
          disabled={busy || detail.items.length === 0}
          onClick={addAll}
          className="flex-none rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-on-accent hover:brightness-105 disabled:opacity-40"
        >
          {busy ? t('batch.adding') : t('batch.addPlaylist')}
        </button>
      </div>

      {detail.items.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">{t('batch.playlistEmpty')}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-hairline bg-panel">
          {detail.items.map((item) => (
            <div
              key={item.ord}
              className="group flex items-center gap-3 border-b border-hairline px-4 py-2.5 last:border-b-0 hover:bg-panel-2"
            >
              <span className="w-7 flex-none text-right font-mono text-xs text-faint tabular-nums">
                {item.ord}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px]">{item.title}</div>
                <div className="mt-0.5 truncate text-[11.5px] text-muted">{item.artist}</div>
              </div>
              <span className="flex-none font-mono text-[11.5px] text-muted tabular-nums">
                {formatMs(item.duration_ms)}
              </span>
              <button
                type="button"
                title={t('search.add')}
                onClick={() => addOne(item.track_ref, item.title)}
                className="grid h-7 w-7 flex-none place-items-center rounded-full border border-hairline text-muted opacity-0 transition-opacity hover:border-accent hover:text-accent focus:opacity-100 group-hover:opacity-100"
              >
                +
              </button>
            </div>
          ))}
        </div>
      )}
      {detail.items.length < detail.playlist.track_count && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="mt-3 w-full rounded-md border border-hairline py-2.5 text-[12.5px] text-accent hover:bg-panel disabled:opacity-40"
        >
          {loadingMore ? t('common.loading') : t('playlistDetail.loadMore')}
        </button>
      )}
    </div>
  );
}
