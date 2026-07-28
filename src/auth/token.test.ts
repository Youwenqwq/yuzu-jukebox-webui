import { afterEach, describe, expect, it, vi } from 'vitest';
import { SESSION_TOKEN_KEY, createSessionTokenStore } from './token';

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();

  get length(): number {
    return this.#values.size;
  }

  clear(): void {
    this.#values.clear();
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }
}

describe('createSessionTokenStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists and clears the session token under the stable key', () => {
    const storage = new MemoryStorage();
    const tokens = createSessionTokenStore(storage);

    expect(tokens.get()).toBeNull();
    tokens.set('session-token');
    expect(storage.getItem(SESSION_TOKEN_KEY)).toBe('session-token');
    expect(tokens.get()).toBe('session-token');
    tokens.clear();
    expect(tokens.get()).toBeNull();
  });

  it('defaults to localStorage and migrates a legacy sessionStorage token once', () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    session.setItem(SESSION_TOKEN_KEY, 'legacy-token');
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);

    const tokens = createSessionTokenStore();

    expect(tokens.get()).toBe('legacy-token');
    expect(local.getItem(SESSION_TOKEN_KEY)).toBe('legacy-token');
    expect(session.getItem(SESSION_TOKEN_KEY)).toBeNull();
  });

  it('keeps an existing localStorage token over a legacy sessionStorage value', () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    local.setItem(SESSION_TOKEN_KEY, 'current-token');
    session.setItem(SESSION_TOKEN_KEY, 'legacy-token');
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);

    expect(createSessionTokenStore().get()).toBe('current-token');
    expect(session.getItem(SESSION_TOKEN_KEY)).toBe('legacy-token');
  });
});
