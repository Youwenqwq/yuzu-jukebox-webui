import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  AccelerationCredentialResult,
  AccelerationInfo,
} from '../../api/types';
import { api } from '../../app/session';
import { formatBytes, formatDateTime } from '../format';
import { ConfirmDialog, Dialog } from '../primitives';
import { useToast } from '../toast';
import {
  AccelerationFormDialogBody,
  draftFromAcceleration,
  emptyDraft,
  toCreateInput,
  toUpdateInput,
  type AccelerationDraft,
} from './AccelerationForms';
import AccelerationStatusPanel from './AccelerationStatusPanel';
import {
  Badge,
  InfoRow,
  LoadError,
  LoadingHint,
  StatusDot,
  accentLinkButtonClass,
  dangerButtonClass,
  dangerTextClass,
  linkButtonClass,
  primaryButtonClass,
  purposeLabel,
  purposeOrder,
  secondaryButtonClass,
  type CredentialPurpose,
  type Translate,
} from './accelerationShared';

type CredentialReveal = {
  accelerationId: string;
  tokens: Array<{ purpose: CredentialPurpose; token: string }>;
};

/**
 * 需要二次确认的操作：停用会让新的分发请求停止排队，凭据生成/切换会立刻
 * 让旧令牌失效，删除不可逆。原实现只有删除有确认，其余点一下即生效。
 */
type ConfirmAction =
  | { type: 'disable' }
  | { type: 'delete' }
  | { type: 'prepare'; purpose: CredentialPurpose }
  | { type: 'activate'; purpose: CredentialPurpose };

