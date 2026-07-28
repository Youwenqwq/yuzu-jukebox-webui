/** Per-room access credentials remembered for re-entry after leaving the room. */
export interface RoomCredentialStore {
  get(roomId: string): string | undefined;
  set(roomId: string, password: string): void;
  clear(roomId: string): void;
  clearAll(): void;
}

export const ROOM_CREDENTIALS_KEY = 'yuzu-room-credentials';

type CredentialMap = Record<string, string>;

function readMap(storage: Storage): CredentialMap {
  const raw = storage.getItem(ROOM_CREDENTIALS_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: CredentialMap = {};
    for (const [roomId, password] of Object.entries(parsed)) {
      if (typeof password === 'string') out[roomId] = password;
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(storage: Storage, map: CredentialMap): void {
  if (Object.keys(map).length === 0) {
    storage.removeItem(ROOM_CREDENTIALS_KEY);
    return;
  }
  storage.setItem(ROOM_CREDENTIALS_KEY, JSON.stringify(map));
}

/**
 * Room access credentials (static password or rotating code) live in localStorage
 * so leaving a room and re-entering does not re-prompt until the credential fails.
 */
export function createRoomCredentialStore(
  storage: Storage = globalThis.localStorage,
): RoomCredentialStore {
  return {
    get(roomId: string): string | undefined {
      const value = readMap(storage)[roomId];
      return value === undefined ? undefined : value;
    },
    set(roomId: string, password: string): void {
      const map = readMap(storage);
      map[roomId] = password;
      writeMap(storage, map);
    },
    clear(roomId: string): void {
      const map = readMap(storage);
      if (!(roomId in map)) return;
      delete map[roomId];
      writeMap(storage, map);
    },
    clearAll(): void {
      storage.removeItem(ROOM_CREDENTIALS_KEY);
    },
  };
}
