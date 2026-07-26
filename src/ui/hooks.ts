import { useSyncExternalStore } from 'react';
import type { ConnStatus } from '../protocol/client';
import type { RoomState } from '../protocol/store';
import type { Identity } from '../protocol/types';
import { client, roomStore, session } from '../app/session';

export function useRoomState(): RoomState {
  return useSyncExternalStore(
    (cb) => roomStore.subscribe(cb),
    () => roomStore.getState(),
  );
}

export function useConnStatus(): ConnStatus {
  return useSyncExternalStore(
    (cb) => client.onStatusChange(cb),
    () => client.status,
  );
}

export function useIdentity(): Identity | null {
  return useSyncExternalStore(
    (cb) => session.subscribe(cb),
    () => session.getIdentity(),
  );
}
