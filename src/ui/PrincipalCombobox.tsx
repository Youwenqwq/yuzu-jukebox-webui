import { Popover as PopoverPrimitive } from 'radix-ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PrincipalInfo } from '../api/types';
import { api } from '../app/session';
const PRINCIPAL_KIND_KEYS: Record<string, string> = {
  guest: 'admin.integration.principalKindGuest',
  password: 'admin.integration.principalKindPassword',
  oidc: 'admin.integration.principalKindOidc',
};


export function PrincipalCombobox({
  value,
  onValueChange,
  label,
  placeholder,
  disabled = false,
}: {
  value: PrincipalInfo | null;
  onValueChange: (principal: PrincipalInfo | null) => void;
  label: string;
  placeholder: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PrincipalInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [searchVersion, setSearchVersion] = useState(0);

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (!open || normalizedQuery === '') {
      setResults([]);
      setLoading(false);
      setFailed(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setFailed(false);
      void api
        .listPrincipals(normalizedQuery, 20)
        .then((principals) => {
          if (!cancelled) setResults(principals);
        })
        .catch(() => {
          if (cancelled) return;
          setResults([]);
          setFailed(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, searchVersion]);

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery('');
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={label}
          className="mt-1.5 flex w-full items-center justify-between gap-3 rounded-md border border-hairline bg-panel px-3 py-2 text-left text-[13px] hover:border-faint disabled:cursor-not-allowed disabled:opacity-40"
        >
          {value ? (
            <span className="min-w-0">
              <span className="block truncate text-paper">{value.name}</span>
              <span className="block truncate font-mono text-[10px] text-faint">{value.id}</span>
            </span>
          ) : (
            <span className="truncate text-faint">{placeholder}</span>
          )}
          <span aria-hidden="true" className="shrink-0 text-[10px] text-faint">
            ▼
          </span>
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={5}
          className="pop-enter z-50 w-[var(--radix-popover-trigger-width)] max-h-[var(--radix-popover-content-available-height)] overflow-hidden rounded-md border border-hairline bg-panel-2 shadow-xl"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="border-b border-hairline p-2">
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('admin.integration.principalSearchPlaceholder')}
              aria-label={t('admin.integration.principalSearch')}
              className="w-full rounded-md border border-hairline bg-panel px-3 py-2 text-[13px] placeholder:text-faint"
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1" role="listbox" aria-label={label}>
            {query.trim() === '' ? (
              <p className="px-3 py-6 text-center text-xs text-faint">
                {t('admin.integration.principalSearchHint')}
              </p>
            ) : loading ? (
              <p className="px-3 py-6 text-center text-xs text-muted">{t('common.loading')}</p>
            ) : failed ? (
              <div className="px-3 py-5 text-center text-xs text-muted">
                <p>{t('admin.integration.principalSearchFailed')}</p>
                <button
                  type="button"
                  onClick={() => setSearchVersion((version) => version + 1)}
                  className="mt-2 text-accent hover:underline"
                >
                  {t('common.retry')}
                </button>
              </div>
            ) : results.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-faint">
                {t('admin.integration.principalSearchEmpty')}
              </p>
            ) : (
              results.map((principal) => (
                <button
                  key={principal.id}
                  type="button"
                  role="option"
                  aria-selected={value?.id === principal.id}
                  disabled={!principal.active}
                  onClick={() => {
                    onValueChange(principal);
                    setOpen(false);
                    setQuery('');
                  }}
                  className="flex w-full items-center gap-3 rounded px-3 py-2 text-left hover:bg-panel disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-paper">{principal.name}</span>
                    <span className="block truncate font-mono text-[10px] text-faint">{principal.id}</span>
                  </span>
                  <span className="shrink-0 text-[10px] text-muted">
                    {t(
                      PRINCIPAL_KIND_KEYS[principal.kind] ??
                        'admin.integration.principalKindUnknown',
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
