import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { HistoryEntry, RoomAccessCode, RoomAccessMode, RoomPolicy, StatsEntry } from '../api/types';
import { mergeRoomPolicy } from '../api/policy';
import { api } from '../app/session';
import { formatDateTime } from './format';
import { RoomGrantPanel } from './RoomGrantPanel';
import { RoomOutputPanel } from './RoomOutputPanel';
import { Select, TabPanel, Tabs } from './primitives';
import { useToast } from './toast';

const QUEUE_LIMIT_ROLES = ['guest', 'requester', 'room_admin', 'media_admin'] as const;
const HISTORY_PAGE = 50;
const STATS_DEFAULT = 20;
const STATS_MAX = 100;

type QueueLimitRole = (typeof QUEUE_LIMIT_ROLES)[number];
type HistoryTab = 'history' | 'stats';

interface QueueLimitRow {
  role: QueueLimitRole;
  value: string;
}

const QUEUE_LIMIT_ROLE_LOOKUP: Record<string, boolean> = {
  guest: true,
  requester: true,
  room_admin: true,
  media_admin: true,
};
const QUEUE_LIMIT_LABEL_KEYS: Record<QueueLimitRole, string> = {
  guest: 'roomAdmin.roleGuest',
  requester: 'roomAdmin.roleRequester',
  room_admin: 'roomAdmin.roleRoomAdmin',
  media_admin: 'roomAdmin.roleMediaAdmin',
};
const END_REASON_KEYS: Record<string, string> = {
  finished: 'roomAdmin.historyReasonFinished',
  skipped: 'roomAdmin.historyReasonSkipped',
};

