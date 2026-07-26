import { httpBase } from '../config';
import type { AuthOk } from '../protocol/types';
import { YuzuError } from '../protocol/types';
import type {
  AddPlaylistItemsResult,
  CacheOverview,
  CreatePlaylistInput,
  CreateRoomInput,
  CredentialResult,
  DeletePlaylistItemResult,
  HistoryEntry,
  ImportPlaylistInput,
  LocalMediaInfo,
  LyricsResult,
  MovePlaylistItemResult,
  OidcConfig,
  PlayerCommandOp,
  PlayerCommandResult,
  PlayerInfo,
  PlaylistDetail,
  PlaylistInfo,
  ProviderInfo,
  QrLoginPollResult,
  QrLoginStartResult,
  RoomInfo,
  RoomMutationResult,
  SearchTrack,
  StatsEntry,
  UpdateRoomInput,
  UploadMediaMeta,
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

  async createRoom(input: CreateRoomInput): Promise<RoomMutationResult> {
    const result = await this.#json<{ room: RoomMutationResult }>('/api/v1/rooms', {
      method: 'POST',
      body: JSON.stringify({
        ...input,
        policy: input.policy === undefined ? undefined : JSON.stringify(input.policy),
      }),
    });
    return result.room;
  }

  async updateRoom(id: string, patch: UpdateRoomInput): Promise<RoomMutationResult> {
    const result = await this.#json<{ room: RoomMutationResult }>(
      `/api/v1/rooms/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          ...patch,
          policy: patch.policy === undefined ? undefined : JSON.stringify(patch.policy),
        }),
      },
    );
    return result.room;
  }

  async deleteRoom(id: string): Promise<void> {
    await this.#json<{ ok: true }>(`/api/v1/rooms/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async roomHistory(id: string, offset?: number, limit?: number): Promise<HistoryEntry[]> {
    const query = new URLSearchParams();
    if (offset !== undefined) {
      query.set('offset', String(offset));
    }
    if (limit !== undefined) {
      query.set('limit', String(limit));
    }
    const suffix = query.size === 0 ? '' : `?${query}`;
    const result = await this.#json<{ history: HistoryEntry[] }>(
      `/api/v1/rooms/${encodeURIComponent(id)}/history${suffix}`,
    );
    return result.history;
  }

  async roomStats(id: string, limit?: number): Promise<StatsEntry[]> {
    const query = limit === undefined ? '' : `?${new URLSearchParams({ limit: String(limit) })}`;
    const result = await this.#json<{ stats: StatsEntry[] }>(
      `/api/v1/rooms/${encodeURIComponent(id)}/stats${query}`,
    );
    return result.stats;
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

  async createPlaylist(input: CreatePlaylistInput): Promise<PlaylistInfo> {
    const result = await this.#json<{ playlist: PlaylistInfo }>('/api/v1/playlists', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return result.playlist;
  }

  async deletePlaylist(id: string): Promise<void> {
    await this.#json<{ deleted: string }>(`/api/v1/playlists/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async addPlaylistItems(id: string, refs: string[]): Promise<AddPlaylistItemsResult> {
    return this.#json<AddPlaylistItemsResult>(
      `/api/v1/playlists/${encodeURIComponent(id)}/items`,
      {
        method: 'POST',
        body: JSON.stringify({ track_refs: refs }),
      },
    );
  }

  async deletePlaylistItem(id: string, ord: number): Promise<DeletePlaylistItemResult> {
    return this.#json<DeletePlaylistItemResult>(
      `/api/v1/playlists/${encodeURIComponent(id)}/items/${ord}`,
      { method: 'DELETE' },
    );
  }

  async movePlaylistItem(
    id: string,
    ord: number,
    toOrd: number,
  ): Promise<MovePlaylistItemResult> {
    return this.#json<MovePlaylistItemResult>(
      `/api/v1/playlists/${encodeURIComponent(id)}/items/${ord}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ to_ord: toOrd }),
      },
    );
  }

  async importPlaylist(input: ImportPlaylistInput): Promise<PlaylistInfo> {
    const result = await this.#json<{ playlist: PlaylistInfo }>('/api/v1/playlists/import', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return result.playlist;
  }

  async uploadMedia(file: Blob, meta: UploadMediaMeta): Promise<SearchTrack> {
    const form = new FormData();
    form.append('file', file);
    if (meta.title !== undefined) {
      form.append('title', meta.title);
    }
    if (meta.artist !== undefined) {
      form.append('artist', meta.artist);
    }
    if (meta.duration_ms !== undefined) {
      form.append('duration_ms', String(meta.duration_ms));
    }
    const result = await this.#json<{ track: SearchTrack }>('/api/v1/media/upload', {
      method: 'POST',
      body: form,
    });
    return result.track;
  }

  async listCache(): Promise<CacheOverview> {
    return this.#json<CacheOverview>('/api/v1/media/cache');
  }

  async listMedia(): Promise<LocalMediaInfo[]> {
    const result = await this.#json<{ media: LocalMediaInfo[] }>('/api/v1/media');
    return result.media;
  }

  async deleteMedia(trackRef: string): Promise<void> {
    await this.#json<{ deleted: string }>(`/api/v1/media/${encodeURIComponent(trackRef)}`, {
      method: 'DELETE',
    });
  }

  async evictCache(trackRef: string): Promise<void> {
    await this.#json<{ evicted: string }>(
      `/api/v1/media/cache/${encodeURIComponent(trackRef)}`,
      { method: 'DELETE' },
    );
  }

  async setCredential(providerId: string, payload: string): Promise<CredentialResult> {
    return this.#json<CredentialResult>(
      `/api/v1/providers/${encodeURIComponent(providerId)}/credential`,
      {
        method: 'POST',
        body: JSON.stringify({ payload }),
      },
    );
  }

  async qrLoginStart(providerId: string): Promise<QrLoginStartResult> {
    return this.#json<QrLoginStartResult>(
      `/api/v1/providers/${encodeURIComponent(providerId)}/qrlogin`,
      { method: 'POST' },
    );
  }

  async qrLoginPoll(providerId: string, key: string): Promise<QrLoginPollResult> {
    return this.#json<QrLoginPollResult>(
      `/api/v1/providers/${encodeURIComponent(providerId)}/qrlogin/${encodeURIComponent(key)}`,
    );
  }

  async listPlayers(): Promise<PlayerInfo[]> {
    const result = await this.#json<{ players: PlayerInfo[] }>('/api/v1/players');
    return result.players;
  }

  async playerCommand(
    id: string,
    op: PlayerCommandOp,
    value: number | boolean | string,
  ): Promise<PlayerCommandResult> {
    return this.#json<PlayerCommandResult>(
      `/api/v1/players/${encodeURIComponent(id)}/command`,
      {
        method: 'POST',
        body: JSON.stringify({ op, value }),
      },
    );
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
    if (
      init.body !== undefined &&
      !(typeof FormData !== 'undefined' && init.body instanceof FormData)
    ) {
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
