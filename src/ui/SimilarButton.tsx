/**
 * 相似歌曲小窗入口：当前曲目 provider 报告 capabilities.similar 时出现。
 * 语义是一次性检索（上游 simi/song），不是电台——电台形态的 simi 源
 * 仍在 RadioPanel，此处是播放控制旁的轻量入口。
 */
import { useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import type { ProviderInfo } from '../api/types';
import { api } from '../app/session';
import { useProviders, useRoomState } from './hooks';
import { TracksDialog } from './TracksDialog';

/** 当前曲目所属 provider 支持一次性相似查询时返回其 id，否则 null。 */
export function similarProvider(
  providers: ProviderInfo[] | null,
  trackRef: string | undefined,
): string | null {
  if (!trackRef) return null;
  const sep = trackRef.indexOf(':');
  if (sep <= 0) return null;
  const id = trackRef.slice(0, sep);
  return providers?.find((p) => p.id === id)?.capabilities?.similar ? id : null;
}

export function SimilarButton({ className }: { className?: string }): JSX.Element | null {
  const { t } = useTranslation();
  const state = useRoomState();
  const providers = useProviders();
  const [open, setOpen] = useState(false);

  const trackRef = state.playback.current?.track_ref;
  const provider = similarProvider(providers, trackRef);
  if (!provider || !trackRef) return null;
  const trackId = trackRef.slice(provider.length + 1);

  return (
    <>
      <button
        type="button"
        title={t('similar.open')}
        onClick={() => setOpen(true)}
        className={
          className ??
          'grid h-8 w-8 flex-none place-items-center rounded-full text-muted hover:bg-[var(--hover)] hover:text-paper'
        }
      >
        <Sparkles className="h-4 w-4" />
      </button>
      <TracksDialog
        open={open}
        onOpenChange={setOpen}
        title={t('similar.title')}
        load={() => api.similarTracks(provider, trackId, { limit: 50 })}
      />
    </>
  );
}