export function RoomAdminPanel({
  roomId,
  canManagePolicy,
  requesterNames,
}: {
  roomId: string;
  canManagePolicy: boolean;
  requesterNames: ReadonlyMap<string, string>;
}) {
  const { t } = useTranslation();
  const { show, showError } = useToast();
  const [open, setOpen] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [principalNames, setPrincipalNames] = useState<Map<string, string>>(() => new Map());
  const [stats, setStats] = useState<StatsEntry[] | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [statsExpanded, setStatsExpanded] = useState(false);
  const [historyTab, setHistoryTab] = useState<HistoryTab>('history');

  const [maxQueue, setMaxQueue] = useState('0');
  const [queueLimits, setQueueLimits] = useState<QueueLimitRow[]>([]);
  const [memberPlayerVolume, setMemberPlayerVolume] = useState(false);
  const [radioControl, setRadioControl] = useState<'controller' | 'requester'>('controller');
  /**
   * 保存策略时的合并基底：本次打开面板时从服务端读到的完整 policy。
   * SetPolicy 是整体替换，基底不能来自可能过期的本地快照（房间快照里没有 policy），
   * 也不能省略——面板不认识的键（start_lead_ms 等）靠它原样回传。
   */
  const [policyBase, setPolicyBase] = useState<RoomPolicy | null>(null);
  const [policySaving, setPolicySaving] = useState(false);

  const [accessMode, setAccessMode] = useState<RoomAccessMode>('open');
  const [accessPassword, setAccessPassword] = useState('');
  const [codePeriodHours, setCodePeriodHours] = useState('24');
  const [trustedRoles, setTrustedRoles] = useState('');
  const [accessSaving, setAccessSaving] = useState(false);
  const [accessCode, setAccessCode] = useState<RoomAccessCode | null>(null);
  const [accessCodeLoading, setAccessCodeLoading] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    setHistory(null);
    setStats(null);
    setPolicyBase(null);
    setPrincipalNames(new Map());

    Promise.all([
      api.listRooms(),
      api.roomHistory(roomId, 0, HISTORY_PAGE),
      api.roomStats(roomId, STATS_DEFAULT),
      canManagePolicy ? api.listPrincipals(undefined, 100).catch(() => []) : Promise.resolve([]),
    ])
      .then(async ([rooms, nextHistory, nextStats, principals]) => {
        if (cancelled) return;
        const room = rooms.find((item) => item.id === roomId);
        if (!room) {
          setLoadFailed(true);
          return;
        }

        const nextPrincipalNames = new Map(
          principals.map((principal) => [principal.id, principal.name]),
        );
        if (canManagePolicy) {
          const missingIds = [
            ...new Set(
              nextHistory
                .map((entry) => entry.requested_by)
                .filter((id) => id && !nextPrincipalNames.has(id)),
            ),
          ];
          const resolved = await Promise.all(
            missingIds.map(async (principalId) => {
              try {
                const matches = await api.listPrincipals(principalId, 10);
                return matches.find((principal) => principal.id === principalId) ?? null;
              } catch {
                return null;
              }
            }),
          );
          for (const principal of resolved) {
            if (principal) nextPrincipalNames.set(principal.id, principal.name);
          }
        }
        if (cancelled) return;
        setPolicyBase(room.policy ?? {});
        setMaxQueue(String(room.policy.max_queue ?? 0));
        setQueueLimits(
          Object.entries(room.policy.queue_limits ?? {})
            .filter(([role]) => QUEUE_LIMIT_ROLE_LOOKUP[role])
            .map(([role, value]) => ({ role: role as QueueLimitRole, value: String(value) })),
        );
        setMemberPlayerVolume(room.policy.member_player_volume ?? false);
        setRadioControl(room.policy.radio_control === 'requester' ? 'requester' : 'controller');
        setAccessMode(room.guest_access?.mode ?? 'open');
        setAccessPassword('');
        setTrustedRoles((room.guest_access?.trusted_roles ?? []).join(', '));
        setCodePeriodHours(
          String(
            Math.max(
              1,
              Math.round((room.guest_access?.code_period_seconds ?? 86400) / 3600),
            ),
          ),
        );
        setAccessCode(null);
        setPrincipalNames(nextPrincipalNames);
        setHistory(nextHistory);
        setHistoryHasMore(nextHistory.length >= HISTORY_PAGE);
        setStats(nextStats);
        setStatsExpanded(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadFailed(true);
        showError(error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canManagePolicy, loadVersion, open, roomId, showError]);

  const selectedRoles = new Set(queueLimits.map((row) => row.role));
  const nextRole = QUEUE_LIMIT_ROLES.find((role) => !selectedRoles.has(role));

  const loadMoreHistory = async () => {
    if (historyBusy || !history) return;
    setHistoryBusy(true);
    try {
      const more = await api.roomHistory(roomId, history.length, HISTORY_PAGE);
      setHistory((current) => [...(current ?? []), ...more]);
      setHistoryHasMore(more.length >= HISTORY_PAGE);
    } catch (error: unknown) {
      showError(error);
    } finally {
      setHistoryBusy(false);
    }
  };

  const expandStats = async () => {
    try {
      setStats(await api.roomStats(roomId, STATS_MAX));
      setStatsExpanded(true);
    } catch (error: unknown) {
      showError(error);
    }
  };

  const saveAccess = async () => {
    if (!canManagePolicy || accessSaving) return;
    if (accessMode === 'static_password' && !accessPassword.trim()) return;
    setAccessSaving(true);
    try {
      const periodHours = Math.max(1, Math.floor(Number(codePeriodHours) || 24));
      const result = await api.updateRoom(roomId, {
        guest_access_mode: accessMode,
        guest_password:
          accessMode === 'static_password' ? accessPassword : undefined,
        guest_code_period_seconds:
          accessMode === 'rotating_code' ? periodHours * 3600 : undefined,
        trusted_roles: trustedRoles
          .split(',')
          .map((role) => role.trim())
          .filter(Boolean),
      });
      if (result.guest_access) {
        setAccessMode(result.guest_access.mode);
        setCodePeriodHours(
          String(
            Math.max(
              1,
              Math.round((result.guest_access.code_period_seconds ?? 86400) / 3600),
            ),
          ),
        );
        setTrustedRoles((result.guest_access.trusted_roles ?? []).join(', '));
      }
      setAccessPassword('');
      setAccessCode(null);
      show(t('roomAdmin.accessSaved'));
    } catch (error: unknown) {
      showError(error);
    } finally {
      setAccessSaving(false);
    }
  };

  const loadAccessCode = async () => {
    if (!canManagePolicy || accessCodeLoading) return;
    setAccessCodeLoading(true);
    try {
      setAccessCode(await api.roomAccessCode(roomId));
    } catch (error: unknown) {
      showError(error);
    } finally {
      setAccessCodeLoading(false);
    }
  };

  const copyAccessCode = async () => {
    if (!accessCode) return;
    try {
      await navigator.clipboard.writeText(accessCode.code);
      show(t('roomAdmin.accessCodeCopied'));
    } catch (error: unknown) {
      showError(error);
    }
  };

  return (
    <section className="mt-4 overflow-hidden rounded-lg border border-hairline bg-panel">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-3 px-4.5 py-3.5 text-left hover:bg-panel-2"
      >
        <span className="font-mono text-[11px] tracking-[0.14em] text-faint">{t('roomAdmin.title')}</span>
        <span className="ml-auto text-xs text-muted transition-transform" style={{ transform: open ? 'rotate(180deg)' : undefined }}>
          ▼
        </span>
      </button>

      {open && (
        <div className="border-t border-hairline px-4.5 py-4">
          <div className={`grid gap-4 ${canManagePolicy ? 'xl:grid-cols-2' : ''}`}>
            {canManagePolicy && (
            <section className="rounded-md border border-hairline bg-panel-2 p-4">
              <h2 className="font-display text-lg font-semibold">{t('roomAdmin.policyTitle')}</h2>
              {loading ? (
                <p className="mt-4 text-sm text-muted">{t('common.loading')}</p>
              ) : loadFailed ? (
                <div className="mt-4 text-sm text-muted">
                  {t('roomAdmin.loadFailed')}
                  <button
                    type="button"
                    onClick={() => setLoadVersion((value) => value + 1)}
                    className="ml-3 text-accent"
                  >
                    {t('common.retry')}
                  </button>
                </div>
              ) : (
                <form
                  className="mt-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (policySaving || policyBase === null) return;
                    const limits: Record<string, number> = {};
                    for (const row of queueLimits) {
                      limits[row.role] = Math.max(0, Math.floor(Number(row.value) || 0));
                    }
                    // policy 是整体替换：以服务端基底合并，只写表单拥有的键，
                    // 面板不认识的字段（start_lead_ms 等）原样回传（见 api/policy.ts）。
                    const policy = mergeRoomPolicy(policyBase, {
                      max_queue: Math.max(0, Math.floor(Number(maxQueue) || 0)),
                      member_player_volume: memberPlayerVolume,
                      radio_control: radioControl,
                      queue_limits: limits,
                      editable_queue_limit_roles: QUEUE_LIMIT_ROLES,
                    });
                    setPolicySaving(true);
                    void api
                      .updateRoom(roomId, { policy })
                      .then(() => {
                        // 保存成功后基底就是刚提交的这份，后续再保存不会退回旧值。
                        setPolicyBase(policy);
                        show(t('roomAdmin.policySaved'));
                      })
                      .catch(showError)
                      .finally(() => setPolicySaving(false));
                  }}
                >
                  <label className="block text-xs text-muted">
                    {t('roomAdmin.maxQueue')}
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={maxQueue}
                      onChange={(event) => setMaxQueue(event.target.value)}
                      className="mt-1.5 w-full rounded-md border border-hairline bg-panel px-3 py-2 text-[13px] tabular-nums"
                    />
                  </label>
                  <p className="mt-1 text-[11px] text-faint">{t('roomAdmin.zeroUnlimited')}</p>

                  <div className="mt-4 flex items-center justify-between gap-4 rounded-md border border-hairline bg-panel px-3 py-2.5">
                    <div className="text-xs text-muted">{t('roomAdmin.memberPlayerVolume')}</div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={memberPlayerVolume}
                      aria-label={t('roomAdmin.memberPlayerVolume')}
                      onClick={() => setMemberPlayerVolume((value) => !value)}
                      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                        memberPlayerVolume ? 'bg-accent' : 'border border-hairline bg-[var(--rail)]'
                      }`}
                    >
                      <span
                        className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-[left,background-color] ${
                          memberPlayerVolume ? 'left-[19px] bg-on-accent' : 'left-[3px] bg-muted'
                        }`}
                      />
                    </button>
                  </div>

                  <div className="mt-4">
                    <span className="block text-xs text-muted">{t('roomAdmin.radioControl')}</span>
                    <Select
                      value={radioControl}
                      onValueChange={(value) => setRadioControl(value as 'controller' | 'requester')}
                      options={[
                        { value: 'controller', label: t('roomAdmin.radioControlController') },
                        { value: 'requester', label: t('roomAdmin.radioControlRequester') },
                      ]}
                      ariaLabel={t('roomAdmin.radioControl')}
                      className="mt-1.5 w-full"
                    />
                    <span className="mt-1 block text-[11px] text-faint">
                      {t('roomAdmin.radioControlHint')}
                    </span>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-3">
                    <h3 className="text-xs font-medium text-muted">{t('roomAdmin.queueLimits')}</h3>
                    <button
                      type="button"
                      disabled={!nextRole}
                      onClick={() => {
                        setQueueLimits((rows) => {
                          const usedRoles = new Set(rows.map((row) => row.role));
                          const role = QUEUE_LIMIT_ROLES.find((item) => !usedRoles.has(item));
                          return role ? [...rows, { role, value: '0' }] : rows;
                        });
                      }}
                      className="text-xs text-accent disabled:text-faint"
                    >
                      {t('roomAdmin.addQueueLimit')}
                    </button>
                  </div>

                  <div className="mt-2 grid gap-2">
                    {queueLimits.map((row) => {
                      const options = QUEUE_LIMIT_ROLES.filter(
                        (role) => role === row.role || !selectedRoles.has(role),
                      ).map((role) => ({ value: role, label: t(QUEUE_LIMIT_LABEL_KEYS[role]) }));
                      return (
                        <div key={row.role} className="grid grid-cols-[minmax(0,1fr)_90px_auto] items-center gap-2">
                          <Select
                            value={row.role}
                            options={options}
                            onValueChange={(value) => {
                              if (!QUEUE_LIMIT_ROLE_LOOKUP[value]) return;
                              setQueueLimits((rows) =>
                                rows.map((item) =>
                                  item.role === row.role ? { ...item, role: value as QueueLimitRole } : item,
                                ),
                              );
                            }}
                            className="w-full"
                          />
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={row.value}
                            aria-label={t('roomAdmin.queueLimitValue', {
                              role: t(QUEUE_LIMIT_LABEL_KEYS[row.role]),
                            })}
                            onChange={(event) => {
                              const value = event.target.value;
                              setQueueLimits((rows) =>
                                rows.map((item) => (item.role === row.role ? { ...item, value } : item)),
                              );
                            }}
                            className="w-full rounded-md border border-hairline bg-panel px-2.5 py-1.5 text-[13px] tabular-nums"
                          />
                          <button
                            type="button"
                            aria-label={t('roomAdmin.removeQueueLimit', {
                              role: t(QUEUE_LIMIT_LABEL_KEYS[row.role]),
                            })}
                            onClick={() => setQueueLimits((rows) => rows.filter((item) => item.role !== row.role))}
                            className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-panel hover:text-paper"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                    {queueLimits.length === 0 && (
                      <p className="py-2 text-xs text-faint">{t('roomAdmin.noQueueLimits')}</p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={policySaving || policyBase === null}
                    className="mt-4 rounded-full bg-accent px-4 py-1.5 text-[13px] font-medium text-on-accent hover:brightness-105 disabled:opacity-40"
                  >
                    {policySaving ? t('roomAdmin.policySaving') : t('roomAdmin.policySave')}
                  </button>
                </form>
              )}
            </section>
            )}
          </div>
          <RoomOutputPanel roomId={roomId} />
          {canManagePolicy && (
            <section className="mt-4 rounded-md border border-hairline bg-panel-2 p-4">
              <h2 className="font-display text-lg font-semibold">{t('roomAdmin.accessTitle')}</h2>
              <p className="mt-0.5 text-xs text-muted">{t('roomAdmin.accessIntro')}</p>
              {loading ? (
                <p className="mt-4 text-sm text-muted">{t('common.loading')}</p>
              ) : loadFailed ? (
                <div className="mt-4 text-sm text-muted">
                  {t('roomAdmin.loadFailed')}
                  <button
                    type="button"
                    onClick={() => setLoadVersion((value) => value + 1)}
                    className="ml-3 text-accent"
                  >
                    {t('common.retry')}
                  </button>
                </div>
              ) : (
                <form
                  className="mt-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveAccess();
                  }}
                >
                  <div>
                    <span className="block text-xs text-muted">{t('roomAdmin.accessMode')}</span>
                    <Select
                      value={accessMode}
                      onValueChange={(value) => setAccessMode(value as RoomAccessMode)}
                      options={[
                        { value: 'open', label: t('roomAdmin.accessModeOpen') },
                        { value: 'static_password', label: t('roomAdmin.accessModeStatic') },
                        { value: 'rotating_code', label: t('roomAdmin.accessModeRotating') },
                      ]}
                      ariaLabel={t('roomAdmin.accessMode')}
                      className="mt-1.5 w-full"
                    />
                  </div>

                  {accessMode === 'static_password' && (
                    <label className="mt-3 block text-xs text-muted">
                      {t('roomAdmin.accessPassword')}
                      <input
                        type="password"
                        required
                        value={accessPassword}
                        onChange={(event) => setAccessPassword(event.target.value)}
                        placeholder={t('roomAdmin.accessPasswordPlaceholder')}
                        className="mt-1.5 w-full rounded-md border border-hairline bg-panel px-3 py-2 text-[13px] placeholder:text-faint"
                      />
                      <span className="mt-1 block text-[11px] text-faint">
                        {t('roomAdmin.accessPasswordHint')}
                      </span>
                    </label>
                  )}

                  {accessMode === 'rotating_code' && (
                    <label className="mt-3 block text-xs text-muted">
                      {t('roomAdmin.codePeriodHours')}
                      <input
                        type="number"
                        min={1}
                        max={720}
                        step={1}
                        value={codePeriodHours}
                        onChange={(event) => setCodePeriodHours(event.target.value)}
                        className="mt-1.5 w-full rounded-md border border-hairline bg-panel px-3 py-2 text-[13px] tabular-nums"
                      />
                      <span className="mt-1 block text-[11px] text-faint">
                        {t('roomAdmin.codePeriodHint')}
                      </span>
                    </label>
                  )}
                  <label className="mt-3 block text-xs text-muted">
                    {t('roomAdmin.trustedRoles')}
                    <input
                      value={trustedRoles}
                      onChange={(event) => setTrustedRoles(event.target.value)}
                      placeholder={t('roomAdmin.trustedRolesPlaceholder')}
                      className="mt-1.5 w-full rounded-md border border-hairline bg-panel px-3 py-2 text-[13px] placeholder:text-faint"
                    />
                    <span className="mt-1 block text-[11px] text-faint">
                      {t('roomAdmin.trustedRolesHint')}
                    </span>
                  </label>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="submit"
                      disabled={
                        accessSaving ||
                        (accessMode === 'static_password' && !accessPassword.trim())
                      }
                      className="rounded-full bg-accent px-4 py-1.5 text-[13px] font-medium text-on-accent hover:brightness-105 disabled:opacity-40"
                    >
                      {accessSaving ? t('roomAdmin.accessSaving') : t('roomAdmin.accessSave')}
                    </button>
                    {accessMode === 'rotating_code' && (
                      <button
                        type="button"
                        disabled={accessCodeLoading}
                        onClick={() => void loadAccessCode()}
                        className="rounded-full border border-hairline px-4 py-1.5 text-[13px] text-muted hover:border-faint hover:text-paper disabled:opacity-40"
                      >
                        {accessCodeLoading
                          ? t('roomAdmin.accessCodeLoading')
                          : t('roomAdmin.accessCodeShow')}
                      </button>
                    )}
                  </div>

                  {accessMode === 'rotating_code' && accessCode && (
                    <div className="mt-4 rounded-md border border-[#D7A94A]/40 bg-[#D7A94A]/8 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold text-paper">
                            {t('roomAdmin.accessCodeLabel')}
                          </p>
                          <p className="mt-1 text-xs text-muted">
                            {t('roomAdmin.accessCodeExpires', {
                              time: formatDateTime(accessCode.expires_at),
                            })}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void copyAccessCode()}
                          className="rounded-full border border-hairline px-3 py-1 text-xs text-muted hover:border-faint hover:text-paper"
                        >
                          {t('roomAdmin.accessCodeCopy')}
                        </button>
                      </div>
                      <code className="mt-3 block select-all break-all rounded bg-canvas px-3 py-2 font-mono text-sm tracking-[0.18em] text-paper">
                        {accessCode.code}
                      </code>
                    </div>
                  )}
                </form>
              )}
            </section>
          )}
          {canManagePolicy && <RoomGrantPanel roomId={roomId} />}


          <section className="mt-4 rounded-md border border-hairline bg-panel-2 p-4">
            <Tabs
              value={historyTab}
              onValueChange={(value) => setHistoryTab(value === 'stats' ? 'stats' : 'history')}
              tabs={[
                { value: 'history', label: t('roomAdmin.historyTitle') },
                { value: 'stats', label: t('roomAdmin.statsTitle') },
              ]}
            >
              <TabPanel value="history">
                <AdminDataState loading={loading} failed={loadFailed} onRetry={() => setLoadVersion((value) => value + 1)}>
                  {history && history.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
                        <thead className="font-mono text-[10px] tracking-[0.1em] text-faint">
                          <tr className="border-b border-hairline">
                            <th scope="col" className="px-2 py-2 font-normal">{t('roomAdmin.trackTitle')}</th>
                            <th scope="col" className="px-2 py-2 font-normal">{t('roomAdmin.requestedBy')}</th>
                            <th scope="col" className="px-2 py-2 font-normal">{t('roomAdmin.endedAt')}</th>
                            <th scope="col" className="px-2 py-2 font-normal">{t('roomAdmin.endReason')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {history.map((entry) => (
                            <tr key={`${entry.track_ref}:${entry.started_at}`} className="border-b border-hairline last:border-b-0">
                              <td className="px-2 py-2.5 text-paper">{entry.title}</td>
                              <td className="px-2 py-2.5 text-muted">
                                {principalNames.get(entry.requested_by) ??
                                  requesterNames.get(entry.requested_by) ??
                                  entry.requested_by}
                              </td>
                              <td className="whitespace-nowrap px-2 py-2.5 font-mono text-xs text-muted">
                                {formatDateTime(entry.ended_at)}
                              </td>
                              <td className="px-2 py-2.5 text-muted">
                                {END_REASON_KEYS[entry.end_reason]
                                  ? t(END_REASON_KEYS[entry.end_reason])
                                  : entry.end_reason}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {historyHasMore && (
                        <button
                          type="button"
                          onClick={() => void loadMoreHistory()}
                          disabled={historyBusy}
                          className="w-full border-t border-hairline py-2.5 text-xs text-accent disabled:opacity-40"
                        >
                          {historyBusy ? t('common.loading') : t('roomAdmin.loadMore')}
                        </button>
                      )}
                    </div>
                  ) : (
                    history && <p className="py-8 text-center text-sm text-faint">{t('roomAdmin.historyEmpty')}</p>
                  )}
                </AdminDataState>
              </TabPanel>

              <TabPanel value="stats">
                <AdminDataState loading={loading} failed={loadFailed} onRetry={() => setLoadVersion((value) => value + 1)}>
                  {stats && stats.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[520px] border-collapse text-left text-[13px]">
                        <thead className="font-mono text-[10px] tracking-[0.1em] text-faint">
                          <tr className="border-b border-hairline">
                            <th scope="col" className="px-2 py-2 font-normal">{t('roomAdmin.trackTitle')}</th>
                            <th scope="col" className="px-2 py-2 font-normal">{t('roomAdmin.playCount')}</th>
                            <th scope="col" className="px-2 py-2 font-normal">{t('roomAdmin.lastPlayedAt')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stats.map((entry) => (
                            <tr key={entry.track_ref} className="border-b border-hairline last:border-b-0">
                              <td className="px-2 py-2.5 text-paper">{entry.title}</td>
                              <td className="px-2 py-2.5 font-mono tabular-nums text-muted">{entry.play_count}</td>
                              <td className="whitespace-nowrap px-2 py-2.5 font-mono text-xs text-muted">
                                {formatDateTime(entry.last_played_at)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!statsExpanded && stats.length >= STATS_DEFAULT && (
                        <button
                          type="button"
                          onClick={() => void expandStats()}
                          className="w-full border-t border-hairline py-2.5 text-xs text-accent"
                        >
                          {t('roomAdmin.showAll')}
                        </button>
                      )}
                    </div>
                  ) : (
                    stats && <p className="py-8 text-center text-sm text-faint">{t('roomAdmin.statsEmpty')}</p>
                  )}
                </AdminDataState>
              </TabPanel>
            </Tabs>
          </section>
        </div>
      )}
    </section>
  );
}

function AdminDataState({
  loading,
  failed,
  onRetry,
  children,
}: {
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (loading) return <p className="py-8 text-center text-sm text-muted">{t('common.loading')}</p>;
  if (failed) {
    return (
      <div className="py-8 text-center text-sm text-muted">
        {t('roomAdmin.loadFailed')}
        <button type="button" onClick={onRetry} className="ml-3 text-accent">
          {t('common.retry')}
        </button>
      </div>
    );
  }
  return children;
}
