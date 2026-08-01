/**
 * 加速资源运行状态面板：分发队列 / 存储容量 / 进行中上传 / 分发请求 /
 * Publisher 心跳 / 诊断（Inventory 扫描与累计指标）。
 *
 * 相对原实现的交互修正：
 * - 加载 / 失败 / 空三态分开——原来失败会退化成“没有数据”，把错误说成空。
 * - 低频诊断信息默认收起，首屏不再一次性铺 25 个指标块。
 * - 服务端已经返回但从未展示的诊断字段（last_error / next_attempt_at /
 *   health 细节 / 上传字节）补齐，不新增任何请求。
 * - 取消分发请求这类不可逆操作走确认对话框。
 * - 自动刷新是显式开关且默认关闭：不改变默认的网络行为。
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type {
  AccelerationInfo,
  AccelerationStatus,
  AccelerationStorageStatus,
  DistributionRequest,
} from '../../api/types';
import { api } from '../../app/session';
import { formatBytes, formatDateTime, formatMs } from '../format';
import { ConfirmDialog, Select } from '../primitives';
import {
  Badge,
  EmptyHint,
  ErrorNote,
  LoadError,
  LoadingHint,
  MetricTile,
  SectionHeading,
  StatusDot,
  dangerTextClass,
  pressureLabel,
  quietButtonClass,
  quietDangerButtonClass,
  secondaryButtonClass,
  stateLabel,
  type Translate,
} from './accelerationShared';

const AUTO_REFRESH_MS = 10_000;
/** radix Select 不接受空串作为选项值，用哨兵值代表「全部」，调 API 前换回 ''。 */
const ALL_STATES = 'all';
const SUMMARY_KEYS = ['requested', 'queued', 'leased', 'retry_wait', 'cancel_requested', 'ready', 'canceled'] as const;
const CORE_METRIC_KEYS: Record<string, true> = {
  requests: true,
  publish_success: true,
  publish_failure: true,
  uploaded_bytes: true,
  ready_latency_ms_total: true,
  ready_latency_samples: true,
};

