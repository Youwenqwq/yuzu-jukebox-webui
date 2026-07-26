import { httpBase } from '../config';
import type { AuthOk } from '../protocol/types';
import { YuzuError } from '../protocol/types';
import type {
  LyricsResult,
  OidcConfig,
  PlaylistDetail,
  PlaylistInfo,
  ProviderInfo,
  RoomInfo,
  SearchTrack,
} from './types';

interface ApiClientOptions {
  base?: string;
  onUnauthorized?: () => void;
  fetchFn?: typeof fetch;
}

interface ErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

export class ApiClient {
  readonly #base: string;
  readonly #getToken: () => string | null;
  readonly #onUnauthorized?: () => void;
  readonly #fetch: typeof fetch;

  constructor(getToken: () => string | null, opts: ApiClientOptions = {}) {
    this.#base = (opts.base ?? httpBase).replace(/\/$/, '');
    this.#getToken = getToken;
    this.#onUnauthorized = opts.onUnauthorized;
    this.#fetch = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  async guestAuth(name: string, password?: string): Promise<AuthOk> {
    return this.#json<AuthOk>('/api/v1/auth/guest', {
      method: 'POST',
      body: JSON.stringify({ name, password }),
    });
  }

  async oidcAuth(idToken: string, accessToken?: string): Promise<AuthOk> {
    return this.#json<AuthOk>('/api/v1/auth/oidc', {
      method: 'POST',
      body: JSON.stringify({ id_token: idToken, access_token: accessToken }),
    });
  }

  async oidcConfig(): Promise<OidcConfig | null> {
    const response = await this.#send('/api/v1/auth/oidc/config');
    if (response.status === 404) {
      return null;
    }
    return this.#readJson<OidcConfig>(response);
  }

  async logout(): Promise<void> {
    const response = await this.#send('/api/v1/auth/session', { method: 'DELETE' });
    if (response.status === 401) {
      this.#notifyUnauthorized();
      return;
    }
    if (response.status === 404) {
      return;
    }
    if (!response.ok) {
      throw await this.#toError(response);
    }
  }

  async listRooms(): Promise<RoomInfo[]> {
    const result = await this.#json<{ rooms: RoomInfo[] }>('/api/v1/rooms');
    return result.rooms;
  }

  async search(provider: string, q: string): Promise<SearchTrack[]> {
    const query = new URLSearchParams({ provider, q });
    const result = await this.#json<{ tracks: SearchTrack[] }>(`/api/v1/search?${query}`);
    return result.tracks;
  }

  async listProviders(): Promise<ProviderInfo[]> {
    const result = await this.#json<{ providers: ProviderInfo[] }>('/api/v1/providers');
    return result.providers;
  }

  async listPlaylists(): Promise<PlaylistInfo[]> {
    const result = await this.#json<{ playlists: PlaylistInfo[] }>('/api/v1/playlists');
    return result.playlists;
  }

  async getPlaylist(id: string, offset = 0, limit = 50): Promise<PlaylistDetail> {
    const query = new URLSearchParams({ offset: String(offset), limit: String(limit) });
    return this.#json<PlaylistDetail>(`/api/v1/playlists/${encodeURIComponent(id)}?${query}`);
  }

  async lyrics(trackRef: string): Promise<LyricsResult | null> {
    const query = new URLSearchParams({ track_ref: trackRef });
    const response = await this.#send(`/api/v1/lyrics?${query}`);
    if (response.status === 501) {
      return null;
    }
    return this.#readJson<LyricsResult>(response);
  }

  async #json<T>(path: string, init?: RequestInit): Promise<T> {
    return this.#readJson<T>(await this.#send(path, init));
  }

  async #send(path: string, init: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const token = this.#getToken();
    if (token !== null) {
      headers.Authorization = `Bearer ${token}`;
    }

    return this.#fetch(`${this.#base}${path}`, {
      ...init,
      headers: {
        ...headers,
        ...(init.headers === undefined ? {} : Object.fromEntries(new Headers(init.headers).entries())),
      },
    });
  }

  async #readJson<T>(response: Response): Promise<T> {
    if (!response.ok) {
      throw await this.#toError(response);
    }
    return (await response.json()) as T;
  }

  async #toError(response: Response): Promise<YuzuError> {
    if (response.status === 401) {
      this.#notifyUnauthorized();
    }
    const body = (await response.json().catch(() => null)) as ErrorBody | null;
    const code = body?.error?.code ?? (response.status === 401 ? 'unauthorized' : 'internal');
    const message = body?.error?.message ?? (response.statusText || `HTTP ${response.status}`);
    return new YuzuError(code, message);
  }

  #notifyUnauthorized(): void {
    try {
      this.#onUnauthorized?.();
    } catch {
      // Authentication cleanup must not replace the server's structured error.
    }
  }

}
