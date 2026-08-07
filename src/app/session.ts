/**
 * 组合根：内核单例 + 会话生命周期。
 * UI 只经本模块触碰内核，不自行构造内核对象。
 */
import { ApiClient } from '../api/client';
import { createOidcFlow } from '../auth/oidc';
import { createSessionTokenStore } from '../auth/token';
import { createRoomCredentialStore } from '../auth/roomCredentials';
import { YuzuClient } from '../protocol/client';
import { SessionStore } from '../protocol/store';
import type { Identity } from '../protocol/types';
import { createNativeMediaSync, yuzuMediaPlugin } from './nativemedia';
import type { NativeMediaSync } from './nativemedia';

export const tokenStore = createSessionTokenStore();
export const roomCredentials = createRoomCredentialStore();
export const api = new ApiClient(() => tokenStore.get(), {
  onUnauthorized: () => tokenStore.clear(),
});
export const client = new YuzuClient();
export const roomStore = new SessionStore(client);
export const oidcFlow = createOidcFlow();

/** 原生媒体会话同步单例：serverNow 时钟基准（与 UI 同钟，避免设备/服务器
 *  时钟偏差让锁屏歌词/进度偏移）；浏览器为 null（no-op）。 */
export const nativeMediaSync: NativeMediaSync | null = yuzuMediaPlugin
  ? createNativeMediaSync(yuzuMediaPlugin, () => client.clock.serverNow())
  : null;

// ---------- 可观察身份 ----------
let identity: Identity | null = null;
const identityListeners = new Set<() => void>();

function setIdentity(next: Identity | null): void {
  identity = next;
  for (const cb of identityListeners) cb();
}

// ---------- 断线重连后的会话恢复（spec §9.4：重走 auth → join） ----------
let lastRoom: { id: string; password?: string } | null = null;

const LAST_ROOM_KEY = 'yuzu-last-room';

/** 由外壳维护：记录/清除当前所在房间，供重连后自动回房。 */
export function setLastRoom(room: { id: string; password?: string } | null): void {
  lastRoom = room;
  if (room) {
    localStorage.setItem(LAST_ROOM_KEY, room.id);
  } else {
    localStorage.removeItem(LAST_ROOM_KEY);
  }
}

/** 上次所在房间（跨会话持久化），供外壳自动入房；房间凭据在 roomCredentials 另存。 */
export function getPersistedRoomId(): string | null {
  return localStorage.getItem(LAST_ROOM_KEY);
}

client.onSessionReset(async () => {
  const token = tokenStore.get();
  if (!token) return;
  try {
    const auth = await client.authToken(token);
    setIdentity(auth.identity);
    if (lastRoom) await roomStore.join(lastRoom.id, lastRoom.password);
  } catch {
    // 恢复失败：保持重连循环，下一轮再试
  }
});

// ---------- 会话操作 ----------
let bootPromise: Promise<boolean> | null = null;

export const session = {
  getIdentity: () => identity,

  subscribe(cb: () => void): () => void {
    identityListeners.add(cb);
    return () => {
      identityListeners.delete(cb);
    };
  },

  /** 启动恢复：有 token 则直连 + WS 认证；幂等（StrictMode 双调安全）。 */
  boot(): Promise<boolean> {
    bootPromise ??= (async () => {
      const token = tokenStore.get();
      if (!token) return false;
      try {
        await client.connect();
        setIdentity((await client.authToken(token)).identity);
        return true;
      } catch {
        tokenStore.clear();
        return false;
      }
    })();
    return bootPromise;
  },

  async loginGuest(name: string, password?: string): Promise<void> {
    const auth = await api.guestAuth(name, password);
    tokenStore.set(auth.session_token);
    await client.connect();
    setIdentity((await client.authToken(auth.session_token)).identity);
  },

  async loginOidc(idToken: string, accessToken?: string): Promise<void> {
    const auth = await api.oidcAuth(idToken, accessToken);
    tokenStore.set(auth.session_token);
    await client.connect();
    setIdentity((await client.authToken(auth.session_token)).identity);
  },

  async logout(): Promise<void> {
    await api.logout().catch(() => {});
    tokenStore.clear();
    roomCredentials.clearAll();
    client.close();
    setIdentity(null);
  },
};