export default function AccelerationStatusPanel({
  target,
  t,
  show,
  showError,
}: {
  target: AccelerationInfo;
  t: Translate;
  show: (message: string) => void;
  showError: (error: unknown) => void;
}) {
  const [status, setStatus] = useState<AccelerationStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [requests, setRequests] = useState<DistributionRequest[] | null>(null);
  const [requestsFailed, setRequestsFailed] = useState(false);
  const [requestState, setRequestState] = useState('');
  const [loading, setLoading] = useState(false);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<DistributionRequest | null>(null);
  const [canceling, setCanceling] = useState(false);
  const diagnosticsId = useId();
  const inFlight = useRef(false);

  const loadStatus = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        setStatus(await api.accelerationStatus(target.id));
        setStatusFailed(false);
      } catch (error: unknown) {
        setStatusFailed(true);
        if (!quiet) showError(error);
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [showError, target.id],
  );

  const loadRequests = useCallback(
    async (notify = false, quiet = false) => {
      if (!quiet) setRequestsLoading(true);
      try {
        setRequests((await api.accelerationRequests(target.id, requestState)).requests);
        setRequestsFailed(false);
        if (notify) show(t('admin.acceleration.requestsLoaded'));
      } catch (error: unknown) {
        setRequestsFailed(true);
        if (!quiet) showError(error);
      } finally {
        if (!quiet) setRequestsLoading(false);
      }
    },
    [requestState, show, showError, t, target.id],
  );

  const refreshInventory = useCallback(async () => {
    setInventoryLoading(true);
    try {
      await api.refreshAccelerationInventory(target.id);
      show(t('admin.acceleration.inventoryRefreshRequested'));
      await loadStatus();
    } catch (error: unknown) {
      showError(error);
    } finally {
      setInventoryLoading(false);
    }
  }, [loadStatus, show, showError, t, target.id]);

  const cancelRequest = useCallback(
    async (trackRef: string) => {
      setCanceling(true);
      try {
        await api.cancelAccelerationRequest(target.id, trackRef);
        show(t('admin.acceleration.requestCanceled'));
        setCancelTarget(null);
        await Promise.all([loadRequests(), loadStatus()]);
      } catch (error: unknown) {
        showError(error);
      } finally {
        setCanceling(false);
      }
    },
    [loadRequests, loadStatus, show, showError, t, target.id],
  );

  // 首次挂载与筛选条件变化时重取；不清空已有数据，避免整块闪回加载态。
  // 切换加速资源由父级的 key 触发重新挂载。
  useEffect(() => {
    void loadStatus();
    void loadRequests();
  }, [loadRequests, loadStatus]);

  // 自动刷新：静默重取，不弹 toast、不闪 loading 文案，卸载与关闭时清理。
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      if (inFlight.current) return;
      inFlight.current = true;
      void Promise.all([loadStatus(true), loadRequests(false, true)]).finally(() => {
        inFlight.current = false;
      });
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh, loadRequests, loadStatus]);

  return (
    <section className="mt-4 rounded-md border border-hairline bg-panel" aria-label={t('admin.acceleration.statusTitle', { name: target.name })}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline px-5 py-4">
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold">{t('admin.acceleration.statusTitle', { name: target.name })}</h3>
          <p className="mt-1 text-xs text-muted">{t('admin.acceleration.statusInlineIntro')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* 自动刷新是静默的，失败必须留下痕迹，否则页面会安静地展示过期数据。 */}
          {statusFailed && status !== null && <Badge tone="warn">{t('admin.acceleration.statusFailed')}</Badge>}
          <label className="flex items-center gap-2 text-xs text-muted" title={t('admin.acceleration.autoRefreshHint')}>
            <input
              type="checkbox"
              className="yuzu-checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
            />
            {t('admin.acceleration.autoRefresh')}
          </label>
          <button
            type="button"
            onClick={() => void loadStatus()}
            disabled={loading}
            aria-busy={loading || undefined}
            className={secondaryButtonClass}
          >
            {loading ? t('admin.common.working') : t('admin.acceleration.refresh')}
          </button>
        </div>
      </header>

      {statusFailed && status === null ? (
        <div className="p-5">
          <LoadError
            message={t('admin.acceleration.statusFailed')}
            retryLabel={t('common.retry')}
            onRetry={() => void loadStatus()}
          />
        </div>
      ) : status === null ? (
        <LoadingHint>{t('admin.acceleration.statusLoading')}</LoadingHint>
      ) : (
        <div className="grid gap-6 p-5">
          <QueueSummary status={status} t={t} />

          <StorageSection status={status} t={t} />

          <ActiveUploads status={status} t={t} />

          <RequestSection
            requests={requests}
            failed={requestsFailed}
            loading={requestsLoading}
            requestState={requestState}
            t={t}
            onRequestStateChange={setRequestState}
            onReload={() => void loadRequests(true)}
            onCancel={setCancelTarget}
          />

          <PublisherSection status={status} t={t} />

          <div>
            <SectionHeading
              action={
                <button
                  type="button"
                  onClick={() => void refreshInventory()}
                  disabled={inventoryLoading}
                  aria-busy={inventoryLoading || undefined}
                  className={quietButtonClass}
                >
                  {inventoryLoading ? t('admin.common.working') : t('admin.acceleration.refreshInventory')}
                </button>
              }
            >
              <button
                type="button"
                onClick={() => setDiagnosticsOpen((open) => !open)}
                aria-expanded={diagnosticsOpen}
                aria-controls={diagnosticsId}
                className="flex items-center gap-2 uppercase tracking-[0.12em] text-faint hover:text-paper"
              >
                <span aria-hidden>{diagnosticsOpen ? '▾' : '▸'}</span>
                {t('admin.acceleration.diagnostics')}
                {/* 收起状态下也要能看出里面有错，否则默认折叠会把故障藏起来。 */}
                {!diagnosticsOpen && status.inventory_scan?.last_error && (
                  <Badge tone="warn">{t('admin.acceleration.lastError')}</Badge>
                )}
              </button>
            </SectionHeading>
            {diagnosticsOpen && (
              <div id={diagnosticsId} className="grid gap-6">
                <InventorySection status={status} t={t} />
                <div>
                  <SectionHeading>{t('admin.acceleration.counters')}</SectionHeading>
                  <MetricList values={status.counters} empty={t('admin.acceleration.noMetrics')} t={t} />
                </div>
                <div>
                  <SectionHeading>{t('admin.acceleration.last24Hours')}</SectionHeading>
                  <MetricList values={status.last_24_hours} empty={t('admin.acceleration.noMetrics')} t={t} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
        title={t('admin.acceleration.cancelRequestTitle')}
        description={
          cancelTarget ? t('admin.acceleration.cancelRequestDescription', { ref: cancelTarget.track_ref }) : undefined
        }
        confirmText={canceling ? t('admin.common.working') : t('admin.acceleration.cancelRequestConfirm')}
        cancelText={t('common.cancel')}
        danger
        onConfirm={() => {
          if (cancelTarget) void cancelRequest(cancelTarget.track_ref);
        }}
      />
    </section>
  );
}

function QueueSummary({ status, t }: { status: AccelerationStatus; t: Translate }) {
  const headingId = useId();
  return (
    <div>
      <SectionHeading id={headingId}>{t('admin.acceleration.summary')}</SectionHeading>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-labelledby={headingId}>
        {SUMMARY_KEYS.map((key) => {
          const value = status.summary[key];
          return (
            <div key={key} className="rounded-md border border-hairline bg-panel px-3 py-3">
              <div className="text-xs text-muted">{t(`admin.acceleration.${key}`)}</div>
              <div className={`mt-1 font-mono text-xl tabular-nums ${value > 0 ? '' : 'text-faint'}`}>{value}</div>
            </div>
          );
        })}
      </div>
      {status.summary.oldest_queued_at !== undefined && status.summary.oldest_queued_at > 0 && (
        <p className="mt-2 text-xs text-muted">
          {t('admin.acceleration.oldestQueued')}：
          <span className="font-mono tabular-nums">{formatDateTime(status.summary.oldest_queued_at)}</span>
        </p>
      )}
    </div>
  );
}

function StorageSection({ status, t }: { status: AccelerationStatus; t: Translate }) {
  const headingId = useId();
  const storage = status.storage;
  return (
    <div>
      <SectionHeading
        id={headingId}
        action={<Badge tone={storage.pressure === 'normal' ? 'muted' : 'warn'}>{pressureLabel(t, storage.pressure)}</Badge>}
      >
        {t('admin.acceleration.storage')}
      </SectionHeading>
      {/* 容量条先于明细：它才是这一节的头条信息。 */}
      <StorageMeter storage={storage} t={t} />
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-labelledby={headingId}>
        <MetricTile label={t('admin.acceleration.accounted')} value={formatBytes(storage.accounted_bytes)} />
        <MetricTile label={t('admin.acceleration.reserved')} value={formatBytes(storage.reserved_bytes)} />
        <MetricTile label={t('admin.acceleration.observed')} value={formatBytes(storage.observed_bytes)} />
        <MetricTile label={t('admin.acceleration.objectCount')} value={String(storage.managed_object_count)} />
        <MetricTile label={t('admin.acceleration.observedObjects')} value={String(storage.observed_object_count)} />
        <MetricTile label={t('admin.acceleration.pendingDeletion')} value={String(storage.pending_deletion_count)} />
        <MetricTile label={t('admin.acceleration.orphanCount')} value={String(storage.orphan_count)} />
        <MetricTile label={t('admin.acceleration.missingCount')} value={String(storage.missing_count)} />
      </div>
      {storage.observed_at !== undefined && storage.observed_at > 0 && (
        <p className="mt-2 text-xs text-faint">
          {t('admin.acceleration.lastReconciled')}：
          <span className="font-mono tabular-nums">{formatDateTime(storage.observed_at)}</span>
        </p>
      )}
      {storage.reconciliation_error && (
        <ErrorNote label={t('admin.acceleration.lastError')} message={storage.reconciliation_error} />
      )}
    </div>
  );
}

function ActiveUploads({ status, t }: { status: AccelerationStatus; t: Translate }) {
  const headingId = useId();
  return (
    <div>
      <SectionHeading id={headingId}>{t('admin.acceleration.activeUploads')}</SectionHeading>
      {status.active.length === 0 ? (
        <EmptyHint>{t('admin.acceleration.noActiveUploads')}</EmptyHint>
      ) : (
        <div className="grid gap-2">
          {status.active.map((attempt) => {
            const progress =
              attempt.total_bytes > 0
                ? Math.min(100, Math.round((attempt.upload_bytes / attempt.total_bytes) * 100))
                : null;
            return (
              <div key={attempt.lease_id} className="rounded-md border border-hairline bg-panel px-3 py-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-mono text-paper" title={attempt.track_ref}>
                    {attempt.track_ref}
                  </span>
                  <Badge tone="accent">{stateLabel(t, attempt.phase)}</Badge>
                </div>
                <div
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel-2"
                  role="progressbar"
                  aria-valuenow={progress ?? undefined}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={attempt.track_ref}
                >
                  <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${progress ?? 8}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap justify-between gap-2 text-muted">
                  <span className="truncate font-mono">{attempt.owner}</span>
                  <span className="font-mono tabular-nums">
                    {progress === null
                      ? t('admin.acceleration.progressUnknown')
                      : `${formatBytes(attempt.upload_bytes)} / ${formatBytes(attempt.total_bytes)} · ${progress}%`}
                  </span>
                  <span className="font-mono tabular-nums">{formatDateTime(attempt.updated_at)}</span>
                </div>
                {attempt.last_error && <ErrorNote label={t('admin.acceleration.lastError')} message={attempt.last_error} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RequestSection({
  requests,
  failed,
  loading,
  requestState,
  t,
  onRequestStateChange,
  onReload,
  onCancel,
}: {
  requests: DistributionRequest[] | null;
  failed: boolean;
  loading: boolean;
  requestState: string;
  t: Translate;
  onRequestStateChange: (value: string) => void;
  onReload: () => void;
  onCancel: (request: DistributionRequest) => void;
}) {
  const headingId = useId();
  return (
    <div>
      <SectionHeading
        id={headingId}
        action={
          <div className="flex items-center gap-2">
            {requests !== null && requests.length > 0 && (
              <span className="text-xs text-faint tabular-nums">
                {t('admin.acceleration.requestTotal', { count: requests.length })}
              </span>
            )}
            <Select
              value={requestState === '' ? ALL_STATES : requestState}
              onValueChange={(value) => onRequestStateChange(value === ALL_STATES ? '' : value)}
              placeholder={t('admin.acceleration.allStates')}
              ariaLabel={t('admin.acceleration.requestState')}
              options={[
                { value: ALL_STATES, label: t('admin.acceleration.allStates') },
                { value: 'queued', label: t('admin.acceleration.queued') },
                { value: 'leased', label: t('admin.acceleration.leased') },
                { value: 'retry_wait', label: t('admin.acceleration.retryWait') },
                { value: 'cancel_requested', label: t('admin.acceleration.cancelRequested') },
                { value: 'ready', label: t('admin.acceleration.ready') },
                { value: 'canceled', label: t('admin.acceleration.canceled') },
              ]}
              className="min-w-32"
            />
            <button
              type="button"
              onClick={onReload}
              disabled={loading}
              aria-busy={loading || undefined}
              className={quietButtonClass}
            >
              {loading ? t('admin.common.working') : t('admin.acceleration.loadRequests')}
            </button>
          </div>
        }
      >
        {t('admin.acceleration.requestList')}
      </SectionHeading>
      {failed && requests === null ? (
        <LoadError message={t('admin.acceleration.requestsFailed')} retryLabel={t('common.retry')} onRetry={onReload} />
      ) : requests === null ? (
        <LoadingHint>{t('common.loading')}</LoadingHint>
      ) : requests.length === 0 ? (
        <EmptyHint>{t('admin.acceleration.noRequests')}</EmptyHint>
      ) : (
        <ul className="max-h-80 overflow-y-auto rounded-md border border-hairline" aria-labelledby={headingId}>
          {requests.map((request) => {
            const canCancel =
              request.state === 'queued' || request.state === 'leased' || request.state === 'retry_wait';
            return (
              <li
                key={request.track_ref}
                className="grid gap-2 border-b border-hairline px-3 py-2.5 text-xs last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate font-mono" title={request.track_ref}>
                      {request.track_ref}
                    </span>
                    <Badge>{stateLabel(t, request.state)}</Badge>
                    <span className="text-faint tabular-nums">
                      {t('admin.acceleration.attemptCount', { count: request.attempts })}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-faint">
                    <span className="font-mono tabular-nums">
                      {t('admin.acceleration.requestUpdated')} {formatDateTime(request.updated_at)}
                    </span>
                    {request.next_attempt_at > 0 && (
                      <span className="font-mono tabular-nums">
                        {t('admin.acceleration.nextAttempt')} {formatDateTime(request.next_attempt_at)}
                      </span>
                    )}
                    {request.pending_reason && <span className="truncate">{request.pending_reason}</span>}
                  </div>
                  {request.last_error && (
                    <p className={`mt-1 break-all ${dangerTextClass}`}>{request.last_error}</p>
                  )}
                </div>
                {canCancel ? (
                  <button
                    type="button"
                    onClick={() => onCancel(request)}
                    aria-label={t('admin.acceleration.cancelRequestFor', { ref: request.track_ref })}
                    className={quietDangerButtonClass}
                  >
                    {t('admin.acceleration.cancelRequest')}
                  </button>
                ) : (
                  <span />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PublisherSection({ status, t }: { status: AccelerationStatus; t: Translate }) {
  const headingId = useId();
  return (
    <div>
      <SectionHeading id={headingId}>{t('admin.acceleration.publisher')}</SectionHeading>
      {status.publishers.length === 0 ? (
        <EmptyHint>{t('admin.acceleration.noPublisher')}</EmptyHint>
      ) : (
        <div className="grid gap-2">
          {status.publishers.map((publisher) => (
            <div key={publisher.owner} className="rounded-md border border-hairline bg-panel px-3 py-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <StatusDot on={publisher.online} />
                  <span className="truncate font-mono text-paper">{publisher.owner}</span>
                </span>
                <span className={publisher.online ? 'text-accent' : 'text-faint'}>
                  {publisher.online ? t('admin.acceleration.publisherOnline') : t('admin.acceleration.publisherOffline')}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted">
                <span>{stateLabel(t, publisher.state)}</span>
                <span className="font-mono">{publisher.version || t('admin.common.none')}</span>
                <span>
                  {t('admin.acceleration.backendHealth')}：
                  {publisher.backend_healthy ? t('admin.acceleration.healthy') : t('admin.acceleration.unhealthy')}
                </span>
                <span className="font-mono tabular-nums">{formatDateTime(publisher.last_seen_at)}</span>
              </div>
              {publisher.capabilities.length > 0 && (
                <div className="mt-1 truncate font-mono text-[11px] text-faint">
                  {t('admin.acceleration.capabilities')}：{publisher.capabilities.join(' · ')}
                </div>
              )}
              {publisher.last_error && <ErrorNote label={t('admin.acceleration.lastError')} message={publisher.last_error} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InventorySection({ status, t }: { status: AccelerationStatus; t: Translate }) {
  const headingId = useId();
  const scan = status.inventory_scan;
  return (
    <div>
      <SectionHeading id={headingId}>{t('admin.acceleration.inventoryScan')}</SectionHeading>
      {!scan ? (
        <EmptyHint>{t('admin.acceleration.noInventoryScan')}</EmptyHint>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-labelledby={headingId}>
            <MetricTile label={t('admin.acceleration.scanState')} value={stateLabel(t, scan.state)} />
            <MetricTile label={t('admin.acceleration.scanAttempts')} value={String(scan.attempts)} />
            <MetricTile
              label={t('admin.acceleration.scanObservedAt')}
              value={scan.observed_at ? formatDateTime(scan.observed_at) : t('admin.common.none')}
            />
            <MetricTile label={t('admin.acceleration.scanUpdatedAt')} value={formatDateTime(scan.updated_at)} />
          </div>
          {scan.last_error && <ErrorNote label={t('admin.acceleration.lastError')} message={scan.last_error} />}
        </>
      )}
    </div>
  );
}

function StorageMeter({ storage, t }: { storage: AccelerationStorageStatus; t: Translate }) {
  const usedBytes = storage.accounted_bytes + storage.reserved_bytes;
  const usedPercent = storage.budget_bytes > 0 ? Math.min(100, (usedBytes / storage.budget_bytes) * 100) : 0;
  const overHigh = usedPercent >= storage.high_watermark_percent;
  return (
    <div className="rounded-md border border-hairline bg-panel-2 px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-muted">{t('admin.acceleration.storageUsage')}</span>
        <span className="font-mono tabular-nums">
          {formatBytes(usedBytes)} / {formatBytes(storage.budget_bytes)}
        </span>
      </div>
      <div
        className="relative mt-3 h-2 overflow-hidden rounded-full bg-panel"
        role="progressbar"
        aria-valuenow={Math.round(usedPercent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('admin.acceleration.storageUsage')}
      >
        <div className="absolute inset-y-0 left-0 border-l border-faint/70" style={{ left: `${storage.low_watermark_percent}%` }} />
        <div className="absolute inset-y-0 left-0 border-l border-[#D05A4E]/70" style={{ left: `${storage.high_watermark_percent}%` }} />
        <div
          className={`h-full rounded-full transition-[width] ${overHigh ? 'bg-[#D05A4E]' : 'bg-accent'}`}
          style={{ width: `${usedPercent}%` }}
        />
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-[11px] text-faint">
        <span>{t('admin.acceleration.storageUsagePercent', { value: usedPercent.toFixed(1) })}</span>
        <span>
          {t('admin.acceleration.storageWatermarkLegend', {
            low: storage.low_watermark_percent,
            high: storage.high_watermark_percent,
          })}
        </span>
      </div>
    </div>
  );
}

function MetricList({ values, empty, t }: { values: Record<string, number>; empty: string; t: Translate }) {
  const entries = Object.entries(values).filter(([key]) => CORE_METRIC_KEYS[key] === true);
  if (entries.length === 0) return <p className="text-sm text-faint">{empty}</p>;
  return (
    <div className="grid gap-px overflow-hidden rounded-md border border-hairline bg-hairline sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="flex min-w-0 items-center justify-between gap-4 bg-panel px-3 py-2.5 text-xs">
          <span className="truncate text-muted">{t(`admin.acceleration.metrics.${key}`)}</span>
          <span className="shrink-0 font-mono tabular-nums text-paper">{formatMetricValue(key, value)}</span>
        </div>
      ))}
    </div>
  );
}

function formatMetricValue(key: string, value: number): string {
  if (key.endsWith('_bytes')) return formatBytes(value);
  if (key.endsWith('_ms_total')) return formatMs(value);
  return new Intl.NumberFormat('zh-CN').format(value);
}
