/**
 * 首页 = 漫游区：一键电台（provider 源目录驱动，改版方向待二次调研）、
 * 全局热门、本房热门。热门均为封面卡横向展示；歌单已在左侧曲库、
 * 点歌历史已折叠进账户菜单，不再重复呈现。
 */
import { useEffect, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { HotTrack, StatsEntry } from '../api/types';
import { api, roomStore } from '../app/session';
import { useIdentity, useProviders, useRoomState } from './hooks';
import { coverSrc } from './cover';
import { CoverThumb } from './CoverThumb';
import { SOURCE_DESC_KEYS } from './radioSources';
import { useToast } from './toast';
import { useShell } from './AppShell';

export default function HomeView(): JSX.Element {
  const { t } = useTranslation();
  const identity = useIdentity();

  return (
    <div className="view-enter mx-auto max-w-5xl px-4 pt-4 pb-10 md:px-7 md:pt-7">
      <div className="mb-1.5 font-mono text-[11px] tracking-[0.14em] uppercase text-faint">
        {t('home.eyebrow')}
      </div>
      <h1 className="mb-8 font-display text-4xl font-semibold">
        {t('lobby.greeting', { period: t(greetingKey()), name: identity?.name ?? '' })}
      </h1>

      <RadioSection />
      <HotSection />
      <RoomActivitySections />
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

// ---------- 随便听听（源目录驱动，按语义分组） ----------

function RadioSection(): JSX.Element | null {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const state = useRoomState();
  const { canRadio, setRoomsOpen } = useShell();
  const providers = useProviders();
  const { show, showError } = useToast();
  const [busy, setBusy] = useState(false);
  const catalog = (providers ?? []).flatMap((p) =>
    (p.capabilities?.radio_sources ?? []).map((source) => ({
      providerId: p.id,
      source,
      credentialOk: p.credential_status === 'ok',
      owned: p.owned === true,
    })),
  );

  // 回归 provider 侧原始语义：finite 无参源（每日推荐/新歌等）是每日/定期刷新的
  // 曲目集合 → 进集合页（复用曲库歌单展示）；无限流（私人FM/心动）才是真电台 → 直接开。
  // simi 是「当前曲目的相似检索」，入口在播放控制区（相似小窗），不在此陈列；
  // 带参源（top:<id>/fav:<id>）首页无参数上下文，不陈列。
  const collections = catalog.filter((e) => e.source.finite && !e.source.arg);
  const radios = catalog.filter((e) => !e.source.finite && e.source.spec !== 'simi');

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

  if (collections.length === 0 && radios.length === 0) return null;

  const cardClass =
    'rounded-lg border border-hairline bg-panel px-4 py-4 text-left transition-colors hover:border-accent hover:bg-panel-2 disabled:opacity-40';

  return (
    <>
      {collections.length > 0 && (
        <section>
          <SectionTitle>{t('home.collectionsTitle')}</SectionTitle>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {collections.map(({ providerId, source, credentialOk }) => {
              const usable = !source.requires_credential || credentialOk;
              return (
                <button
                  key={`${providerId}:${source.spec}`}
                  type="button"
                  disabled={!usable}
                  title={usable ? undefined : t('radio.credentialNeed')}
                  onClick={() =>
                    navigate(`/source/${encodeURIComponent(`${providerId}:${source.spec}`)}`)
                  }
                  className={cardClass}
                >
                  <div className="font-display text-[15px] font-semibold">{source.name ?? source.spec}</div>
                  {SOURCE_DESC_KEYS[source.spec] && (
                    <div className="mt-1 text-xs text-muted">{t(SOURCE_DESC_KEYS[source.spec])}</div>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {radios.length > 0 && (
        <section>
          <SectionTitle>{t('home.radioTitle')}</SectionTitle>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {radios.map(({ providerId, source, credentialOk, owned }) => {
              const usable = !source.requires_credential || credentialOk;
              // 心动模式绑定凭据账号的喜欢列表：非 owner 可开，但先说明基底是谁的口味
              const descKey =
                source.spec === 'heart' && source.requires_credential && !owned
                  ? 'radio.heartBoundHint'
                  : SOURCE_DESC_KEYS[source.spec];
              return (
                <button
                  key={`${providerId}:${source.spec}`}
                  type="button"
                  disabled={busy || !usable}
                  title={usable ? undefined : t('radio.credentialNeed')}
                  onClick={() => start(`${providerId}:${source.spec}`)}
                  className={cardClass}
                >
                  <div className="font-display text-[15px] font-semibold">{source.name ?? source.spec}</div>
                  {descKey && <div className="mt-1 text-xs text-muted">{t(descKey)}</div>}
                </button>
              );
            })}
          </div>
          {state.roomId && !canRadio && (
            <p className="mt-2 text-[11px] text-faint">{t('home.radioNeedControl')}</p>
          )}
        </section>
      )}
    </>
  );
}

// ---------- 全局热门（跨房间 play_history 聚合，分页） ----------

const HOT_PAGE_SIZE = 8;

function HotSection(): JSX.Element | null {
  const { t } = useTranslation();
  const { showError } = useToast();
  const [hot, setHot] = useState<HotTrack[] | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let dead = false;
    api
      .hotTracks(7, HOT_PAGE_SIZE)
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

  const loadMore = () => {
    if (!hot || loadingMore) return;
    setLoadingMore(true);
    api
      .hotTracks(7, HOT_PAGE_SIZE, hot.length)
      .then((more) => setHot((current) => [...(current ?? []), ...more]))
      .catch(showError)
      .finally(() => setLoadingMore(false));
  };

  if (!hot || hot.length === 0) return null;

  return (
    <section>
      <SectionTitle>{t('home.hotTitle')}</SectionTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {hot.map((entry) => (
          <ActivityCard
            key={entry.track_ref}
            trackRef={entry.track_ref}
            title={entry.title}
            meta={t('home.playCount', { count: entry.play_count })}
          />
        ))}
      </div>
      {hot.length % HOT_PAGE_SIZE === 0 && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="mt-3 w-full rounded-md border border-hairline py-2.5 text-xs text-accent hover:bg-panel disabled:opacity-40"
        >
          {loadingMore ? t('common.loading') : t('home.loadMore')}
        </button>
      )}
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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((entry) => (
          <ActivityCard
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

/** 热门条目卡片：封面 + 标题 + 副信息；整卡点击入队。 */
function ActivityCard({ trackRef, title, meta }: { trackRef: string; title: string; meta: string }) {
  const { t } = useTranslation();
  const { setRoomsOpen } = useShell();
  const { show, showError } = useToast();
  const state = useRoomState();
  return (
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
      className="group rounded-lg border border-hairline bg-panel p-3 text-left transition-colors hover:border-accent hover:bg-panel-2"
    >
      <CoverThumb
        src={coverSrc(`/api/v1/cover/${encodeURIComponent(trackRef)}`)}
        className="aspect-square w-full rounded"
      />
      <div className="mt-2 line-clamp-2 text-[13px] leading-snug font-medium">{title}</div>
      <div className="mt-0.5 line-clamp-2 text-[11px] text-faint">{meta}</div>
    </button>
  );
}

