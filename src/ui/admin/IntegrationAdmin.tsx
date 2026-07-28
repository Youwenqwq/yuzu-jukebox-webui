import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  IntegrationCredentialResult,
  IntegrationInfo,
  IntegrationScopeBinding,
  IntegrationScopeBindingInfo,
  IntegrationSubjectLink,
  IntegrationSubjectLinkInfo,
  RoomInfo,
} from '../../api/types';
import { api } from '../../app/session';
import { ConfirmDialog, Dialog } from '../primitives';
import { useToast } from '../toast';
import { IntegrationScopePanel, IntegrationSubjectPanel } from './IntegrationMappingPanels';

const inputClass =
  'mt-1.5 w-full rounded-md border border-hairline bg-panel px-3 py-2 text-[13px] placeholder:text-faint';
const primaryButtonClass =
  'rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-on-accent hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40';
const secondaryButtonClass =
  'rounded-full border border-hairline px-4 py-1.5 text-[13px] text-muted hover:border-faint hover:text-paper disabled:cursor-not-allowed disabled:opacity-40';
const dangerButtonClass =
  'rounded-full border border-hairline px-4 py-1.5 text-[13px] text-muted hover:border-[#D05A4E] hover:text-[#D05A4E] disabled:cursor-not-allowed disabled:opacity-40';

type BusyAction =
  | 'integration-create'
  | 'integration-rename'
  | 'integration-toggle'
  | 'integration-rotate'
  | 'integration-delete'
  | 'scope-save'
  | `scope-delete:${string}`
  | 'subject-save'
  | `subject-delete:${string}`;
type ConfirmAction = 'disable' | 'rotate' | 'delete';

