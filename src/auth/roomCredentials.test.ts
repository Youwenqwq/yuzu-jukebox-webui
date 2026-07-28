import { describe, expect, it } from 'vitest';
import { ROOM_CREDENTIALS_KEY, createRoomCredentialStore } from './roomCredentials';

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

describe('createRoomCredentialStore', () => {
  it('persists credentials per room and supports selective clear', () => {
    const storage = new MemoryStorage();
    const credentials = createRoomCredentialStore(storage);

    expect(credentials.get('lobby')).toBeUndefined();
    credentials.set('lobby', '7M2K-Q9TR-W4HX');
    credentials.set('vip', 'secret');
    expect(credentials.get('lobby')).toBe('7M2K-Q9TR-W4HX');
    expect(credentials.get('vip')).toBe('secret');
    expect(JSON.parse(storage.getItem(ROOM_CREDENTIALS_KEY) ?? '{}')).toEqual({
      lobby: '7M2K-Q9TR-W4HX',
      vip: 'secret',
    });

    credentials.clear('lobby');
    expect(credentials.get('lobby')).toBeUndefined();
    expect(credentials.get('vip')).toBe('secret');

    credentials.clearAll();
    expect(credentials.get('vip')).toBeUndefined();
    expect(storage.getItem(ROOM_CREDENTIALS_KEY)).toBeNull();
  });

  it('stores empty credentials for open rooms and ignores corrupt payloads', () => {
    const storage = new MemoryStorage();
    storage.setItem(ROOM_CREDENTIALS_KEY, '{not-json');
    const credentials = createRoomCredentialStore(storage);

    expect(credentials.get('lobby')).toBeUndefined();
    credentials.set('lobby', '');
    expect(credentials.get('lobby')).toBe('');
    expect(JSON.parse(storage.getItem(ROOM_CREDENTIALS_KEY) ?? '{}')).toEqual({ lobby: '' });
  });
});
