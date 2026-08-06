import { useEffect, useSyncExternalStore } from 'react';
import type { ConnStatus } from '../protocol/client';
import type { ProviderInfo, RoomInfo } from '../api/types';
import type { RoomState } from '../protocol/store';
import type { Identity } from '../protocol/types';
import { api, client, roomStore, session } from '../app/session';

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

// ---------- Provider 目录（能力报告/owner 标记） ----------

// owned 是按 Principal 逐请求计算的（spec §6.2.1），缓存必须按身份隔离：
// 换账号（退出再登录）时旧身份的 owned 绝不能复用。
let providersCache: ProviderInfo[] | null = null;
let providersFor: string | null = null;
let providersInflight = false;
const providerListeners = new Set<() => void>();

function ensureProviders(identityId: string): void {
  if (providersInflight) return;
  if (providersCache !== null && providersFor === identityId) return;
  providersInflight = true;
  api
    .listProviders()
    .then((list) => {
      providersCache = list;
      providersFor = identityId;
      for (const cb of providerListeners) cb();
    })
    .catch(() => {})
    .finally(() => {
      providersInflight = false;
    });
}

/**
 * Provider 目录（含 capabilities 与 owned）。null = 未就绪。
 * 同源多处消费（顶栏/搜索页/电台面板/首页）共享一份缓存。
 */
export function useProviders(): ProviderInfo[] | null {
  const identity = useIdentity();
  const identityId = identity?.id ?? null;
  useEffect(() => {
    if (identityId) ensureProviders(identityId);
  }, [identityId]);
  return useSyncExternalStore(
    (cb) => {
      providerListeners.add(cb);
      return () => {
        providerListeners.delete(cb);
      };
    },
    () => (identityId !== null && providersFor === identityId ? providersCache : null),
  );
}

// ---------- 房间目录（实况轮询） ----------

// 房间列表是短生命周期实况（listener_count/now_playing 5s 级变化），
// 且需要跨组件共享（底部栏切换器常显房间显示名，弹窗展开时才有完整列表）。
// 采用「订阅期间持续轮询」：有订阅者就 5s 刷新，无订阅者即停。
let roomsCache: RoomInfo[] | null = null;
let roomsTimer: number | null = null;
let roomsLoading = false;
const roomListeners = new Set<() => void>();

function refreshRooms(): void {
  if (roomsLoading) return;
  roomsLoading = true;
  api
    .listRooms()
    .then((list) => {
      roomsCache = list;
      for (const cb of roomListeners) cb();
    })
    .catch(() => {})
    .finally(() => {
      roomsLoading = false;
    });
}

function startRoomsPolling(): void {
  if (roomsTimer !== null) return;
  refreshRooms();
  roomsTimer = window.setInterval(refreshRooms, 5000);
}

function stopRoomsPolling(): void {
  if (roomsTimer === null) return;
  window.clearInterval(roomsTimer);
  roomsTimer = null;
}

/** 房间实况目录：有订阅者时 5s 轮询。null = 首次加载中。 */
export function useRooms(): RoomInfo[] | null {
  useEffect(() => {
    startRoomsPolling();
    return stopRoomsPolling;
  }, []);
  return useSyncExternalStore(
    (cb) => {
      roomListeners.add(cb);
      return () => {
        roomListeners.delete(cb);
      };
    },
    () => roomsCache,
  );
}
