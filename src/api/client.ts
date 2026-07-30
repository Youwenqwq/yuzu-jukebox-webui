import { httpBase } from '../config';
import type { AuthOk } from '../protocol/types';
import { YuzuError } from '../protocol/types';
import type {
  AddPlaylistItemsResult,
  AccelerationCredentialActivationResult,
  AccelerationCredentialResult,
  AccelerationInfo,
  AccelerationInventoryScan,
  AccelerationInventoryStatus,
  AccelerationRequestsResult,
  AccelerationStatus,
  DistributionRequest,
  CreateAccelerationInput,
  UpdateAccelerationInput,
  CacheOverview,
  CreatePlaylistInput,
  CreatePlayerInput,
  CreateRoomInput,
  CredentialResult,
  DeletePlaylistItemResult,
  HistoryEntry,
  ImportPlaylistInput,
  ExternalBindingCode,
  LocalMediaInfo,
  IntegrationInfo,
  IntegrationCredentialResult,
  IntegrationScopeBinding,
  IntegrationScopeBindingInfo,
  IntegrationSubjectLink,
  IntegrationSubjectLinkInfo,
  UpdateIntegrationRequest,
  LyricsResult,
  MovePlaylistItemResult,
  OidcConfig,
  PlayerCommandOp,
  PlayerCommandResult,
  PlayerCredentialResult,
  PlayerInfo,
  PlaylistDetail,
  PlaylistItem,
  PlaylistInfo,
  ProviderInfo,
  PruneResult,
  PrincipalInfo,
  QrLoginPollResult,
  QrLoginStartResult,
  RoomAccessCode,
  RoomCapabilities,
  RoomControllerGrant,
  RoomInfo,
  RoomMutationResult,
  RoomOutput,
  RoomOutputUpdate,
  RoomPlayerInfo,
  SearchTrack,
  StatsEntry,
  UpdatePlayerInput,
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

/** Go nil slices encode as JSON null; UI always wants a real array. */
function asList<T>(value: T[] | null | undefined): T[] {
  return value ?? [];
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
  async issueExternalBindingCode(): Promise<ExternalBindingCode> {
    return this.#json<ExternalBindingCode>('/api/v1/auth/external-binding-codes', {
      method: 'POST',
    });
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
    const result = await this.#json<{ rooms: RoomInfo[] | null }>('/api/v1/rooms');
    return asList(result.rooms);
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

  async roomAccessCode(id: string): Promise<RoomAccessCode> {
    const result = await this.#json<{ room_id: string; access_code: RoomAccessCode }>(
      `/api/v1/rooms/${encodeURIComponent(id)}/access-code`,
    );
    return result.access_code;
  }

  async roomCapabilities(id: string): Promise<RoomCapabilities> {
    const result = await this.#json<{ capabilities: RoomCapabilities }>(
      `/api/v1/rooms/${encodeURIComponent(id)}/capabilities`,
    );
    return result.capabilities;
  }

  async listIntegrations(): Promise<IntegrationInfo[]> {
    const result = await this.#json<{ integrations: IntegrationInfo[] | null }>('/api/v1/integrations');
    return asList(result.integrations);
  }

  async createIntegration(id: string, name: string): Promise<IntegrationCredentialResult> {
    return this.#json<IntegrationCredentialResult>('/api/v1/integrations', {
      method: 'POST',
      body: JSON.stringify({ id, name }),
    });
  }

  async updateIntegration(
    id: string,
    update: UpdateIntegrationRequest,
  ): Promise<IntegrationInfo> {
    const result = await this.#json<{ integration: IntegrationInfo }>(
      `/api/v1/integrations/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(update),
      },
    );
    return result.integration;
  }

  async rotateIntegrationToken(id: string): Promise<IntegrationCredentialResult> {
    return this.#json<IntegrationCredentialResult>(
      `/api/v1/integrations/${encodeURIComponent(id)}/token`,
      { method: 'POST' },
    );
  }

  async deleteIntegration(id: string): Promise<void> {
    await this.#json<{ ok: true }>(`/api/v1/integrations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async listIntegrationScopes(integrationId: string): Promise<IntegrationScopeBindingInfo[]> {
    const result = await this.#json<{ scopes: IntegrationScopeBindingInfo[] | null }>(
      `/api/v1/integrations/${encodeURIComponent(integrationId)}/scopes`,
    );
    return asList(result.scopes);
  }

  async bindIntegrationScope(
    integrationId: string,
    binding: IntegrationScopeBinding,
  ): Promise<IntegrationScopeBindingInfo> {
    const result = await this.#json<{ scope: IntegrationScopeBindingInfo }>(
      `/api/v1/integrations/${encodeURIComponent(integrationId)}/scopes`,
      {
        method: 'PUT',
        body: JSON.stringify(binding),
      },
    );
    return result.scope;
  }

  async unbindIntegrationScope(
    integrationId: string,
    binding: IntegrationScopeBinding,
  ): Promise<void> {
    await this.#json<{ ok: true }>(
      `/api/v1/integrations/${encodeURIComponent(integrationId)}/scopes`,
      {
        method: 'DELETE',
        body: JSON.stringify(binding),
      },
    );
  }

  async listIntegrationSubjects(integrationId: string): Promise<IntegrationSubjectLinkInfo[]> {
    const result = await this.#json<{ subjects: IntegrationSubjectLinkInfo[] | null }>(
      `/api/v1/integrations/${encodeURIComponent(integrationId)}/subjects`,
    );
    return asList(result.subjects);
  }

  async linkIntegrationSubject(
    integrationId: string,
    link: IntegrationSubjectLink,
  ): Promise<IntegrationSubjectLinkInfo> {
    const result = await this.#json<{ subject: IntegrationSubjectLinkInfo }>(
      `/api/v1/integrations/${encodeURIComponent(integrationId)}/subjects`,
      {
        method: 'PUT',
        body: JSON.stringify(link),
      },
    );
    return result.subject;
  }

  async unlinkIntegrationSubject(
    integrationId: string,
    link: IntegrationSubjectLink,
  ): Promise<void> {
    await this.#json<{ ok: true }>(
      `/api/v1/integrations/${encodeURIComponent(integrationId)}/subjects`,
      {
        method: 'DELETE',
        body: JSON.stringify(link),
      },
    );
  }
  async listPrincipals(query?: string, limit?: number): Promise<PrincipalInfo[]> {
    const params = new URLSearchParams();
    if (query) {
      params.set('q', query);
    }
    if (limit !== undefined && limit > 0) {
      params.set('limit', String(limit));
    }
    const suffix = params.size === 0 ? '' : `?${params}`;
    const result = await this.#json<{ principals: PrincipalInfo[] | null }>(
      `/api/v1/principals${suffix}`,
    );
    return asList(result.principals);
  }

  async listRoomGrants(roomId: string): Promise<RoomControllerGrant[]> {
    const result = await this.#json<{ grants: RoomControllerGrant[] | null }>(
      `/api/v1/rooms/${encodeURIComponent(roomId)}/grants`,
    );
    return asList(result.grants);
  }


  async grantRoomController(
    roomId: string,
    principalId: string,
  ): Promise<RoomControllerGrant> {
    const grant: RoomControllerGrant = {
      room_id: roomId,
      principal_id: principalId,
      capability: 'controller',
    };
    const result = await this.#json<{ grant: RoomControllerGrant }>(
      `/api/v1/rooms/${encodeURIComponent(roomId)}/grants/${encodeURIComponent(principalId)}`,
      {
        method: 'PUT',
        body: JSON.stringify(grant),
      },
    );
    return result.grant;
  }

  async revokeRoomController(roomId: string, principalId: string): Promise<void> {
    const grant: RoomControllerGrant = {
      room_id: roomId,
      principal_id: principalId,
      capability: 'controller',
    };
    await this.#json<{ ok: true }>(
      `/api/v1/rooms/${encodeURIComponent(roomId)}/grants/${encodeURIComponent(principalId)}`,
      {
        method: 'DELETE',
        body: JSON.stringify(grant),
      },
    );
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
    const result = await this.#json<{ history: HistoryEntry[] | null }>(
      `/api/v1/rooms/${encodeURIComponent(id)}/history${suffix}`,
    );
    return asList(result.history);
  }

  async roomStats(id: string, limit?: number): Promise<StatsEntry[]> {
    const query = limit === undefined ? '' : `?${new URLSearchParams({ limit: String(limit) })}`;
    const result = await this.#json<{ stats: StatsEntry[] | null }>(
      `/api/v1/rooms/${encodeURIComponent(id)}/stats${query}`,
    );
    return asList(result.stats);
  }

  async search(provider: string, q: string): Promise<SearchTrack[]> {
    const query = new URLSearchParams({ provider, q });
    const result = await this.#json<{ tracks: SearchTrack[] | null }>(`/api/v1/search?${query}`);
    return asList(result.tracks);
  }

  async listProviders(): Promise<ProviderInfo[]> {
    const result = await this.#json<{ providers: ProviderInfo[] | null }>('/api/v1/providers');
    return asList(result.providers);
  }

  async listPlaylists(): Promise<PlaylistInfo[]> {
    const result = await this.#json<{ playlists: PlaylistInfo[] | null }>('/api/v1/playlists');
    return asList(result.playlists);
  }

  async getPlaylist(id: string, offset = 0, limit = 50): Promise<PlaylistDetail> {
    const query = new URLSearchParams({ offset: String(offset), limit: String(limit) });
    const result = await this.#json<{
      playlist: PlaylistInfo;
      items: PlaylistItem[] | null;
      offset: number;
      limit: number;
    }>(`/api/v1/playlists/${encodeURIComponent(id)}?${query}`);
    return {
      playlist: result.playlist,
      items: asList(result.items),
      offset: result.offset,
      limit: result.limit,
    };
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
    const result = await this.#json<{
      entries: CacheOverview['entries'] | null;
      downloads: CacheOverview['downloads'] | null;
      history: CacheOverview['history'] | null;
      total_bytes: number;
      max_bytes: number;
    }>('/api/v1/media/cache');
    return {
      entries: asList(result.entries),
      downloads: asList(result.downloads),
      history: asList(result.history),
      total_bytes: result.total_bytes,
      max_bytes: result.max_bytes,
    };
  }

  async listMedia(): Promise<LocalMediaInfo[]> {
    const result = await this.#json<{ media: LocalMediaInfo[] | null }>('/api/v1/media');
    return asList(result.media);
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

  async pruneCache(unusedDays: number): Promise<PruneResult> {
    return this.#json<PruneResult>('/api/v1/media/cache/prune', {
      method: 'POST',
      body: JSON.stringify({ unused_days: unusedDays }),
    });
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
    const result = await this.#json<{ players: PlayerInfo[] | null }>('/api/v1/players');
    return asList(result.players);
  }

  async getPlayer(id: string): Promise<PlayerInfo> {
    const result = await this.#json<{ player: PlayerInfo }>(
      `/api/v1/players/${encodeURIComponent(id)}`,
    );
    return result.player;
  }

  async createPlayer(input: CreatePlayerInput): Promise<PlayerCredentialResult> {
    return this.#json<PlayerCredentialResult>('/api/v1/players', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async updatePlayer(id: string, patch: UpdatePlayerInput): Promise<PlayerInfo> {
    const result = await this.#json<{ player: PlayerInfo }>(
      `/api/v1/players/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(patch),
      },
    );
    return result.player;
  }

  async rotatePlayerKey(id: string): Promise<PlayerCredentialResult> {
    return this.#json<PlayerCredentialResult>(`/api/v1/players/${encodeURIComponent(id)}/key`, {
      method: 'POST',
    });
  }

  async deletePlayer(id: string): Promise<void> {
    await this.#json<{ ok: true }>(`/api/v1/players/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async playerCommand(
    id: string,
    op: PlayerCommandOp,
    value: number | boolean,
  ): Promise<PlayerCommandResult> {
    return this.#json<PlayerCommandResult>(
      `/api/v1/players/${encodeURIComponent(id)}/command`,
      {
        method: 'POST',
        body: JSON.stringify({ op, value }),
      },
    );
  }

  async listAccelerations(): Promise<AccelerationInfo[]> {
    const result = await this.#json<{ accelerations: AccelerationInfo[] | null }>('/api/v1/accelerations');
    return asList(result.accelerations);
  }

  async getAcceleration(id: string): Promise<AccelerationInfo> {
    const result = await this.#json<{ acceleration: AccelerationInfo }>(
      `/api/v1/accelerations/${encodeURIComponent(id)}`,
    );
    return result.acceleration;
  }

  async createAcceleration(input: CreateAccelerationInput): Promise<{
    acceleration: AccelerationInfo;
    credentials: {
      publisher_token: string;
      delivery_token: string;
      backend_token: string;
    };
  }> {
    return this.#json('/api/v1/accelerations', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async updateAcceleration(id: string, patch: UpdateAccelerationInput): Promise<AccelerationInfo> {
    const result = await this.#json<{ acceleration: AccelerationInfo }>(
      `/api/v1/accelerations/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(patch),
      },
    );
    return result.acceleration;
  }

  async deleteAcceleration(id: string): Promise<void> {
    await this.#json<{ ok: true }>(`/api/v1/accelerations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async accelerationStatus(id: string): Promise<AccelerationStatus> {
    return this.#json<AccelerationStatus>(
      `/api/v1/accelerations/${encodeURIComponent(id)}/status`,
    );
  }
  async accelerationRequest(
    id: string,
    trackRef: string,
  ): Promise<{ request: DistributionRequest }> {
    return this.#json<{ request: DistributionRequest }>(
      `/api/v1/accelerations/${encodeURIComponent(id)}/requests/${encodeURIComponent(trackRef)}`,
    );
  }

  async cancelAccelerationRequest(
    id: string,
    trackRef: string,
  ): Promise<{ request: DistributionRequest }> {
    return this.#json<{ request: DistributionRequest }>(
      `/api/v1/accelerations/${encodeURIComponent(id)}/requests/${encodeURIComponent(trackRef)}`,
      { method: 'DELETE' },
    );
  }

  async refreshAccelerationInventory(
    id: string,
  ): Promise<{ scan: AccelerationInventoryScan }> {
    return this.#json<{ scan: AccelerationInventoryScan }>(
      `/api/v1/accelerations/${encodeURIComponent(id)}/inventory/refresh`,
      { method: 'POST' },
    );
  }

  async accelerationInventoryStatus(id: string): Promise<AccelerationInventoryStatus> {
    return this.#json<AccelerationInventoryStatus>(
      `/api/v1/accelerations/${encodeURIComponent(id)}/inventory/status`,
    );
  }


  async accelerationRequests(
    id: string,
    state?: string,
    limit = 50,
  ): Promise<AccelerationRequestsResult> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (state) query.set('state', state);
    return this.#json<AccelerationRequestsResult>(
      `/api/v1/accelerations/${encodeURIComponent(id)}/requests?${query.toString()}`,
    );
  }

  async prepareAccelerationCredential(
    id: string,
    purpose: 'publisher' | 'delivery' | 'backend',
  ): Promise<AccelerationCredentialResult> {
    return this.#json<AccelerationCredentialResult>(
      `/api/v1/accelerations/${encodeURIComponent(id)}/credentials/${purpose}/prepare`,
      { method: 'POST' },
    );
  }

  async activateAccelerationCredential(
    id: string,
    purpose: 'publisher' | 'delivery' | 'backend',
  ): Promise<AccelerationCredentialActivationResult> {
    return this.#json<AccelerationCredentialActivationResult>(
      `/api/v1/accelerations/${encodeURIComponent(id)}/credentials/${purpose}/activate`,
      { method: 'POST' },
    );
  }

  async roomOutput(roomId: string): Promise<RoomOutput> {
    const result = await this.#json<{ output: RoomOutput }>(
      `/api/v1/rooms/${encodeURIComponent(roomId)}/output`,
    );
    return result.output;
  }

  async setRoomOutputVolume(roomId: string, volume: number): Promise<RoomOutputUpdate> {
    return this.#json<RoomOutputUpdate>(
      `/api/v1/rooms/${encodeURIComponent(roomId)}/output`,
      {
        method: 'PATCH',
        body: JSON.stringify({ volume }),
      },
    );
  }

  async roomPlayers(roomId: string): Promise<RoomPlayerInfo[]> {
    const result = await this.#json<{ players: RoomPlayerInfo[] | null }>(
      `/api/v1/rooms/${encodeURIComponent(roomId)}/players`,
    );
    return asList(result.players);
  }

  async bindRoomPlayer(roomId: string, playerId: string): Promise<RoomPlayerInfo> {
    const result = await this.#json<{ player: RoomPlayerInfo }>(
      `/api/v1/rooms/${encodeURIComponent(roomId)}/players/${encodeURIComponent(playerId)}`,
      { method: 'PUT' },
    );
    return result.player;
  }

  async unbindRoomPlayer(roomId: string, playerId: string): Promise<void> {
    await this.#json<{ ok: true }>(
      `/api/v1/rooms/${encodeURIComponent(roomId)}/players/${encodeURIComponent(playerId)}`,
      { method: 'DELETE' },
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
