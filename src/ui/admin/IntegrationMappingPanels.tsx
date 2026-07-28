import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  IntegrationScopeBinding,
  IntegrationScopeBindingInfo,
  IntegrationSubjectLink,
  IntegrationSubjectLinkInfo,
  PrincipalInfo,
  RoomInfo,
} from '../../api/types';
import { api } from '../../app/session';
import { PrincipalCombobox } from '../PrincipalCombobox';
import { Select } from '../primitives';

const inputClass =
  'mt-1.5 w-full rounded-md border border-hairline bg-panel px-3 py-2 text-[13px] placeholder:text-faint';
const primaryButtonClass =
  'rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-on-accent hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40';
const removeButtonClass =
  'rounded-full border border-hairline px-3 py-1 text-xs text-muted hover:border-[#D05A4E] hover:text-[#D05A4E] disabled:cursor-not-allowed disabled:opacity-40';
const MANUAL_SCOPE = '__manual__';

export function IntegrationScopePanel({
  scopes,
  rooms,
  busy,
  onSave,
  onDelete,
}: {
  scopes: IntegrationScopeBindingInfo[];
  rooms: RoomInfo[];
  busy: string | null;
  onSave: (binding: IntegrationScopeBinding) => Promise<boolean>;
  onDelete: (scope: IntegrationScopeBindingInfo) => void;
}) {
  const { t } = useTranslation();
  const [adapterId, setAdapterId] = useState('');
  const [scopeType, setScopeType] = useState('');
  const [scopeId, setScopeId] = useState('');
  const [roomId, setRoomId] = useState('');
  const roomById = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms]);
  const roomOptions = rooms.map((room) => ({
    value: room.id,
    label: t('admin.integration.nameWithId', { name: room.name, id: room.id }),
  }));
  const canSave =
    adapterId.trim() !== '' && scopeType.trim() !== '' && scopeId.trim() !== '' && roomId !== '';

  useEffect(() => {
    if (rooms.some((room) => room.id === roomId)) return;
    setRoomId('');
  }, [roomId, rooms]);

  return (
    <ManagementPanel title={t('admin.integration.scopeTitle')} intro={t('admin.integration.scopeIntro')}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSave) return;
          const binding: IntegrationScopeBinding = {
            adapter_id: adapterId.trim(),
            scope_type: scopeType.trim(),
            scope_id: scopeId.trim(),
            room_id: roomId,
          };
          void onSave(binding).then((saved) => {
            if (saved) setScopeId('');
          });
        }}
        className="grid gap-3 border-b border-hairline px-4 py-4 lg:grid-cols-[1fr_1fr_1fr_1.35fr_auto] lg:items-end"
      >
        <TextField
          label={t('admin.integration.adapterId')}
          value={adapterId}
          onChange={setAdapterId}
          placeholder={t('admin.integration.adapterPlaceholder')}
        />
        <TextField
          label={t('admin.integration.scopeType')}
          value={scopeType}
          onChange={setScopeType}
          placeholder={t('admin.integration.scopeTypePlaceholder')}
        />
        <TextField
          label={t('admin.integration.scopeId')}
          value={scopeId}
          onChange={setScopeId}
          placeholder={t('admin.integration.scopeIdPlaceholder')}
        />
        <div>
          <span className="block text-xs text-muted">{t('admin.integration.room')}</span>
          {rooms.length > 0 ? (
            <Select
              value={roomId}
              onValueChange={setRoomId}
              options={roomOptions}
              ariaLabel={t('admin.integration.room')}
              placeholder={t('admin.integration.roomPlaceholder')}
              className="mt-1.5 w-full"
            />
          ) : (
            <p className="mt-1.5 rounded-md border border-dashed border-hairline px-3 py-2 text-xs text-faint">
              {t('admin.integration.roomsEmpty')}
            </p>
          )}
        </div>
        <button type="submit" disabled={!canSave || busy !== null} className={primaryButtonClass}>
          {busy === 'scope-save' ? t('admin.integration.saving') : t('admin.integration.bindScope')}
        </button>
      </form>

      {scopes.length === 0 ? (
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
              {scopes.map((scope) => {
                const room = roomById.get(scope.room_id);
                const action = `scope-delete:${scopeKey(scope)}`;
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
                        disabled={busy !== null}
                        onClick={() => onDelete(scope)}
                        className={removeButtonClass}
                      >
                        {busy === action ? t('admin.integration.removing') : t('admin.integration.unbind')}
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

export function IntegrationSubjectPanel({
  integrationId,
  subjects,
  scopes,
  busy,
  onSave,
  onDelete,
}: {
  integrationId: string;
  subjects: IntegrationSubjectLinkInfo[];
  scopes: IntegrationScopeBindingInfo[];
  busy: string | null;
  onSave: (link: IntegrationSubjectLink) => Promise<boolean>;
  onDelete: (subject: IntegrationSubjectLinkInfo) => void;
}) {
  const { t } = useTranslation();
  const [scopeSelection, setScopeSelection] = useState('');
  const [adapterId, setAdapterId] = useState('');
  const [scopeType, setScopeType] = useState('');
  const [scopeId, setScopeId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [principal, setPrincipal] = useState<PrincipalInfo | null>(null);
  const [principalById, setPrincipalById] = useState<Map<string, PrincipalInfo>>(() => new Map());

  const uniqueScopes = useMemo(() => {
    const seen = new Set<string>();
    return scopes.filter((scope) => {
      const key = scopeKey(scope);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [scopes]);
  const scopeOptions = [
    ...uniqueScopes.map((scope) => ({
      value: scopeKey(scope),
      label: `${scope.adapter_id} · ${scope.scope_type}:${scope.scope_id}`,
    })),
    { value: MANUAL_SCOPE, label: t('admin.integration.scopeManual') },
  ];
  const canSave =
    adapterId.trim() !== '' &&
    scopeType.trim() !== '' &&
    scopeId.trim() !== '' &&
    subjectId.trim() !== '' &&
    principal !== null;

  useEffect(() => {
    setScopeSelection('');
    setAdapterId('');
    setScopeType('');
    setScopeId('');
    setSubjectId('');
    setPrincipal(null);
    setPrincipalById(new Map());
  }, [integrationId]);

  useEffect(() => {
    const missingIds = [...new Set(subjects.map((subject) => subject.principal_id))].filter(
      (principalId) => !principalById.has(principalId),
    );
    if (missingIds.length === 0) return;

    let cancelled = false;
    void Promise.all(
      missingIds.map(async (principalId) => {
        try {
          const matches = await api.listPrincipals(principalId, 10);
          return matches.find((candidate) => candidate.id === principalId) ?? null;
        } catch {
          return null;
        }
      }),
    ).then((resolved) => {
      if (cancelled) return;
      setPrincipalById((current) => {
        const next = new Map(current);
        for (const item of resolved) {
          if (item) next.set(item.id, item);
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [principalById, subjects]);

  return (
    <ManagementPanel title={t('admin.integration.subjectTitle')} intro={t('admin.integration.subjectIntro')}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSave || !principal) return;
          const link: IntegrationSubjectLink = {
            adapter_id: adapterId.trim(),
            scope_type: scopeType.trim(),
            scope_id: scopeId.trim(),
            subject_id: subjectId.trim(),
            principal_id: principal.id,
          };
          void onSave(link).then((saved) => {
            if (!saved) return;
            setSubjectId('');
            setPrincipal(null);
          });
        }}
        className="border-b border-hairline px-4 py-4"
      >
        <div>
          <div>
            <span className="block text-xs text-muted">{t('admin.integration.externalScope')}</span>
            <Select
              value={scopeSelection}
              onValueChange={(value) => {
                setScopeSelection(value);
                if (value === MANUAL_SCOPE) {
                  setAdapterId('');
                  setScopeType('');
                  setScopeId('');
                  return;
                }
                const selectedScope = uniqueScopes.find((scope) => scopeKey(scope) === value);
                if (!selectedScope) return;
                setAdapterId(selectedScope.adapter_id);
                setScopeType(selectedScope.scope_type);
                setScopeId(selectedScope.scope_id);
              }}
              options={scopeOptions}
              ariaLabel={t('admin.integration.externalScope')}
              placeholder={t('admin.integration.scopeChoicePlaceholder')}
              className="mt-1.5 w-full"
            />
          </div>
        </div>

        {scopeSelection === MANUAL_SCOPE && (
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <TextField
              label={t('admin.integration.adapterId')}
              value={adapterId}
              onChange={setAdapterId}
              placeholder={t('admin.integration.adapterPlaceholder')}
            />
            <TextField
              label={t('admin.integration.scopeType')}
              value={scopeType}
              onChange={setScopeType}
              placeholder={t('admin.integration.scopeTypePlaceholder')}
            />
            <TextField
              label={t('admin.integration.scopeId')}
              value={scopeId}
              onChange={setScopeId}
              placeholder={t('admin.integration.scopeIdPlaceholder')}
            />
          </div>
        )}

        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto] md:items-end">
          <TextField
            label={t('admin.integration.subjectId')}
            value={subjectId}
            onChange={setSubjectId}
            placeholder={t('admin.integration.subjectIdPlaceholder')}
          />
          <div>
            <span className="block text-xs text-muted">{t('admin.integration.principal')}</span>
            <PrincipalCombobox
              value={principal}
              onValueChange={(nextPrincipal) => {
                setPrincipal(nextPrincipal);
                if (!nextPrincipal) return;
                setPrincipalById((current) => new Map(current).set(nextPrincipal.id, nextPrincipal));
              }}
              label={t('admin.integration.principal')}
              placeholder={t('admin.integration.principalChoicePlaceholder')}
            />
          </div>
          <button type="submit" disabled={!canSave || busy !== null} className={primaryButtonClass}>
            {busy === 'subject-save' ? t('admin.integration.saving') : t('admin.integration.linkSubject')}
          </button>
        </div>
      </form>

      {subjects.length === 0 ? (
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
              {subjects.map((subject) => {
                const linkedPrincipal = principalById.get(subject.principal_id);
                const action = `subject-delete:${subjectKey(subject)}`;
                return (
                  <tr key={subjectKey(subject)} className="border-t border-hairline">
                    <td className="px-4 py-3 font-mono text-xs text-muted">{subject.adapter_id}</td>
                    <td className="px-4 py-3">
                      <div>{subject.scope_type}</div>
                      <div className="font-mono text-[11px] text-faint">{subject.scope_id}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">{subject.subject_id}</td>
                    <td className="px-4 py-3">
                      <div>{linkedPrincipal?.name ?? subject.principal_id}</div>
                      {linkedPrincipal && (
                        <div className="font-mono text-[11px] text-faint">{subject.principal_id}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => onDelete(subject)}
                        className={removeButtonClass}
                      >
                        {busy === action ? t('admin.integration.removing') : t('admin.integration.unlink')}
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

function ManagementPanel({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-md border border-hairline bg-panel">
      <header className="border-b border-hairline px-4 py-3.5">
        <h3 className="font-display text-lg font-semibold">{title}</h3>
        <p className="mt-0.5 text-xs text-muted">{intro}</p>
      </header>
      {children}
    </section>
  );
}

function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-xs text-muted">
      {label}
      <input
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={inputClass}
      />
    </label>
  );
}

function InlineEmpty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-faint">{children}</p>;
}

function scopeKey(scope: Pick<IntegrationScopeBindingInfo, 'adapter_id' | 'scope_type' | 'scope_id'>): string {
  return [scope.adapter_id, scope.scope_type, scope.scope_id].join('\u0000');
}

function subjectKey(subject: IntegrationSubjectLinkInfo): string {
  return [subject.adapter_id, subject.scope_type, subject.scope_id, subject.subject_id].join('\u0000');
}