export default function IntegrationAdmin() {
  const { t } = useTranslation();
  const { show, showError } = useToast();
  const [integrations, setIntegrations] = useState<IntegrationInfo[] | null>(null);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [integrationId, setIntegrationId] = useState('');
  const [integrationFilter, setIntegrationFilter] = useState('');
  const [integrationName, setIntegrationName] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [newIntegrationId, setNewIntegrationId] = useState('');
  const [newIntegrationName, setNewIntegrationName] = useState('');
  const [revealedToken, setRevealedToken] = useState<{ id: string; token: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [busy, setBusy] = useState<BusyAction | null>(null);

  const [scopes, setScopes] = useState<IntegrationScopeBindingInfo[] | null>(null);
  const [subjects, setSubjects] = useState<IntegrationSubjectLinkInfo[] | null>(null);
  const [integrationDataFailed, setIntegrationDataFailed] = useState(false);
  const [integrationVersion, setIntegrationVersion] = useState(0);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogFailed(false);
    try {
      const [nextIntegrations, nextRooms] = await Promise.all([
        api.listIntegrations(),
        api.listRooms(),
      ]);
      setIntegrations(nextIntegrations);
      setRooms(nextRooms);
      setIntegrationId((current) =>
        nextIntegrations.some((item) => item.id === current)
          ? current
          : (nextIntegrations[0]?.id ?? ''),
      );
    } catch (error: unknown) {
      setCatalogFailed(true);
      showError(error);
    } finally {
      setCatalogLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (!integrationId) {
      setScopes([]);
      setSubjects([]);
      setIntegrationDataFailed(false);
      return;
    }

    let cancelled = false;
    setScopes(null);
    setSubjects(null);
    setIntegrationDataFailed(false);
    void Promise.all([
      api.listIntegrationScopes(integrationId),
      api.listIntegrationSubjects(integrationId),
    ])
      .then(([nextScopes, nextSubjects]) => {
        if (cancelled) return;
        setScopes(nextScopes);
        setSubjects(nextSubjects);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setIntegrationDataFailed(true);
        showError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [integrationId, integrationVersion, showError]);

  const selectedIntegration = useMemo(
    () => integrations?.find((integration) => integration.id === integrationId) ?? null,
    [integrationId, integrations],
  );
  const filteredIntegrations = useMemo(() => {
    const query = integrationFilter.trim().toLocaleLowerCase();
    if (!integrations || query === '') return integrations ?? [];
    return integrations.filter(
      (integration) =>
        integration.id.toLocaleLowerCase().includes(query) ||
        integration.name.toLocaleLowerCase().includes(query),
    );
  }, [integrationFilter, integrations]);

  useEffect(() => {
    setIntegrationName(selectedIntegration?.name ?? '');
    setRevealedToken((current) => (current?.id === integrationId ? current : null));
  }, [integrationId, selectedIntegration]);

  const runMutation = async (
    action: BusyAction,
    mutate: () => Promise<unknown>,
    successMessage: string,
  ): Promise<boolean> => {
    if (busy !== null) return false;
    setBusy(action);
    try {
      await mutate();
      show(successMessage);
      return true;
    } catch (error: unknown) {
      showError(error);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const createIntegration = async () => {
    const id = newIntegrationId.trim();
    const name = newIntegrationName.trim();
    if (!id || !name) return;

    let result: IntegrationCredentialResult | undefined;
    const created = await runMutation(
      'integration-create',
      async () => {
        result = await api.createIntegration(id, name);
      },
      t('admin.integration.created'),
    );
    if (!created || !result) return;

    setCreateOpen(false);
    setNewIntegrationId('');
    setNewIntegrationName('');
    await loadCatalog();
    setIntegrationId(result.integration.id);
    setRevealedToken({ id: result.integration.id, token: result.token });
  };

  const renameIntegration = async () => {
    const name = integrationName.trim();
    if (!selectedIntegration || !name || name === selectedIntegration.name) return;
    const renamed = await runMutation(
      'integration-rename',
      () => api.updateIntegration(selectedIntegration.id, { name }),
      t('admin.integration.renamed'),
    );
    if (renamed) await loadCatalog();
  };

  const toggleIntegration = async () => {
    if (!selectedIntegration) return;
    const toggled = await runMutation(
      'integration-toggle',
      () => api.updateIntegration(selectedIntegration.id, { active: !selectedIntegration.active }),
      selectedIntegration.active ? t('admin.integration.disabled') : t('admin.integration.enabled'),
    );
    if (toggled) await loadCatalog();
  };

  const rotateIntegrationToken = async () => {
    if (!selectedIntegration) return;
    let result: IntegrationCredentialResult | undefined;
    const rotated = await runMutation(
      'integration-rotate',
      async () => {
        result = await api.rotateIntegrationToken(selectedIntegration.id);
      },
      t('admin.integration.rotated'),
    );
    if (!rotated || !result) return;
    setRevealedToken({ id: result.integration.id, token: result.token });
    await loadCatalog();
  };

  const deleteIntegration = async () => {
    if (!selectedIntegration) return;
    const deleted = await runMutation(
      'integration-delete',
      () => api.deleteIntegration(selectedIntegration.id),
      t('admin.integration.deleted'),
    );
    if (!deleted) return;
    setRevealedToken(null);
    setIntegrationId('');
    await loadCatalog();
  };

  const saveScope = async (binding: IntegrationScopeBinding): Promise<boolean> => {
    if (!selectedIntegration) return false;
    const saved = await runMutation(
      'scope-save',
      () => api.bindIntegrationScope(selectedIntegration.id, binding),
      t('admin.integration.scopeSaved'),
    );
    if (saved) setIntegrationVersion((version) => version + 1);
    return saved;
  };

  const deleteScope = async (scope: IntegrationScopeBindingInfo) => {
    if (!selectedIntegration) return;
    const binding: IntegrationScopeBinding = {
      adapter_id: scope.adapter_id,
      scope_type: scope.scope_type,
      scope_id: scope.scope_id,
      room_id: scope.room_id,
    };
    const deleted = await runMutation(
      `scope-delete:${scopeKey(scope)}`,
      () => api.unbindIntegrationScope(selectedIntegration.id, binding),
      t('admin.integration.scopeRemoved'),
    );
    if (deleted) setIntegrationVersion((version) => version + 1);
  };

  const saveSubject = async (link: IntegrationSubjectLink): Promise<boolean> => {
    if (!selectedIntegration) return false;
    const saved = await runMutation(
      'subject-save',
      () => api.linkIntegrationSubject(selectedIntegration.id, link),
      t('admin.integration.subjectSaved'),
    );
    if (saved) setIntegrationVersion((version) => version + 1);
    return saved;
  };

  const deleteSubject = async (subject: IntegrationSubjectLinkInfo) => {
    if (!selectedIntegration) return;
    const link: IntegrationSubjectLink = {
      adapter_id: subject.adapter_id,
      scope_type: subject.scope_type,
      scope_id: subject.scope_id,
      subject_id: subject.subject_id,
      principal_id: subject.principal_id,
    };
    const deleted = await runMutation(
      `subject-delete:${subjectKey(subject)}`,
      () => api.unlinkIntegrationSubject(selectedIntegration.id, link),
      t('admin.integration.subjectRemoved'),
    );
    if (deleted) setIntegrationVersion((version) => version + 1);
  };

  const confirmation =
    selectedIntegration && confirmAction
      ? {
          title: t(`admin.integration.${confirmAction}DialogTitle`),
          description: t(`admin.integration.${confirmAction}DialogDescription`, {
            name: selectedIntegration.name,
          }),
          confirmText: t(`admin.integration.${confirmAction}DialogConfirm`),
        }
      : null;

  return (
    <section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold">{t('admin.integration.heading')}</h2>
          <p className="mt-1 text-sm text-muted">{t('admin.integration.intro')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setCreateOpen(true)} className={primaryButtonClass}>
            {t('admin.integration.newIntegration')}
          </button>
          <button
            type="button"
            onClick={() => void loadCatalog()}
            disabled={catalogLoading}
            className={secondaryButtonClass}
          >
            {catalogLoading ? t('admin.common.working') : t('admin.common.refresh')}
          </button>
        </div>
      </div>

      {catalogFailed ? (
        <LoadError message={t('admin.integration.catalogFailed')} onRetry={() => void loadCatalog()} />
      ) : integrations === null ? (
        <LoadingState />
      ) : integrations.length === 0 ? (
        <EmptyState>
          <p>{t('admin.integration.integrationEmpty')}</p>
          <button type="button" onClick={() => setCreateOpen(true)} className="mt-3 text-accent">
            {t('admin.integration.createFirst')}
          </button>
        </EmptyState>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="overflow-hidden rounded-md border border-hairline bg-panel lg:sticky lg:top-4">
            <div className="border-b border-hairline p-3">
              <label className="block text-[11px] font-medium uppercase tracking-[0.1em] text-faint">
                {t('admin.integration.integrationList')}
                <input
                  type="search"
                  value={integrationFilter}
                  onChange={(event) => setIntegrationFilter(event.target.value)}
                  placeholder={t('admin.integration.integrationSearchPlaceholder')}
                  className={inputClass}
                />
              </label>
            </div>
            <nav className="max-h-[65vh] overflow-y-auto p-1.5" aria-label={t('admin.integration.integrationList')}>
              {filteredIntegrations.length === 0 ? (
                <p className="px-3 py-8 text-center text-xs text-faint">
                  {t('admin.integration.integrationSearchEmpty')}
                </p>
              ) : (
                filteredIntegrations.map((integration) => (
                  <button
                    key={integration.id}
                    type="button"
                    aria-current={integration.id === integrationId ? 'true' : undefined}
                    onClick={() => setIntegrationId(integration.id)}
                    className={`mb-1 w-full rounded px-3 py-2.5 text-left transition-colors last:mb-0 ${
                      integration.id === integrationId
                        ? 'bg-panel-2 text-paper'
                        : 'text-muted hover:bg-panel-2 hover:text-paper'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          integration.active ? 'bg-[#71B99A]' : 'bg-faint'
                        }`}
                      />
                      <span className="truncate text-[13px] font-medium">{integration.name}</span>
                    </span>
                    <span className="mt-1 block truncate pl-3.5 font-mono text-[10px] text-faint">
                      {integration.id}
                    </span>
                  </button>
                ))
              )}
            </nav>
          </aside>

          {selectedIntegration && (
            <div className="min-w-0">

              <IntegrationLifecycleCard
                integration={selectedIntegration}
                editName={integrationName}
                revealedToken={revealedToken}
                busy={busy}
                onEditNameChange={setIntegrationName}
                onRename={() => void renameIntegration()}
                onToggle={() => {
                  if (selectedIntegration.active) setConfirmAction('disable');
                  else void toggleIntegration();
                }}
                onRotate={() => setConfirmAction('rotate')}
                onDelete={() => setConfirmAction('delete')}
                onCopyToken={() => {
                  if (!revealedToken) return;
                  void navigator.clipboard
                    .writeText(revealedToken.token)
                    .then(() => show(t('admin.integration.tokenCopied')))
                    .catch(showError);
                }}
              />

              <div className="mt-5 grid gap-5">
                {integrationDataFailed ? (
                  <LoadError
                    message={t('admin.integration.mappingFailed')}
                    onRetry={() => setIntegrationVersion((version) => version + 1)}
                  />
                ) : scopes === null || subjects === null ? (
                  <LoadingState />
                ) : (
                  <>
                    <IntegrationScopePanel
                      scopes={scopes}
                      rooms={rooms}
                      busy={busy}
                      onSave={saveScope}
                      onDelete={(scope) => void deleteScope(scope)}
                    />
                    <IntegrationSubjectPanel
                      integrationId={selectedIntegration.id}
                      subjects={subjects}
                      scopes={scopes}
                      busy={busy}
                      onSave={saveSubject}
                      onDelete={(subject) => void deleteSubject(subject)}
                    />
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen} title={t('admin.integration.createDialogTitle')}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void createIntegration();
          }}
        >
          <label className="block text-xs text-muted">
            {t('admin.integration.integrationId')}
            <input
              required
              value={newIntegrationId}
              onChange={(event) => setNewIntegrationId(event.target.value)}
              placeholder={t('admin.integration.integrationIdPlaceholder')}
              className={inputClass}
            />
          </label>
          <label className="mt-4 block text-xs text-muted">
            {t('admin.integration.integrationName')}
            <input
              required
              value={newIntegrationName}
              onChange={(event) => setNewIntegrationName(event.target.value)}
              placeholder={t('admin.integration.integrationNamePlaceholder')}
              className={inputClass}
            />
          </label>
          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              disabled={busy === 'integration-create'}
              onClick={() => setCreateOpen(false)}
              className={secondaryButtonClass}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={
                busy === 'integration-create' ||
                !newIntegrationId.trim() ||
                !newIntegrationName.trim()
              }
              className={primaryButtonClass}
            >
              {busy === 'integration-create' ? t('admin.common.working') : t('admin.integration.create')}
            </button>
          </div>
        </form>
      </Dialog>

      {confirmation && (
        <ConfirmDialog
          open={confirmAction !== null}
          onOpenChange={(open) => {
            if (!open) setConfirmAction(null);
          }}
          title={confirmation.title}
          description={confirmation.description}
          confirmText={confirmation.confirmText}
          cancelText={t('common.cancel')}
          danger
          onConfirm={() => {
            const action = confirmAction;
            setConfirmAction(null);
            if (action === 'disable') void toggleIntegration();
            if (action === 'rotate') void rotateIntegrationToken();
            if (action === 'delete') void deleteIntegration();
          }}
        />
      )}
    </section>
  );
}

function IntegrationLifecycleCard({
  integration,
  editName,
  revealedToken,
  busy,
  onEditNameChange,
  onRename,
  onToggle,
  onRotate,
  onDelete,
  onCopyToken,
}: {
  integration: IntegrationInfo;
  editName: string;
  revealedToken: { id: string; token: string } | null;
  busy: BusyAction | null;
  onEditNameChange: (value: string) => void;
  onRename: () => void;
  onToggle: () => void;
  onRotate: () => void;
  onDelete: () => void;
  onCopyToken: () => void;
}) {
  const { t } = useTranslation();
  const working = busy !== null;

  return (
    <section className="rounded-md border border-hairline bg-panel p-5">
      <div className="mb-4">
        <h3 className="font-display text-xl font-semibold">{t('admin.integration.lifecycleHeading')}</h3>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          onRename();
        }}
        className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
      >
        <label className="block text-xs text-muted">
          {t('admin.integration.integrationName')}
          <input
            required
            value={editName}
            onChange={(event) => onEditNameChange(event.target.value)}
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          disabled={working || !editName.trim() || editName.trim() === integration.name}
          className={secondaryButtonClass}
        >
          {busy === 'integration-rename' ? t('admin.common.working') : t('admin.integration.rename')}
        </button>
      </form>

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-hairline pt-4">
        <button type="button" onClick={onToggle} disabled={working} className={secondaryButtonClass}>
          {busy === 'integration-toggle'
            ? t('admin.common.working')
            : integration.active
              ? t('admin.integration.disable')
              : t('admin.integration.enable')}
        </button>
        <button type="button" onClick={onRotate} disabled={working} className={secondaryButtonClass}>
          {busy === 'integration-rotate' ? t('admin.common.working') : t('admin.integration.rotateToken')}
        </button>
        <button type="button" onClick={onDelete} disabled={working} className={dangerButtonClass}>
          {busy === 'integration-delete' ? t('admin.common.working') : t('admin.integration.delete')}
        </button>
      </div>

      {revealedToken ? (
        <div className="mt-4 rounded-md border border-[#D7A94A]/40 bg-[#D7A94A]/8 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-paper">
                {t('admin.integration.tokenOnce', { id: revealedToken.id })}
              </p>
              <p className="mt-1 text-xs text-muted">{t('admin.integration.tokenWarning')}</p>
            </div>
            <button type="button" onClick={onCopyToken} className={secondaryButtonClass}>
              {t('admin.integration.copyToken')}
            </button>
          </div>
          <code className="mt-3 block select-all break-all rounded bg-canvas px-3 py-2 text-xs text-paper">
            {revealedToken.token}
          </code>
        </div>
      ) : null}
    </section>
  );
}

function LoadingState() {
  const { t } = useTranslation();
  return <p className="py-10 text-center text-sm text-faint">{t('common.loading')}</p>;
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-hairline bg-panel px-4 py-10 text-center text-sm text-faint">
      {children}
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border border-dashed border-hairline bg-panel px-4 py-8 text-center text-sm text-muted" role="alert">
      <p>{message}</p>
      <button type="button" onClick={onRetry} className="mt-2 text-accent hover:underline">
        {t('common.retry')}
      </button>
    </div>
  );
}

function scopeKey(scope: IntegrationScopeBindingInfo): string {
  return [scope.adapter_id, scope.scope_type, scope.scope_id].join('\u0000');
}

function subjectKey(subject: IntegrationSubjectLinkInfo): string {
  return [subject.adapter_id, subject.scope_type, subject.scope_id, subject.subject_id].join('\u0000');
}
