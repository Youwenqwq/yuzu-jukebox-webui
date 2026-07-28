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

export const tokenStore = createSessionTokenStore();
export const roomCredentials = createRoomCredentialStore();
export const api = new ApiClient(() => tokenStore.get(), {
  onUnauthorized: () => tokenStore.clear(),
});
export const client = new YuzuClient();
export const roomStore = new SessionStore(client);
export const oidcFlow = createOidcFlow();

// ---------- 可观察身份 ----------
let identity: Identity | null = null;
const identityListeners = new Set<() => void>();

function setIdentity(next: Identity | null): void {
  identity = next;
  for (const cb of identityListeners) cb();
}

// ---------- 断线重连后的会话恢复（spec §9.4：重走 auth → join） ----------
let lastRoom: { id: string; password?: string } | null = null;

/** 由 RoomView 维护：记录/清除当前所在房间，供重连后自动回房。 */
export function setLastRoom(room: { id: string; password?: string } | null): void {
  lastRoom = room;
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
