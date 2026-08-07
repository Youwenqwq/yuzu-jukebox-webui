/**
 * 入队三件套（SearchView 抽出的共享件）：useEnqueue 分块提交 + 选择式
 * TrackList + 右下角 EnqueueFab。点选选中、FAB 提交是全局统一的入队模型，
 * 任何曲目列表（搜索/钻取/每日推荐/相似小窗）都应复用而非另造交互。
 */
import { useEffect, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ListPlus } from 'lucide-react';
import type { SearchTrack } from '../api/types';
import { roomStore } from '../app/session';
import { coverSrc } from './cover';
import { formatMs } from './format';
import { useRoomState } from './hooks';
import { useShell } from './shellContext';
import { useToast } from './toast';

/** 曲目封面：track.cover_url 为空 = 源站没给封面；回退代理路径让 GetTrack 再试一次。 */
function trackCover(track: SearchTrack): string {
  return coverSrc(track.cover_url || `/api/v1/cover/${encodeURIComponent(track.track_ref)}`);
}

/** 分块入队（100/批）+ toast + 未入房引导。toastTitle 仅单曲时展示。 */
export function useEnqueue(): (refs: string[], toastTitle?: string) => void {
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

/** 选中数 >0 时出现的圆形入队按钮；portal 到 body（fixed 不被祖先 transform 劫持）。 */
export function EnqueueFab({
  count,
  onCommit,
}: {
  count: number;
  onCommit: () => void;
}): JSX.Element | null {
  const { t } = useTranslation();

  if (count === 0) return null;

  const label = `${t('batch.addSelected')} · ${t('batch.selectedCount', { count })}`;

  return createPortal(
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onCommit}
      className="fixed right-4 bottom-[calc(var(--chrome-b)+16px)] z-40 grid h-12 w-12 place-items-center rounded-full bg-accent text-on-accent transition-transform active:scale-95 md:right-7"
      style={{ boxShadow: 'var(--toast-shadow)' }}
    >
      <ListPlus className="h-5 w-5" aria-hidden="true" />
      <span className="absolute -top-1 -right-1 grid min-h-5 min-w-5 place-items-center rounded-full border border-hairline bg-panel-2 px-1 font-mono text-[10px] leading-none text-paper tabular-nums">
        {count}
      </span>
    </button>,
    document.body,
  );
}

/** 选择式曲目列表：点行切换选中（checkbox 语义），FAB 统一提交。 */
export function TrackList({
  tracks,
  onLoadMore,
  loadingMore = false,
}: {
  tracks: SearchTrack[];
  onLoadMore?: () => void;
  loadingMore?: boolean;
}): JSX.Element {
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
      <EnqueueFab
        count={selectedRefs.size}
        onCommit={() => {
          enqueue(Array.from(selectedRefs));
          setSelectedRefs(new Set());
        }}
      />
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
