import { describe, expect, it } from 'vitest';
import { createSessionTokenStore } from './token';

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
  it('persists and clears the session token under the stable key', () => {
    const storage = new MemoryStorage();
    const tokens = createSessionTokenStore(storage);

    expect(tokens.get()).toBeNull();
    tokens.set('session-token');
    expect(storage.getItem('yuzu-session')).toBe('session-token');
    expect(tokens.get()).toBe('session-token');
    tokens.clear();
    expect(tokens.get()).toBeNull();
  });
});
