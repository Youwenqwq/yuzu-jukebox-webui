/**
 * 曲目列表弹窗：有限电台源物化（每日推荐/榜单/新歌）与相似歌曲小窗共用。
 * 弹窗是临时浏览场景——行点击即单曲入队（toast 反馈），顶部整单入队；
 * 页面级列表的选择+FAB 模型（TrackList）不搬进 modal。
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import type { SearchTrack } from '../api/types';
import { coverSrc } from './cover';
import { formatMs } from './format';
import { Dialog } from './primitives';
import { useEnqueue } from './TrackList';
import { useToast } from './toast';

export function TracksDialog({
  open,
  onOpenChange,
  title,
  load,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** open 变 true 时调用一次；调用方传内联函数即可（内部经 ref 取值，不重复触发） */
  load: () => Promise<SearchTrack[]>;
}): JSX.Element {
  const { t } = useTranslation();
  const enqueue = useEnqueue();
  const { showError } = useToast();
  const [tracks, setTracks] = useState<SearchTrack[] | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!open) return;
    setTracks(null);
    let dead = false;
    loadRef.current()
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
  }, [open, showError]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}>
      {tracks === null ? (
        <p className="py-6 text-center text-sm text-faint">{t('common.loading')}</p>
      ) : tracks.length === 0 ? (
        <p className="py-6 text-center text-sm text-faint">{t('search.empty')}</p>
      ) : (
        <>
          <div className="mb-3 flex justify-end">
            <button
              type="button"
              onClick={() => {
                enqueue(tracks.map((track) => track.track_ref));
                onOpenChange(false);
              }}
              className="rounded-full bg-accent px-3.5 py-1.5 text-xs font-medium text-on-accent hover:brightness-105"
            >
              {t('batch.addPlaylist')}
            </button>
          </div>
          <div className="overflow-hidden rounded-lg border border-hairline bg-panel">
            {tracks.map((track, index) => (
              <button
                key={track.track_ref}
                type="button"
                onClick={() => enqueue([track.track_ref], track.title)}
                className="flex w-full cursor-pointer items-center gap-3 border-b border-hairline px-3.5 py-2 text-left last:border-b-0 hover:bg-panel-2"
              >
                <span className="w-5 flex-none text-right font-mono text-[11px] text-faint tabular-nums">
                  {index + 1}
                </span>
                <img
                  src={coverSrc(
                    track.cover_url || `/api/v1/cover/${encodeURIComponent(track.track_ref)}`,
                  )}
                  alt=""
                  className="h-9 w-9 flex-none rounded object-cover"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px]">{track.title}</span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-muted">
                    {track.artist}
                    {track.album ? ` · ${track.album}` : ''}
                  </span>
                </span>
                <span className="flex-none font-mono text-[11px] text-faint tabular-nums">
                  {formatMs(track.duration_ms)}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </Dialog>
  );
}
