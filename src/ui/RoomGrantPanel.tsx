import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PrincipalInfo, RoomControllerGrant } from '../api/types';
import { api } from '../app/session';
import { PrincipalCombobox } from './PrincipalCombobox';
import { useToast } from './toast';

export function RoomGrantPanel({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  const { show, showError } = useToast();
  const [grants, setGrants] = useState<RoomControllerGrant[] | null>(null);
  const [principalById, setPrincipalById] = useState<Map<string, PrincipalInfo>>(() => new Map());
  const [selectedPrincipal, setSelectedPrincipal] = useState<PrincipalInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<'grant' | string | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    setGrants(null);
    try {
      const nextGrants = await api.listRoomGrants(roomId);
      const resolved = await Promise.all(
        [...new Set(nextGrants.map((grant) => grant.principal_id))].map(async (principalId) => {
          try {
            const matches = await api.listPrincipals(principalId, 10);
            return matches.find((principal) => principal.id === principalId) ?? null;
          } catch {
            return null;
          }
        }),
      );
      setPrincipalById((current) => {
        const next = new Map(current);
        for (const principal of resolved) {
          if (principal) next.set(principal.id, principal);
        }
        return next;
      });
      setGrants(nextGrants);
    } catch (error: unknown) {
      setFailed(true);
      setGrants([]);
      showError(error);
    }
  }, [roomId, showError]);

  useEffect(() => {
    void load();
  }, [load]);

  const grant = async () => {
    if (!selectedPrincipal || busy !== null) return;
    setBusy('grant');
    try {
      await api.grantRoomController(roomId, selectedPrincipal.id);
      setPrincipalById((current) => new Map(current).set(selectedPrincipal.id, selectedPrincipal));
      setSelectedPrincipal(null);
      show(t('roomAdmin.grantSaved'));
      await load();
    } catch (error: unknown) {
      showError(error);
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (grantToRemove: RoomControllerGrant) => {
    if (busy !== null) return;
    setBusy(grantToRemove.principal_id);
    try {
      await api.revokeRoomController(roomId, grantToRemove.principal_id);
      show(t('roomAdmin.grantRemoved'));
      await load();
    } catch (error: unknown) {
      showError(error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mt-4 overflow-hidden rounded-md border border-hairline bg-panel-2">
      <header className="border-b border-hairline px-4 py-3.5">
        <h2 className="font-display text-lg font-semibold">{t('roomAdmin.grantsTitle')}</h2>
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void grant();
        }}
        className="grid gap-3 border-b border-hairline px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
      >
        <div>
          <span className="block text-xs text-muted">{t('roomAdmin.grantPrincipal')}</span>
          <PrincipalCombobox
            value={selectedPrincipal}
            onValueChange={(principal) => {
              setSelectedPrincipal(principal);
              if (!principal) return;
              setPrincipalById((current) => new Map(current).set(principal.id, principal));
            }}
            label={t('roomAdmin.grantPrincipal')}
            placeholder={t('roomAdmin.grantPrincipalPlaceholder')}
            disabled={busy !== null}
          />
        </div>
        <button
          type="submit"
          disabled={!selectedPrincipal || busy !== null}
          className="rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-on-accent hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy === 'grant' ? t('roomAdmin.grantSaving') : t('roomAdmin.grantController')}
        </button>
      </form>

      {failed ? (
        <div className="px-4 py-8 text-center text-sm text-muted" role="alert">
          <p>{t('roomAdmin.grantsFailed')}</p>
          <button type="button" onClick={() => void load()} className="mt-2 text-accent hover:underline">
            {t('common.retry')}
          </button>
        </div>
      ) : grants === null ? (
        <p className="px-4 py-8 text-center text-sm text-faint">{t('common.loading')}</p>
      ) : grants.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-faint">{t('roomAdmin.grantsEmpty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[400px] border-collapse text-left text-[13px]">
            <thead className="font-mono text-[10px] tracking-[0.1em] text-faint">
              <tr className="border-b border-hairline">
                <th className="px-4 py-2 font-normal">{t('roomAdmin.grantPrincipal')}</th>
                <th className="px-4 py-2 text-right font-normal">{t('roomAdmin.grantAction')}</th>
              </tr>
            </thead>
            <tbody>
              {grants.map((roomGrant) => {
                const principal = principalById.get(roomGrant.principal_id);
                return (
                  <tr key={roomGrant.principal_id} className="border-b border-hairline last:border-b-0">
                    <td className="px-4 py-3">
                      <div>{principal?.name ?? roomGrant.principal_id}</div>
                      {principal && (
                        <div className="font-mono text-[10px] text-faint">{roomGrant.principal_id}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void revoke(roomGrant)}
                        className="rounded-full border border-hairline px-3 py-1 text-xs text-muted hover:border-[#D05A4E] hover:text-[#D05A4E] disabled:opacity-40"
                      >
                        {busy === roomGrant.principal_id
                          ? t('roomAdmin.grantRemoving')
                          : t('roomAdmin.grantRevoke')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
