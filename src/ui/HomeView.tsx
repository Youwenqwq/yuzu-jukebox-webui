/**
 * 首页 = 漫游区：零意图入口。一键电台（provider 源目录驱动）、全局热门、
 * 歌单浏览、本房热门、我最近点的。热门/个人历史要求 requester 角色，
 * 无该角色（或端点拒绝）时对应区块静默隐藏，不造假。
 */
import { useEffect, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { HistoryEntry, HotTrack, PlaylistInfo, StatsEntry } from '../api/types';
import { api, roomStore } from '../app/session';
import { useIdentity, useProviders, useRoomState } from './hooks';
import { formatClock } from './format';
import { composeSource, SOURCE_DESC_KEYS } from './radioSources';
import { useToast } from './toast';
import { useShell } from './AppShell';

export default function HomeView(): JSX.Element {
  const { t } = useTranslation();
  const identity = useIdentity();

  return (
    <div className="view-enter mx-auto max-w-5xl px-7 pt-7 pb-10">
      <div className="mb-1.5 font-mono text-[11px] tracking-[0.14em] uppercase text-faint">
        {t('home.eyebrow')}
      </div>
      <h1 className="mb-8 font-display text-4xl font-semibold">
        {t('lobby.greeting', { period: t(greetingKey()), name: identity?.name ?? '' })}
      </h1>

      <RadioSection />
      <HotSection />
      <PlaylistSection />
      <RoomActivitySections />
      <MyHistorySection />
    </div>
  );
}

function greetingKey(): string {
  const h = new Date().getHours();
  if (h < 5) return 'lobby.periodNight';
  if (h < 12) return 'lobby.periodMorning';
  if (h < 14) return 'lobby.periodNoon';
  if (h < 18) return 'lobby.periodAfternoon';
  return 'lobby.periodEvening';
}

function SectionTitle({ children }: { children: string }) {
  return (
    <h2 className="mt-9 mb-3 font-mono text-[11px] tracking-[0.14em] uppercase text-faint">{children}</h2>
  );
}

// ---------- 一键电台（源目录驱动） ----------

function RadioSection(): JSX.Element | null {
  const { t } = useTranslation();
  const state = useRoomState();
  const { canRadio, setRoomsOpen } = useShell();
  const providers = useProviders();
  const { show, showError } = useToast();
  const [busy, setBusy] = useState(false);

  const catalog = (providers ?? []).flatMap((p) =>
    (p.capabilities?.radio_sources ?? []).map((source) => ({ providerId: p.id, source })),
  );

  const start = (source: string) => {
    if (!state.roomId) {
      show(t('home.needRoom'));
      setRoomsOpen(true);
      return;
    }
    if (!canRadio) {
      show(t('home.radioNeedControl'));
      return;
    }
    if (busy) return;
    setBusy(true);
    void roomStore
      .radioPlay(source)
      .then(() => show(t('roomAdmin.radioStarted')))
      .catch(showError)
      .finally(() => setBusy(false));
  };

  if (catalog.length === 0) return null;
  const currentRef = state.playback.current?.track_ref;

  return (
    <section>
      <SectionTitle>{t('home.radioTitle')}</SectionTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {catalog.map(({ providerId, source }) => {
          const composed = composeSource(providerId, source, currentRef);
          return (
            <button
              key={`${providerId}:${source.spec}`}
              type="button"
              disabled={busy || composed === null}
              title={composed === null ? t('radio.seedNeed') : undefined}
              onClick={() => start(composed!)}
              className="rounded-lg border border-hairline bg-panel px-4 py-4 text-left transition-colors hover:border-accent hover:bg-panel-2 disabled:opacity-40"
            >
              <div className="font-display text-[15px] font-semibold">{source.name ?? source.spec}</div>
              {SOURCE_DESC_KEYS[source.spec] && (
                <div className="mt-1 text-xs text-muted">{t(SOURCE_DESC_KEYS[source.spec])}</div>
              )}
            </button>
          );
        })}
      </div>
      {state.roomId && !canRadio && (
        <p className="mt-2 text-[11px] text-faint">{t('home.radioNeedControl')}</p>
      )}
    </section>
  );
}

// ---------- 全局热门（跨房间 play_history 聚合） ----------

function HotSection(): JSX.Element | null {
  const { t } = useTranslation();
  const [hot, setHot] = useState<HotTrack[] | null>(null);

  useEffect(() => {
    let dead = false;
    api
      .hotTracks(7, 8)
      .then((rows) => {
        if (!dead) setHot(rows);
      })
      .catch(() => {
        // 无 requester 角色等拒绝：区块静默隐藏
        if (!dead) setHot([]);
      });
    return () => {
      dead = true;
    };
  }, []);

  if (!hot || hot.length === 0) return null;

  return (
    <section>
      <SectionTitle>{t('home.hotTitle')}</SectionTitle>
      <div className="overflow-hidden rounded-lg border border-hairline bg-panel">
        {hot.map((entry) => (
          <ActivityRow
            key={entry.track_ref}
            trackRef={entry.track_ref}
            title={entry.title}
            meta={t('home.playCount', { count: entry.play_count })}
          />
        ))}
      </div>
    </section>
  );
}

// ---------- 歌单 ----------

function PlaylistSection(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState<PlaylistInfo[] | null>(null);

  useEffect(() => {
    api
      .listPlaylists()
      .then(setPlaylists)
      .catch(() => setPlaylists([]));
  }, []);

  if (playlists === null || playlists.length === 0) return <></>;

  return (
    <section>
      <SectionTitle>{t('home.playlistsTitle')}</SectionTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {playlists.map((playlist) => (
          <button
            key={playlist.id}
            type="button"
            onClick={() => navigate(`/playlist/${encodeURIComponent(playlist.id)}`)}
            className="rounded-lg border border-hairline bg-panel px-4 py-4 text-left transition-colors hover:border-faint hover:bg-panel-2"
          >
            <div className="truncate font-display text-[15px] font-semibold">{playlist.name}</div>
            <div className="mt-1 text-xs text-muted">
              {t('batch.trackCount', { count: playlist.track_count })}
            </div>
            {playlist.description && (
              <div className="mt-1.5 line-clamp-2 text-[11px] text-faint">{playlist.description}</div>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------- 本房热门 ----------

function RoomActivitySections(): JSX.Element | null {
  const { t } = useTranslation();
  const state = useRoomState();
  const [stats, setStats] = useState<StatsEntry[] | null>(null);
  const roomId = state.roomId;

  useEffect(() => {
    setStats(null);
    if (!roomId) return;
    let dead = false;
    api.roomStats(roomId, 8).then((rows) => !dead && setStats(rows)).catch(() => !dead && setStats([]));
    return () => {
      dead = true;
    };
  }, [roomId]);

  if (!roomId || !stats || stats.length === 0) return null;

  return (
    <section>
      <SectionTitle>{t('home.statsTitle')}</SectionTitle>
      <div className="overflow-hidden rounded-lg border border-hairline bg-panel">
        {stats.map((entry) => (
          <ActivityRow
            key={entry.track_ref}
            trackRef={entry.track_ref}
            title={entry.title}
            meta={t('home.playCount', { count: entry.play_count })}
          />
        ))}
      </div>
    </section>
  );
}

// ---------- 我最近点的（跨房间个人历史） ----------

function MyHistorySection(): JSX.Element | null {
  const { t } = useTranslation();
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);

  useEffect(() => {
    let dead = false;
    api
      .myHistory(0, 8)
      .then((rows) => {
        if (!dead) setHistory(rows);
      })
      .catch(() => {
        // 无 requester 角色等拒绝：区块静默隐藏
        if (!dead) setHistory([]);
      });
    return () => {
      dead = true;
    };
  }, []);

  if (!history || history.length === 0) return null;

  return (
    <section>
      <SectionTitle>{t('home.myHistoryTitle')}</SectionTitle>
      <div className="overflow-hidden rounded-lg border border-hairline bg-panel">
        {history.map((entry) => (
          <ActivityRow
            key={`${entry.track_ref}:${entry.ended_at}`}
            trackRef={entry.track_ref}
            title={entry.title}
            meta={formatClock(entry.ended_at)}
          />
        ))}
      </div>
    </section>
  );
}

function ActivityRow({ trackRef, title, meta }: { trackRef: string; title: string; meta: string }) {
  const { t } = useTranslation();
  const { setRoomsOpen } = useShell();
  const { show, showError } = useToast();
  const state = useRoomState();
  return (
    <div className="group flex items-center gap-3 border-b border-hairline px-4 py-2.5 last:border-b-0 hover:bg-panel-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px]">{title}</div>
        <div className="mt-0.5 text-[11.5px] text-faint">{meta}</div>
      </div>
      <button
        type="button"
        title={t('search.add')}
        onClick={() => {
          if (!state.roomId) {
            show(t('home.needRoom'));
            setRoomsOpen(true);
            return;
          }
          void roomStore
            .addQueue([trackRef])
            .then(() => show(t('room.addedToast', { title })))
            .catch(showError);
        }}
        className="grid h-7 w-7 flex-none place-items-center rounded-full border border-hairline text-muted opacity-0 transition-opacity hover:border-accent hover:text-accent focus:opacity-100 group-hover:opacity-100"
      >
        +
      </button>
    </div>
  );
}

