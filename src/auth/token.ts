export interface TokenStore {
  get(): string | null;
  set(token: string): void;
  clear(): void;
}

export const SESSION_TOKEN_KEY = 'yuzu-session';

/** One-shot move from the old per-tab sessionStorage key. */
function migrateFromSessionStorage(storage: Storage): void {
  if (storage !== globalThis.localStorage) return;
  if (storage.getItem(SESSION_TOKEN_KEY) !== null) return;
  const legacy = globalThis.sessionStorage.getItem(SESSION_TOKEN_KEY);
  if (legacy === null) return;
  storage.setItem(SESSION_TOKEN_KEY, legacy);
  globalThis.sessionStorage.removeItem(SESSION_TOKEN_KEY);
}

/** Session token lives in localStorage so sibling tabs share auth after boot. */
export function createSessionTokenStore(storage: Storage = globalThis.localStorage): TokenStore {
  migrateFromSessionStorage(storage);
  return {
    get: () => storage.getItem(SESSION_TOKEN_KEY),
    set: (token) => storage.setItem(SESSION_TOKEN_KEY, token),
    clear: () => storage.removeItem(SESSION_TOKEN_KEY),
  };
}