export default function AccelerationAdmin() {
  const { t } = useTranslation();
  const { show, showError } = useToast();
  const [accelerations, setAccelerations] = useState<AccelerationInfo[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [statusExpanded, setStatusExpanded] = useState(true);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [credentialReveal, setCredentialReveal] = useState<CredentialReveal | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [createDraft, setCreateDraft] = useState<AccelerationDraft>(emptyDraft);
  const [editDraft, setEditDraft] = useState<AccelerationDraft>(emptyDraft);
  const statusRegionId = useId();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api.listAccelerations();
      setAccelerations(next);
      setLoadFailed(false);
      setSelectedId((current) => (next.some((item) => item.id === current) ? current : (next[0]?.id ?? '')));
    } catch (error: unknown) {
      setLoadFailed(true);
      setAccelerations([]);
      setSelectedId('');
      showError(error);
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => accelerations?.find((item) => item.id === selectedId) ?? null,
    [accelerations, selectedId],
  );

  const run = async (key: string, action: () => Promise<void>, success: string) => {
    if (busy !== null) return false;
    setBusy(key);
    try {
      await action();
      show(success);
      await load();
      return true;
    } catch (error: unknown) {
      showError(error);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    setBusy('create');
    try {
      const result = await api.createAcceleration(toCreateInput(createDraft));
      setCreateOpen(false);
      setCreateDraft(emptyDraft());
      show(t('admin.acceleration.created'));
      await load();
      setSelectedId(result.acceleration.id);
      setCredentialReveal({
        accelerationId: result.acceleration.id,
        tokens: [
          { purpose: 'publisher', token: result.credentials.publisher_token },
          { purpose: 'delivery', token: result.credentials.delivery_token },
          { purpose: 'backend', token: result.credentials.backend_token },
        ],
      });
    } catch (error: unknown) {
      showError(error);
    } finally {
      setBusy(null);
    }
  };

  const openEdit = () => {
    if (!selected) return;
    setEditDraft(draftFromAcceleration(selected));
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!selected) return;
    const saved = await run('edit', async () => {
      await api.updateAcceleration(selected.id, toUpdateInput(editDraft));
      setEditOpen(false);
    }, t('admin.acceleration.saved'));
    if (saved) setEditOpen(false);
  };

  const toggle = () => {
    if (!selected) return;
    void run(
      'toggle',
      async () => {
        await api.updateAcceleration(selected.id, { enabled: !selected.enabled });
      },
      selected.enabled ? t('admin.acceleration.disabled') : t('admin.acceleration.enabled'),
    );
  };

  const deleteAcceleration = async () => {
    if (!selected) return;
    const target = selected;
    const deleted = await run('delete', async () => {
      await api.deleteAcceleration(target.id);
      setCredentialReveal((current) => (current?.accelerationId === target.id ? null : current));
    }, t('admin.acceleration.deleted'));
    if (deleted) setSelectedId('');
  };

  const prepareCredential = async (purpose: CredentialPurpose) => {
    if (!selected) return;
    setBusy(`prepare:${purpose}`);
    try {
      const result: AccelerationCredentialResult = await api.prepareAccelerationCredential(selected.id, purpose);
      setCredentialReveal({
        accelerationId: selected.id,
        tokens: [{ purpose, token: result.token }],
      });
      show(t('admin.acceleration.credentialPrepared', { purpose: purposeLabel(t, purpose) }));
      await load();
    } catch (error: unknown) {
      showError(error);
    } finally {
      setBusy(null);
    }
  };

  const activateCredential = async (purpose: CredentialPurpose) => {
    if (!selected) return;
    await run(
      `activate:${purpose}`,
      async () => {
        await api.activateAccelerationCredential(selected.id, purpose);
      },
      t('admin.acceleration.credentialActivated', { purpose: purposeLabel(t, purpose) }),
    );
  };

  const copyToken = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      show(t('admin.acceleration.tokenCopied'));
    } catch (error: unknown) {
      showError(error);
    }
  };

  const confirmation = (() => {
    if (!confirmAction || !selected) return null;
    if (confirmAction.type === 'disable') {
      return {
        title: t('admin.acceleration.disableTitle'),
        description: t('admin.acceleration.disableDescription', { name: selected.name }),
        confirmText: t('admin.acceleration.disableConfirm'),
        busyKey: 'toggle',
      };
    }
    if (confirmAction.type === 'delete') {
      return {
        title: t('admin.acceleration.deleteTitle'),
        description: t('admin.acceleration.deleteConfirm', { name: selected.name }),
        confirmText: t('admin.acceleration.delete'),
        busyKey: 'delete',
      };
    }
    const purpose = purposeLabel(t, confirmAction.purpose);
    if (confirmAction.type === 'prepare') {
      return {
        title: t('admin.acceleration.prepareTitle', { purpose }),
        description: t('admin.acceleration.prepareDescription', { name: selected.name, purpose }),
        confirmText: t('admin.acceleration.prepareConfirm'),
        busyKey: `prepare:${confirmAction.purpose}`,
      };
    }
    return {
      title: t('admin.acceleration.activateTitle', { purpose }),
      description: t('admin.acceleration.activateDescription', { name: selected.name, purpose }),
      confirmText: t('admin.acceleration.activateConfirm'),
      busyKey: `activate:${confirmAction.purpose}`,
    };
  })();

  return (
    <div className="grid gap-7">
      <section>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-semibold">{t('admin.acceleration.heading')}</h2>
            <p className="mt-1 text-sm text-muted">{t('admin.acceleration.intro')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={() => setCreateOpen(true)} className={primaryButtonClass}>
              {t('admin.acceleration.newAcceleration')}
            </button>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              aria-busy={loading || undefined}
              className={secondaryButtonClass}
            >
              {loading ? t('admin.common.working') : t('admin.common.refresh')}
            </button>
          </div>
        </div>
        {loadFailed ? (
          <LoadError
            message={t('admin.acceleration.loadFailed')}
            retryLabel={t('common.retry')}
            onRetry={() => void load()}
          />
        ) : accelerations === null ? (
          <LoadingHint>{t('common.loading')}</LoadingHint>
        ) : accelerations.length === 0 ? (
          <div className="rounded-md border border-dashed border-hairline bg-panel px-4 py-10 text-center text-sm text-faint">
            <p>{t('admin.acceleration.empty')}</p>
            <button type="button" onClick={() => setCreateOpen(true)} className="mt-3 text-accent hover:underline">
              {t('admin.acceleration.createFirst')}
            </button>
          </div>
        ) : (
          <div className="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
            <nav
              aria-label={t('admin.acceleration.listLabel')}
              className="grid content-start gap-2 lg:sticky lg:top-4"
            >
              {accelerations.map((acceleration) => (
                <button
                  key={acceleration.id}
                  type="button"
                  aria-current={selectedId === acceleration.id ? 'true' : undefined}
                  onClick={() => setSelectedId(acceleration.id)}
                  className={`rounded-md border px-4 py-3 text-left transition-colors ${
                    selectedId === acceleration.id
                      ? 'border-accent bg-panel-2'
                      : 'border-hairline bg-panel hover:border-faint'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <StatusDot on={acceleration.enabled} />
                    <span className="truncate text-sm font-medium">{acceleration.name}</span>
                  </span>
                  <span className="mt-1 block truncate pl-3.5 font-mono text-xs text-faint">{acceleration.id}</span>
                  <span className="mt-1 block pl-3.5 text-xs text-muted">
                    {acceleration.enabled
                      ? t('admin.acceleration.statusEnabled')
                      : t('admin.acceleration.statusDisabled')}
                  </span>
                </button>
              ))}
            </nav>
            {selected && (
              <div className="min-w-0">
                <AccelerationDetail
                  acceleration={selected}
                  busy={busy}
                  statusExpanded={statusExpanded}
                  statusRegionId={statusRegionId}
                  onEdit={openEdit}
                  onEnable={toggle}
                  onDisable={() => setConfirmAction({ type: 'disable' })}
                  onDelete={() => setConfirmAction({ type: 'delete' })}
                  onStatus={() => setStatusExpanded((expanded) => !expanded)}
                  onPrepare={(purpose) => setConfirmAction({ type: 'prepare', purpose })}
                  onActivate={(purpose) => setConfirmAction({ type: 'activate', purpose })}
                  t={t}
                />
                {statusExpanded && (
                  <div id={statusRegionId}>
                    <AccelerationStatusPanel
                      key={selected.id}
                      target={selected}
                      t={t}
                      show={show}
                      showError={showError}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <Dialog open={createOpen} onOpenChange={setCreateOpen} title={t('admin.acceleration.createTitle')} size="wide">
        <AccelerationFormDialogBody
          draft={createDraft}
          withId
          submitting={busy === 'create'}
          submitLabel={t('admin.acceleration.create')}
          t={t}
          onChange={(patch) => setCreateDraft((current) => ({ ...current, ...patch }))}
          onSubmit={() => void create()}
          onCancel={() => setCreateOpen(false)}
        />
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen} title={t('admin.acceleration.editTitle')} size="wide">
        <AccelerationFormDialogBody
          draft={editDraft}
          withId={false}
          submitting={busy === 'edit'}
          submitLabel={t('admin.acceleration.save')}
          t={t}
          onChange={(patch) => setEditDraft((current) => ({ ...current, ...patch }))}
          onSubmit={() => void saveEdit()}
          onCancel={() => setEditOpen(false)}
        />
      </Dialog>

      <Dialog
        open={credentialReveal !== null}
        onOpenChange={(open) => {
          if (!open) setCredentialReveal(null);
        }}
        title={
          credentialReveal
            ? t('admin.acceleration.credentialTokenTitle', {
                purpose:
                  credentialReveal.tokens.length === 1
                    ? purposeLabel(t, credentialReveal.tokens[0].purpose)
                    : t('admin.acceleration.allCredentials'),
              })
            : ''
        }
      >
        {credentialReveal && (
          <div>
            {/* “只显示一次”是这个弹窗的全部重点，用邻近面板的琥珀色告警块，而不是灰色小字。 */}
            <p
              role="alert"
              className="rounded-md border border-[#D7A94A]/40 bg-[#D7A94A]/8 px-3 py-2.5 text-xs text-paper"
            >
              {t('admin.acceleration.tokenWarning')}
            </p>
            <div className="mt-4 grid gap-3">
              {credentialReveal.tokens.map(({ purpose, token }) => (
                <div key={purpose} className="rounded-md border border-hairline bg-panel px-3 py-3">
                  <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted">
                    <span>{purposeLabel(t, purpose)}</span>
                    <button
                      type="button"
                      onClick={() => void copyToken(token)}
                      aria-label={t('admin.acceleration.copyTokenFor', { purpose: purposeLabel(t, purpose) })}
                      className={accentLinkButtonClass}
                    >
                      {t('admin.acceleration.copyToken')}
                    </button>
                  </div>
                  <code className="block select-all break-all font-mono text-xs text-paper">{token}</code>
                </div>
              ))}
            </div>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={() => setCredentialReveal(null)} className={primaryButtonClass}>
                {t('admin.common.close')}
              </button>
            </div>
          </div>
        )}
      </Dialog>

      {confirmation && (
        <ConfirmDialog
          open={confirmAction !== null}
          onOpenChange={(open) => {
            if (!open) setConfirmAction(null);
          }}
          title={confirmation.title}
          description={confirmation.description}
          confirmText={busy === confirmation.busyKey ? t('admin.common.working') : confirmation.confirmText}
          cancelText={t('common.cancel')}
          danger
          onConfirm={() => {
            const action = confirmAction;
            setConfirmAction(null);
            if (!action) return;
            if (action.type === 'disable') toggle();
            if (action.type === 'delete') void deleteAcceleration();
            if (action.type === 'prepare') void prepareCredential(action.purpose);
            if (action.type === 'activate') void activateCredential(action.purpose);
          }}
        />
      )}
    </div>
  );
}

function AccelerationDetail({
  acceleration,
  statusExpanded,
  statusRegionId,
  busy,
  onEdit,
  onEnable,
  onDisable,
  onDelete,
  onStatus,
  onPrepare,
  onActivate,
  t,
}: {
  acceleration: AccelerationInfo;
  busy: string | null;
  statusExpanded: boolean;
  statusRegionId: string;
  onEdit: () => void;
  onEnable: () => void;
  onDisable: () => void;
  onDelete: () => void;
  onStatus: () => void;
  onPrepare: (purpose: CredentialPurpose) => void;
  onActivate: (purpose: CredentialPurpose) => void;
  t: Translate;
}) {
  const credentialFlags: Record<CredentialPurpose, { configured: boolean; pending: boolean }> = {
    publisher: {
      configured: acceleration.publisher_credential_configured,
      pending: acceleration.publisher_credential_pending,
    },
    delivery: {
      configured: acceleration.delivery_credential_configured,
      pending: acceleration.delivery_credential_pending,
    },
    backend: {
      configured: acceleration.backend_credential_configured,
      pending: acceleration.backend_credential_pending,
    },
  };
  const working = busy !== null;
  const credentialsIncomplete = purposeOrder.some((purpose) => !credentialFlags[purpose].configured);
  const deleteBlocked = acceleration.enabled;

  return (
    <div className="rounded-md border border-hairline bg-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-hairline pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-xl font-semibold">{acceleration.name}</h3>
            <Badge tone={acceleration.enabled ? 'accent' : 'muted'}>
              {acceleration.enabled ? t('admin.acceleration.statusEnabled') : t('admin.acceleration.statusDisabled')}
            </Badge>
            <Badge>{acceleration.kind}</Badge>
          </div>
          <div className="mt-1 font-mono text-xs text-faint">{acceleration.id}</div>
        </div>
        {/* 常规操作与不可逆操作用分隔线分开，视觉权重不再等同。 */}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onEdit} className={secondaryButtonClass}>
            {t('admin.acceleration.edit')}
          </button>
          <button
            type="button"
            onClick={acceleration.enabled ? onDisable : onEnable}
            disabled={working}
            aria-busy={busy === 'toggle' || undefined}
            className={secondaryButtonClass}
          >
            {busy === 'toggle'
              ? t('admin.common.working')
              : acceleration.enabled
                ? t('admin.acceleration.disable')
                : t('admin.acceleration.enable')}
          </button>
          <span aria-hidden className="mx-1 h-5 w-px bg-hairline" />
          <button
            type="button"
            onClick={onDelete}
            disabled={deleteBlocked || working}
            title={deleteBlocked ? t('admin.acceleration.disableBeforeDelete') : undefined}
            className={dangerButtonClass}
          >
            {busy === 'delete' ? t('admin.common.working') : t('admin.acceleration.delete')}
          </button>
        </div>
      </div>

      {/* 原来禁用态的删除按钮不给任何理由，i18n 里的 disableBeforeDelete 从未被渲染。 */}
      {deleteBlocked && (
        <p className="mt-3 text-xs text-faint">{t('admin.acceleration.disableBeforeDelete')}</p>
      )}
      {!acceleration.enabled && credentialsIncomplete && (
        <p className="mt-3 text-xs text-[#D7A94A]">{t('admin.acceleration.credentialIncomplete')}</p>
      )}

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <div>
          <h4 className="mb-3 text-xs font-medium uppercase tracking-[0.12em] text-faint">
            {t('admin.acceleration.endpointsAndLimits')}
          </h4>
          <dl className="grid gap-2 text-[13px]">
            <InfoRow label={t('admin.acceleration.controlUrlLabel')} value={acceleration.control_base_url} mono wrap />
            <InfoRow label={t('admin.acceleration.backendUrlLabel')} value={acceleration.backend_base_url} mono wrap />
            <InfoRow label={t('admin.acceleration.leaseTtl')} value={`${acceleration.lease_ttl_seconds}s`} mono />
            <InfoRow
              label={t('admin.acceleration.uploadRate')}
              value={formatBytes(acceleration.upload_rate_bytes_per_second)}
              mono
            />
            <InfoRow label={t('admin.acceleration.maxObject')} value={formatBytes(acceleration.max_object_bytes)} mono />
            <InfoRow
              label={t('admin.acceleration.storageBudget')}
              value={formatBytes(acceleration.storage_budget_bytes)}
              mono
            />
            <InfoRow
              label={t('admin.acceleration.storageWatermarks')}
              value={`${acceleration.storage_low_watermark_percent}% / ${acceleration.storage_high_watermark_percent}%`}
              mono
            />
            <InfoRow
              label={t('admin.acceleration.inventoryInterval')}
              value={`${acceleration.inventory_interval_seconds}s`}
              mono
            />
            <InfoRow
              label={t('admin.acceleration.inventoryStale')}
              value={`${acceleration.inventory_stale_after_seconds}s`}
              mono
            />
          </dl>
        </div>
        <div>
          <h4 className="mb-3 text-xs font-medium uppercase tracking-[0.12em] text-faint">
            {t('admin.acceleration.credential')}
          </h4>
          <div className="grid gap-2">
            {purposeOrder.map((purpose) => {
              const flags = credentialFlags[purpose];
              const label = purposeLabel(t, purpose);
              return (
                <div
                  key={purpose}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-hairline bg-panel-2 px-3 py-2"
                >
                  <StatusDot on={flags.configured} />
                  <span className="min-w-16 text-sm">{label}</span>
                  <span className={`text-xs ${flags.configured ? 'text-accent' : 'text-faint'}`}>
                    {flags.configured
                      ? t('admin.acceleration.credentialConfigured')
                      : t('admin.acceleration.credentialMissing')}
                  </span>
                  {flags.pending && <Badge tone="warn">{t('admin.acceleration.credentialPending')}</Badge>}
                  <div className="ml-auto flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => onPrepare(purpose)}
                      disabled={working}
                      aria-busy={busy === `prepare:${purpose}` || undefined}
                      aria-label={t('admin.acceleration.prepareCredentialFor', { purpose: label })}
                      className={linkButtonClass}
                    >
                      {busy === `prepare:${purpose}`
                        ? t('admin.common.working')
                        : t('admin.acceleration.prepareCredential')}
                    </button>
                    {flags.pending && (
                      <button
                        type="button"
                        onClick={() => onActivate(purpose)}
                        disabled={working}
                        aria-busy={busy === `activate:${purpose}` || undefined}
                        aria-label={t('admin.acceleration.activateCredentialFor', { purpose: label })}
                        className={accentLinkButtonClass}
                      >
                        {busy === `activate:${purpose}`
                          ? t('admin.common.working')
                          : t('admin.acceleration.activateCredential')}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-hairline pt-4 text-xs text-muted">
        <span>
          {t('admin.acceleration.publishOnReady')}：
          {acceleration.publish_on_cache_ready
            ? t('admin.acceleration.statusEnabled')
            : t('admin.acceleration.statusDisabled')}
        </span>
        <span className={healthy(acceleration) === false ? dangerTextClass : undefined}>
          {t('admin.acceleration.health')}：{healthLabel(acceleration, t)}
        </span>
        {acceleration.last_health_at !== undefined && acceleration.last_health_at > 0 && (
          <span className="font-mono text-faint tabular-nums">
            {t('admin.acceleration.lastHealthAt')} {formatDateTime(acceleration.last_health_at)}
          </span>
        )}
        <span className="font-mono text-faint tabular-nums">
          {t('admin.acceleration.updatedAt')} {formatDateTime(acceleration.updated_at)}
        </span>
        <button
          type="button"
          onClick={onStatus}
          aria-expanded={statusExpanded}
          aria-controls={statusRegionId}
          className="ml-auto text-xs text-muted hover:text-paper"
        >
          {statusExpanded ? t('admin.acceleration.collapseStatus') : t('admin.acceleration.expandStatus')}
        </button>
      </div>
      {/* 健康检查失败时服务端已经给了原因，原来只显示“异常”两个字。 */}
      {acceleration.health_error && (
        <p className={`mt-2 break-all text-xs ${dangerTextClass}`} role="alert">
          <span className="text-muted">{t('admin.acceleration.healthError')}：</span>
          {acceleration.health_error}
        </p>
      )}
    </div>
  );
}

function healthy(acceleration: AccelerationInfo): boolean | undefined {
  if (acceleration.control_healthy === undefined || acceleration.backend_healthy === undefined) return undefined;
  return acceleration.control_healthy && acceleration.backend_healthy;
}

function healthLabel(acceleration: AccelerationInfo, t: Translate): string {
  const state = healthy(acceleration);
  if (state === undefined) return t('admin.acceleration.unknown');
  return state ? t('admin.acceleration.healthy') : t('admin.acceleration.unhealthy');
}
