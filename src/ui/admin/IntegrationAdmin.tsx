import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  IntegrationInfo,
  IntegrationScopeBinding,
  IntegrationScopeBindingInfo,
  IntegrationSubjectLink,
  IntegrationSubjectLinkInfo,
  PrincipalInfo,
  RoomControllerGrant,
  RoomInfo,
} from '../../api/types';
import { api } from '../../app/session';
import { Select } from '../primitives';
import { useToast } from '../toast';

const inputClass =
  'mt-1.5 w-full rounded-md border border-hairline bg-panel px-3 py-2 text-[13px] placeholder:text-faint';
const primaryButtonClass =
  'rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-on-accent hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40';
const secondaryButtonClass =
  'rounded-full border border-hairline px-4 py-1.5 text-[13px] text-muted hover:border-faint hover:text-paper disabled:cursor-not-allowed disabled:opacity-40';
const removeButtonClass =
  'rounded-full border border-hairline px-3 py-1 text-xs text-muted hover:border-[#D05A4E] hover:text-[#D05A4E] disabled:cursor-not-allowed disabled:opacity-40';

type BusyAction =
  | 'scope-save'
  | `scope-delete:${string}`
  | 'subject-save'
  | `subject-delete:${string}`
  | 'grant-save'
  | `grant-delete:${string}`;

