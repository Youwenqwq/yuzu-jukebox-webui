export interface TokenStore {
  get(): string | null;
  set(token: string): void;
  clear(): void;
}

const SESSION_TOKEN_KEY = 'yuzu-session';

export function createSessionTokenStore(storage: Storage = globalThis.sessionStorage): TokenStore {
  return {
    get: () => storage.getItem(SESSION_TOKEN_KEY),
    set: (token) => storage.setItem(SESSION_TOKEN_KEY, token),
    clear: () => storage.removeItem(SESSION_TOKEN_KEY),
  };
}