export default function IntegrationAdmin() {
  const { t } = useTranslation();
  const { show, showError } = useToast();
  const [integrations, setIntegrations] = useState<IntegrationInfo[] | null>(null);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [principals, setPrincipals] = useState<PrincipalInfo[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [integrationId, setIntegrationId] = useState('');

  const [scopes, setScopes] = useState<IntegrationScopeBindingInfo[] | null>(null);
  const [subjects, setSubjects] = useState<IntegrationSubjectLinkInfo[] | null>(null);
  const [integrationDataFailed, setIntegrationDataFailed] = useState(false);
  const [integrationVersion, setIntegrationVersion] = useState(0);

  const [grantRoomId, setGrantRoomId] = useState('');
  const [grants, setGrants] = useState<RoomControllerGrant[] | null>(null);
  const [grantsFailed, setGrantsFailed] = useState(false);
  const [grantVersion, setGrantVersion] = useState(0);
  const [busy, setBusy] = useState<BusyAction | null>(null);

  const [scopeAdapterId, setScopeAdapterId] = useState('');
  const [scopeType, setScopeType] = useState('');
  const [scopeId, setScopeId] = useState('');
  const [scopeRoomId, setScopeRoomId] = useState('');

  const [subjectAdapterId, setSubjectAdapterId] = useState('');
  const [subjectScopeType, setSubjectScopeType] = useState('');
  const [subjectScopeId, setSubjectScopeId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [subjectPrincipalId, setSubjectPrincipalId] = useState('');
  const [grantPrincipalId, setGrantPrincipalId] = useState('');

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogFailed(false);
    try {
      const [nextIntegrations, nextRooms, nextPrincipals] = await Promise.all([
        api.listIntegrations(),
        api.listRooms(),
        api.listPrincipals(undefined, 100),
      ]);
      setIntegrations(nextIntegrations);
      setRooms(nextRooms);
      setPrincipals(nextPrincipals);
      setIntegrationId((current) =>
        nextIntegrations.some((item) => item.id === current) ? current : (nextIntegrations[0]?.id ?? ''),
      );
      setGrantRoomId((current) =>
        nextRooms.some((room) => room.id === current) ? current : (nextRooms[0]?.id ?? ''),
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
    setScopeRoomId((current) =>
      rooms.some((room) => room.id === current) ? current : (rooms[0]?.id ?? ''),
    );
    setGrantRoomId((current) =>
      rooms.some((room) => room.id === current) ? current : (rooms[0]?.id ?? ''),
    );
  }, [rooms]);

  useEffect(() => {
    setSubjectPrincipalId((current) =>
      principals.some((principal) => principal.id === current)
        ? current
        : (principals[0]?.id ?? ''),
    );
    setGrantPrincipalId((current) =>
      principals.some((principal) => principal.id === current)
        ? current
        : (principals[0]?.id ?? ''),
    );
  }, [principals]);

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
    Promise.all([
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

  useEffect(() => {
    if (!grantRoomId) {
      setGrants([]);
      setGrantsFailed(false);
      return;
    }

    let cancelled = false;
    setGrants(null);
    setGrantsFailed(false);
    api
      .listRoomGrants(grantRoomId)
      .then((nextGrants) => {
        if (!cancelled) setGrants(nextGrants);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setGrantsFailed(true);
        showError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [grantRoomId, grantVersion, showError]);

  const roomById = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms]);
  const principalById = useMemo(
    () => new Map(principals.map((principal) => [principal.id, principal])),
    [principals],
  );
  const roomOptions = rooms.map((room) => ({
    value: room.id,
    label: t('admin.integration.nameWithId', { name: room.name, id: room.id }),
  }));
  const principalOptions = principals.map((principal) => ({
    value: principal.id,
    label: t('admin.integration.principalOption', {
      name: principal.name,
      id: principal.id,
      state: principal.active ? '' : t('admin.integration.inactiveSuffix'),
    }),
  }));

  const runMutation = async (action: BusyAction, mutate: () => Promise<unknown>, success: string) => {
    if (busy !== null) return;
    setBusy(action);
    try {
      await mutate();
      show(success);
    } catch (error: unknown) {
      showError(error);
      throw error;
    } finally {
      setBusy(null);
    }
  };

  const saveScope = async () => {
    const binding: IntegrationScopeBinding = {
      adapter_id: scopeAdapterId.trim(),
      scope_type: scopeType.trim(),
      scope_id: scopeId.trim(),
      room_id: scopeRoomId,
    };
    if (!integrationId || Object.values(binding).some((value) => !value)) return;
    try {
      await runMutation(
        'scope-save',
        () => api.bindIntegrationScope(integrationId, binding),
        t('admin.integration.scopeSaved'),
      );
      setScopeId('');
      setIntegrationVersion((value) => value + 1);
    } catch {
      // Error toast is emitted by runMutation; keep the form intact for correction.
    }
  };

  const deleteScope = async (scope: IntegrationScopeBindingInfo) => {
    const binding: IntegrationScopeBinding = {
      adapter_id: scope.adapter_id,
      scope_type: scope.scope_type,
      scope_id: scope.scope_id,
      room_id: scope.room_id,
    };
    const action = `scope-delete:${scopeKey(scope)}` as const;
    try {
      await runMutation(
        action,
        () => api.unbindIntegrationScope(integrationId, binding),
        t('admin.integration.scopeRemoved'),
      );
      setIntegrationVersion((value) => value + 1);
    } catch {
      // Keep the row so the action can be retried.
    }
  };

  const saveSubject = async () => {
    const link: IntegrationSubjectLink = {
      adapter_id: subjectAdapterId.trim(),
      scope_type: subjectScopeType.trim(),
      scope_id: subjectScopeId.trim(),
      subject_id: subjectId.trim(),
      principal_id: subjectPrincipalId,
    };
    if (!integrationId || Object.values(link).some((value) => !value)) return;
    try {
      await runMutation(
        'subject-save',
        () => api.linkIntegrationSubject(integrationId, link),
        t('admin.integration.subjectSaved'),
      );
      setSubjectId('');
      setIntegrationVersion((value) => value + 1);
    } catch {
      // Error toast is emitted by runMutation; keep the form intact for correction.
    }
  };

  const deleteSubject = async (subject: IntegrationSubjectLinkInfo) => {
    const link: IntegrationSubjectLink = {
      adapter_id: subject.adapter_id,
      scope_type: subject.scope_type,
      scope_id: subject.scope_id,
      subject_id: subject.subject_id,
      principal_id: subject.principal_id,
    };
    const action = `subject-delete:${subjectKey(subject)}` as const;
    try {
      await runMutation(
        action,
        () => api.unlinkIntegrationSubject(integrationId, link),
        t('admin.integration.subjectRemoved'),
      );
      setIntegrationVersion((value) => value + 1);
    } catch {
      // Keep the row so the action can be retried.
    }
  };

  const saveGrant = async () => {
    if (!grantRoomId || !grantPrincipalId) return;
    try {
      await runMutation(
        'grant-save',
        () => api.grantRoomController(grantRoomId, grantPrincipalId),
        t('admin.integration.grantSaved'),
      );
      setGrantVersion((value) => value + 1);
    } catch {
      // Error toast is emitted by runMutation; keep the selection intact.
    }
  };

  const deleteGrant = async (grant: RoomControllerGrant) => {
    const action = `grant-delete:${grant.principal_id}` as const;
    try {
      await runMutation(
        action,
        () => api.revokeRoomController(grant.room_id, grant.principal_id),
        t('admin.integration.grantRemoved'),
      );
      setGrantVersion((value) => value + 1);
    } catch {
      // Keep the row so the action can be retried.
    }
  };

  return (
    <section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold">{t('admin.integration.heading')}</h2>
          <p className="mt-1 text-sm text-muted">{t('admin.integration.intro')}</p>
        </div>
        <button
          type="button"
          onClick={() => void loadCatalog()}
          disabled={catalogLoading}
          className={secondaryButtonClass}
        >
          {catalogLoading ? t('admin.common.working') : t('admin.common.refresh')}
        </button>
      </div>

      {catalogFailed ? (
        <LoadError message={t('admin.integration.catalogFailed')} onRetry={() => void loadCatalog()} />
      ) : integrations === null ? (
        <LoadingState />
      ) : integrations.length === 0 ? (
        <EmptyState>{t('admin.integration.integrationEmpty')}</EmptyState>
      ) : (
        <div className="grid gap-5">
          <section className="rounded-md border border-hairline bg-panel px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs text-muted">{t('admin.integration.integration')}</label>
              <Select
                value={integrationId}
                onValueChange={setIntegrationId}
                options={integrations.map((integration) => ({
                  value: integration.id,
                  label: integration.id,
                }))}
                className="min-w-56"
              />
              <span className="font-mono text-[11px] text-faint">{integrationId}</span>
            </div>
          </section>

          {integrationDataFailed ? (
            <LoadError
              message={t('admin.integration.mappingFailed')}
              onRetry={() => setIntegrationVersion((value) => value + 1)}
            />
          ) : scopes === null || subjects === null ? (
            <LoadingState />
          ) : (
            <>
              <ScopePanel
                scopes={scopes}
                rooms={rooms}
                roomById={roomById}
                adapterId={scopeAdapterId}
                scopeType={scopeType}
                scopeId={scopeId}
                roomId={scopeRoomId}
                roomOptions={roomOptions}
                busy={busy}
                onAdapterIdChange={setScopeAdapterId}
                onScopeTypeChange={setScopeType}
                onScopeIdChange={setScopeId}
                onRoomIdChange={setScopeRoomId}
                onSave={() => void saveScope()}
                onDelete={(scope) => void deleteScope(scope)}
              />

              <SubjectPanel
                subjects={subjects}
                principalById={principalById}
                adapterId={subjectAdapterId}
                scopeType={subjectScopeType}
                scopeId={subjectScopeId}
                subjectId={subjectId}
                principalId={subjectPrincipalId}
                principalOptions={principalOptions}
                busy={busy}
                onAdapterIdChange={setSubjectAdapterId}
                onScopeTypeChange={setSubjectScopeType}
                onScopeIdChange={setSubjectScopeId}
                onSubjectIdChange={setSubjectId}
                onPrincipalIdChange={setSubjectPrincipalId}
                onSave={() => void saveSubject()}
                onDelete={(subject) => void deleteSubject(subject)}
              />
            </>
          )}

          <GrantPanel
            rooms={rooms}
            roomId={grantRoomId}
            roomOptions={roomOptions}
            grants={grants}
            failed={grantsFailed}
            principalById={principalById}
            principalId={grantPrincipalId}
            principalOptions={principalOptions}
            busy={busy}
            onRoomIdChange={setGrantRoomId}
            onPrincipalIdChange={setGrantPrincipalId}
            onSave={() => void saveGrant()}
            onDelete={(grant) => void deleteGrant(grant)}
            onRetry={() => setGrantVersion((value) => value + 1)}
          />
        </div>
      )}
    </section>
  );
}

function ScopePanel(props: {
  scopes: IntegrationScopeBindingInfo[];
  rooms: RoomInfo[];
  roomById: Map<string, RoomInfo>;
  adapterId: string;
  scopeType: string;
  scopeId: string;
  roomId: string;
  roomOptions: Array<{ value: string; label: string }>;
  busy: BusyAction | null;
  onAdapterIdChange: (value: string) => void;
  onScopeTypeChange: (value: string) => void;
  onScopeIdChange: (value: string) => void;
  onRoomIdChange: (value: string) => void;
  onSave: () => void;
  onDelete: (scope: IntegrationScopeBindingInfo) => void;
}) {
  const { t } = useTranslation();
  const canSave =
    props.adapterId.trim() !== '' &&
    props.scopeType.trim() !== '' &&
    props.scopeId.trim() !== '' &&
    props.roomId !== '';

  return (
    <ManagementPanel title={t('admin.integration.scopeTitle')} intro={t('admin.integration.scopeIntro')}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          props.onSave();
        }}
        className="grid gap-3 border-b border-hairline px-4 py-4 lg:grid-cols-[1fr_1fr_1fr_1.35fr_auto] lg:items-end"
      >
        <TextField
          label={t('admin.integration.adapterId')}
          value={props.adapterId}
          onChange={props.onAdapterIdChange}
          placeholder={t('admin.integration.adapterPlaceholder')}
        />
        <TextField
          label={t('admin.integration.scopeType')}
          value={props.scopeType}
          onChange={props.onScopeTypeChange}
          placeholder={t('admin.integration.scopeTypePlaceholder')}
        />
        <TextField
          label={t('admin.integration.scopeId')}
          value={props.scopeId}
          onChange={props.onScopeIdChange}
          placeholder={t('admin.integration.scopeIdPlaceholder')}
        />
        <div>
          <span className="block text-xs text-muted">{t('admin.integration.room')}</span>
          {props.rooms.length > 0 ? (
            <Select
              value={props.roomId}
              onValueChange={props.onRoomIdChange}
              options={props.roomOptions}
              className="mt-1.5 w-full"
            />
          ) : (
            <p className="mt-1.5 rounded-md border border-dashed border-hairline px-3 py-2 text-xs text-faint">
              {t('admin.integration.roomsEmpty')}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={!canSave || props.busy !== null}
          className={primaryButtonClass}
        >
          {props.busy === 'scope-save'
            ? t('admin.integration.saving')
            : t('admin.integration.bindScope')}
        </button>
      </form>

      {props.scopes.length === 0 ? (
        <InlineEmpty>{t('admin.integration.scopeEmpty')}</InlineEmpty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
            <thead className="bg-panel-2 text-[11px] uppercase tracking-[0.08em] text-faint">
              <tr>
                <th className="px-4 py-2 font-medium">{t('admin.integration.adapter')}</th>
                <th className="px-4 py-2 font-medium">{t('admin.integration.externalScope')}</th>
                <th className="px-4 py-2 font-medium">{t('admin.integration.defaultRoom')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('admin.integration.action')}</th>
              </tr>
            </thead>
            <tbody>
              {props.scopes.map((scope) => {
                const room = props.roomById.get(scope.room_id);
                const action = `scope-delete:${scopeKey(scope)}` as const;
                return (
                  <tr key={scopeKey(scope)} className="border-t border-hairline">
                    <td className="px-4 py-3 font-mono text-xs text-muted">{scope.adapter_id}</td>
                    <td className="px-4 py-3">
                      <div>{scope.scope_type}</div>
                      <div className="font-mono text-[11px] text-faint">{scope.scope_id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{room?.name ?? t('admin.integration.unknownRoom')}</div>
                      <div className="font-mono text-[11px] text-faint">{scope.room_id}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        disabled={props.busy !== null}
                        onClick={() => props.onDelete(scope)}
                        className={removeButtonClass}
                      >
                        {props.busy === action
                          ? t('admin.integration.removing')
                          : t('admin.integration.unbind')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </ManagementPanel>
  );
}

function SubjectPanel(props: {
  subjects: IntegrationSubjectLinkInfo[];
  principalById: Map<string, PrincipalInfo>;
  adapterId: string;
  scopeType: string;
  scopeId: string;
  subjectId: string;
  principalId: string;
  principalOptions: Array<{ value: string; label: string }>;
  busy: BusyAction | null;
  onAdapterIdChange: (value: string) => void;
  onScopeTypeChange: (value: string) => void;
  onScopeIdChange: (value: string) => void;
  onSubjectIdChange: (value: string) => void;
  onPrincipalIdChange: (value: string) => void;
  onSave: () => void;
  onDelete: (subject: IntegrationSubjectLinkInfo) => void;
}) {
  const { t } = useTranslation();
  const canSave =
    props.adapterId.trim() !== '' &&
    props.scopeType.trim() !== '' &&
    props.scopeId.trim() !== '' &&
    props.subjectId.trim() !== '' &&
    props.principalId !== '';

  return (
    <ManagementPanel title={t('admin.integration.subjectTitle')} intro={t('admin.integration.subjectIntro')}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          props.onSave();
        }}
        className="grid gap-3 border-b border-hairline px-4 py-4 lg:grid-cols-[1fr_1fr_1fr_1fr_1.45fr_auto] lg:items-end"
      >
        <TextField
          label={t('admin.integration.adapterId')}
          value={props.adapterId}
          onChange={props.onAdapterIdChange}
          placeholder={t('admin.integration.adapterPlaceholder')}
        />
        <TextField
          label={t('admin.integration.scopeType')}
          value={props.scopeType}
          onChange={props.onScopeTypeChange}
          placeholder={t('admin.integration.scopeTypePlaceholder')}
        />
        <TextField
          label={t('admin.integration.scopeId')}
          value={props.scopeId}
          onChange={props.onScopeIdChange}
          placeholder={t('admin.integration.scopeIdPlaceholder')}
        />
        <TextField
          label={t('admin.integration.subjectId')}
          value={props.subjectId}
          onChange={props.onSubjectIdChange}
          placeholder={t('admin.integration.subjectIdPlaceholder')}
        />
        <div>
          <span className="block text-xs text-muted">{t('admin.integration.principal')}</span>
          {props.principalOptions.length > 0 ? (
            <Select
              value={props.principalId}
              onValueChange={props.onPrincipalIdChange}
              options={props.principalOptions}
              className="mt-1.5 w-full"
            />
          ) : (
            <p className="mt-1.5 rounded-md border border-dashed border-hairline px-3 py-2 text-xs text-faint">
              {t('admin.integration.principalsEmpty')}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={!canSave || props.busy !== null}
          className={primaryButtonClass}
        >
          {props.busy === 'subject-save'
            ? t('admin.integration.saving')
            : t('admin.integration.linkSubject')}
        </button>
      </form>

      {props.subjects.length === 0 ? (
        <InlineEmpty>{t('admin.integration.subjectEmpty')}</InlineEmpty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left text-[13px]">
            <thead className="bg-panel-2 text-[11px] uppercase tracking-[0.08em] text-faint">
              <tr>
                <th className="px-4 py-2 font-medium">{t('admin.integration.adapter')}</th>
                <th className="px-4 py-2 font-medium">{t('admin.integration.externalScope')}</th>
                <th className="px-4 py-2 font-medium">{t('admin.integration.externalSubject')}</th>
                <th className="px-4 py-2 font-medium">{t('admin.integration.principal')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('admin.integration.action')}</th>
              </tr>
            </thead>
            <tbody>
              {props.subjects.map((subject) => {
                const principal = props.principalById.get(subject.principal_id);
                const action = `subject-delete:${subjectKey(subject)}` as const;
                return (
                  <tr key={subjectKey(subject)} className="border-t border-hairline">
                    <td className="px-4 py-3 font-mono text-xs text-muted">{subject.adapter_id}</td>
                    <td className="px-4 py-3">
                      <div>{subject.scope_type}</div>
                      <div className="font-mono text-[11px] text-faint">{subject.scope_id}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">{subject.subject_id}</td>
                    <td className="px-4 py-3">
                      <div>{principal?.name ?? t('admin.integration.unknownPrincipal')}</div>
                      <div className="font-mono text-[11px] text-faint">{subject.principal_id}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        disabled={props.busy !== null}
                        onClick={() => props.onDelete(subject)}
                        className={removeButtonClass}
                      >
                        {props.busy === action
                          ? t('admin.integration.removing')
                          : t('admin.integration.unlink')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </ManagementPanel>
  );
}

function GrantPanel(props: {
  rooms: RoomInfo[];
  roomId: string;
  roomOptions: Array<{ value: string; label: string }>;
  grants: RoomControllerGrant[] | null;
  failed: boolean;
  principalById: Map<string, PrincipalInfo>;
  principalId: string;
  principalOptions: Array<{ value: string; label: string }>;
  busy: BusyAction | null;
  onRoomIdChange: (value: string) => void;
  onPrincipalIdChange: (value: string) => void;
  onSave: () => void;
  onDelete: (grant: RoomControllerGrant) => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();

  return (
    <ManagementPanel title={t('admin.integration.grantTitle')} intro={t('admin.integration.grantIntro')}>
      {props.rooms.length === 0 ? (
        <InlineEmpty>{t('admin.integration.roomsEmpty')}</InlineEmpty>
      ) : (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              props.onSave();
            }}
            className="grid gap-3 border-b border-hairline px-4 py-4 md:grid-cols-[1fr_1.25fr_auto] md:items-end"
          >
            <div>
              <span className="block text-xs text-muted">{t('admin.integration.room')}</span>
              <Select
                value={props.roomId}
                onValueChange={props.onRoomIdChange}
                options={props.roomOptions}
                className="mt-1.5 w-full"
              />
            </div>
            <div>
              <span className="block text-xs text-muted">{t('admin.integration.principal')}</span>
              {props.principalOptions.length > 0 ? (
                <Select
                  value={props.principalId}
                  onValueChange={props.onPrincipalIdChange}
                  options={props.principalOptions}
                  className="mt-1.5 w-full"
                />
              ) : (
                <p className="mt-1.5 rounded-md border border-dashed border-hairline px-3 py-2 text-xs text-faint">
                  {t('admin.integration.principalsEmpty')}
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={!props.roomId || !props.principalId || props.busy !== null}
              className={primaryButtonClass}
            >
              {props.busy === 'grant-save'
                ? t('admin.integration.saving')
                : t('admin.integration.grantController')}
            </button>
          </form>

          {props.failed ? (
            <div className="p-4">
              <LoadError message={t('admin.integration.grantsFailed')} onRetry={props.onRetry} compact />
            </div>
          ) : props.grants === null ? (
            <LoadingState compact />
          ) : props.grants.length === 0 ? (
            <InlineEmpty>{t('admin.integration.grantEmpty')}</InlineEmpty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-left text-[13px]">
                <thead className="bg-panel-2 text-[11px] uppercase tracking-[0.08em] text-faint">
                  <tr>
                    <th className="px-4 py-2 font-medium">{t('admin.integration.principal')}</th>
                    <th className="px-4 py-2 font-medium">{t('admin.integration.capability')}</th>
                    <th className="px-4 py-2 text-right font-medium">{t('admin.integration.action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {props.grants.map((grant) => {
                    const principal = props.principalById.get(grant.principal_id);
                    const action = `grant-delete:${grant.principal_id}` as const;
                    return (
                      <tr key={`${grant.room_id}:${grant.principal_id}`} className="border-t border-hairline">
                        <td className="px-4 py-3">
                          <div>{principal?.name ?? t('admin.integration.unknownPrincipal')}</div>
                          <div className="font-mono text-[11px] text-faint">{grant.principal_id}</div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-accent">
                          {t('admin.integration.controller')}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            disabled={props.busy !== null}
                            onClick={() => props.onDelete(grant)}
                            className={removeButtonClass}
                          >
                            {props.busy === action
                              ? t('admin.integration.removing')
                              : t('admin.integration.revoke')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </ManagementPanel>
  );
}

function ManagementPanel(props: { title: string; intro: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-md border border-hairline bg-panel">
      <header className="border-b border-hairline px-4 py-3.5">
        <h3 className="font-display text-lg font-semibold">{props.title}</h3>
        <p className="mt-0.5 text-xs text-muted">{props.intro}</p>
      </header>
      {props.children}
    </section>
  );
}

function TextField(props: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-xs text-muted">
      {props.label}
      <input
        required
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        className={inputClass}
      />
    </label>
  );
}

function LoadingState({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  return <p className={compact ? 'py-7 text-center text-sm text-faint' : 'py-10 text-center text-sm text-faint'}>{t('common.loading')}</p>;
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-hairline bg-panel px-4 py-10 text-center text-sm text-faint">
      {children}
    </p>
  );
}

function InlineEmpty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-faint">{children}</p>;
}

function LoadError(props: { message: string; onRetry: () => void; compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      className={`${props.compact ? '' : 'rounded-md border border-dashed border-hairline bg-panel'} px-4 py-8 text-center text-sm text-muted`}
      role="alert"
    >
      <p>{props.message}</p>
      <button type="button" onClick={props.onRetry} className="mt-2 text-accent hover:underline">
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
