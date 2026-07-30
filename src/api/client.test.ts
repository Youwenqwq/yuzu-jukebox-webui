import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'location', {
    value: { protocol: 'https:', host: 'app.example' },
    configurable: true,
  });
});
import { YuzuError } from '../protocol/types';
import { ApiClient } from './client';

const identity = {
  id: 'g_alice',
  name: 'alice',
  kind: 'guest' as const,
  roles: ['listener' as const, 'requester' as const],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ApiClient', () => {
  it('sends auth JSON and only adds bearer authorization when a token exists', async () => {
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ identity, session_token: 'session' }))
      .mockResolvedValueOnce(jsonResponse({ identity, session_token: 'session-2' }));
    const anonymous = new ApiClient(() => null, { base: 'https://yuzu.test/', fetchFn });
    const authenticated = new ApiClient(() => 'current-token', { base: 'https://yuzu.test', fetchFn });

    await expect(anonymous.guestAuth('alice')).resolves.toEqual({ identity, session_token: 'session' });
    await expect(authenticated.oidcAuth('id-token', 'access-token')).resolves.toEqual({
      identity,
      session_token: 'session-2',
    });

    const [guestUrl, guestInit] = fetchFn.mock.calls[0];
    expect(guestUrl).toBe('https://yuzu.test/api/v1/auth/guest');
    expect(guestInit?.method).toBe('POST');
    expect(JSON.parse(String(guestInit?.body))).toEqual({ name: 'alice' });
    expect(new Headers(guestInit?.headers).has('Authorization')).toBe(false);

    const [, oidcInit] = fetchFn.mock.calls[1];
    expect(JSON.parse(String(oidcInit?.body))).toEqual({
      id_token: 'id-token',
      access_token: 'access-token',
    });
    expect(new Headers(oidcInit?.headers).get('Authorization')).toBe('Bearer current-token');
  });
  it('issues an external binding code with the current OIDC session and no request body', async () => {
    const issued = { code: '7K3M-9P2D-X4RT', expires_at: 1_720_000_600_000 };
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(issued, 201));
    const client = new ApiClient(() => 'oidc-session', {
      base: 'https://yuzu.test',
      fetchFn,
    });

    await expect(client.issueExternalBindingCode()).resolves.toEqual(issued);

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://yuzu.test/api/v1/auth/external-binding-codes');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeUndefined();
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer oidc-session');
    expect(headers.has('Content-Type')).toBe(false);
  });


  it('maps REST errors and invokes unauthorized cleanup before rejecting a 401', async () => {
    const events: string[] = [];
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ error: { code: 'unauthorized', message: 'expired session' } }, 401),
    );
    const client = new ApiClient(() => 'expired', {
      fetchFn,
      onUnauthorized: () => events.push('cleared'),
    });

    const failure = client.listRooms().catch((error: unknown) => {
      events.push('rejected');
      throw error;
    });
    await expect(failure).rejects.toEqual(new YuzuError('unauthorized', 'expired session'));
    expect(events).toEqual(['cleared', 'rejected']);
  });

  it('maps arbitrary structured error codes to YuzuError', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ error: { code: 'provider_error', message: 'upstream unavailable' } }, 502),
    );
    const client = new ApiClient(() => null, { fetchFn });

    await expect(client.search('ncm', '柚子')).rejects.toMatchObject({
      name: 'YuzuError',
      code: 'provider_error',
      message: 'upstream unavailable',
    });
  });

  it('unwraps actual room, search, provider, and lyrics response shapes', async () => {
    const room = { id: 'main', name: 'Main', policy: { max_queue: 20 } };
    const track = {
      track_ref: 'ncm:42',
      title: 'Song',
      artist: 'Artist',
      duration_ms: 123000,
      album: 'Album',
      source_url: 'https://source.test/42',
      contributors: [{ role: 'composer', name: 'Composer' }],
    };
    const provider = { id: 'ncm', credential_status: 'valid' };
    const lyrics = { type: 'lrc', lrc: '[00:00]Song', tlrc: '[00:00]歌' } as const;
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ rooms: [room] }))
      .mockResolvedValueOnce(jsonResponse({ tracks: [track] }))
      .mockResolvedValueOnce(jsonResponse({ providers: [provider] }))
      .mockResolvedValueOnce(jsonResponse(lyrics));
    const client = new ApiClient(() => 'token', { base: 'https://yuzu.test', fetchFn });

    await expect(client.listRooms()).resolves.toEqual([room]);
    await expect(client.search('ncm', 'a & b')).resolves.toEqual([track]);
    await expect(client.listProviders()).resolves.toEqual([provider]);
    await expect(client.lyrics('ncm:42/part')).resolves.toEqual(lyrics);
    expect(fetchFn.mock.calls[1][0]).toBe('https://yuzu.test/api/v1/search?provider=ncm&q=a+%26+b');
    expect(fetchFn.mock.calls[3][0]).toBe(
      'https://yuzu.test/api/v1/lyrics?track_ref=ncm%3A42%2Fpart',
    );
  });

  it('handles endpoint-specific absence and idempotent logout statuses', async () => {
    const onUnauthorized = vi.fn();
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'not_found', message: 'disabled' } }, 404))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'not_supported', message: 'none' } }, 501))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'unauthorized', message: 'gone' } }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'not_found', message: 'gone' } }, 404));
    const client = new ApiClient(() => 'token', { fetchFn, onUnauthorized });

    await expect(client.oidcConfig()).resolves.toBeNull();
    await expect(client.lyrics('local:1')).resolves.toBeNull();
    await expect(client.logout()).resolves.toBeUndefined();
    await expect(client.logout()).resolves.toBeUndefined();
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('unwraps playlists and requests playlist detail with pagination', async () => {
    const playlist = {
      id: '晚 风/精选',
      name: '晚风精选',
      description: '夜里的歌',
      created_by: 'g_alice',
      created_at: 1_700_000_000_000,
      updated_at: 1_700_000_001_000,
      track_count: 75,
    };
    const item = {
      ord: 1,
      track_ref: 'ncm:42',
      title: 'Song',
      artist: 'Artist',
      duration_ms: 123_000,
      added_at: 1_700_000_002_000,
    };
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ playlists: [playlist] }))
      .mockResolvedValueOnce(jsonResponse({ playlist, items: [item], offset: 0, limit: 50 }))
      .mockResolvedValueOnce(jsonResponse({ playlist, items: [item], offset: 50, limit: 25 }));
    const client = new ApiClient(() => 'token', { base: 'https://yuzu.test', fetchFn });

    await expect(client.listPlaylists()).resolves.toEqual([playlist]);
    await expect(client.getPlaylist(playlist.id)).resolves.toEqual({
      playlist,
      items: [item],
      offset: 0,
      limit: 50,
    });
    await expect(client.getPlaylist(playlist.id, 50, 25)).resolves.toEqual({
      playlist,
      items: [item],
      offset: 50,
      limit: 25,
    });
    expect(fetchFn.mock.calls[0][0]).toBe('https://yuzu.test/api/v1/playlists');
    expect(fetchFn.mock.calls[1][0]).toBe(
      'https://yuzu.test/api/v1/playlists/%E6%99%9A%20%E9%A3%8E%2F%E7%B2%BE%E9%80%89?offset=0&limit=50',
    );
    expect(fetchFn.mock.calls[2][0]).toBe(
      'https://yuzu.test/api/v1/playlists/%E6%99%9A%20%E9%A3%8E%2F%E7%B2%BE%E9%80%89?offset=50&limit=25',
    );
  });

  it('normalizes Go nil slices to empty arrays for list endpoints', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ playlists: null }))
      .mockResolvedValueOnce(jsonResponse({ media: null }))
      .mockResolvedValueOnce(
        jsonResponse({
          entries: null,
          downloads: null,
          history: null,
          total_bytes: 0,
          max_bytes: 0,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          playlist: {
            id: 'empty',
            name: 'Empty',
            description: '',
            created_by: 'g_alice',
            created_at: 1,
            updated_at: 1,
            track_count: 0,
          },
          items: null,
          offset: 0,
          limit: 50,
        }),
      );
    const client = new ApiClient(() => 'token', { base: 'https://yuzu.test', fetchFn });

    await expect(client.listPlaylists()).resolves.toEqual([]);
    await expect(client.listMedia()).resolves.toEqual([]);
    await expect(client.listCache()).resolves.toEqual({
      entries: [],
      downloads: [],
      history: [],
      total_bytes: 0,
      max_bytes: 0,
    });
    await expect(client.getPlaylist('empty')).resolves.toEqual({
      playlist: {
        id: 'empty',
        name: 'Empty',
        description: '',
        created_by: 'g_alice',
        created_at: 1,
        updated_at: 1,
        track_count: 0,
      },
      items: [],
      offset: 0,
      limit: 50,
    });
  });

  it('manages rooms with the server wire format and unwraps history and stats', async () => {
    const room = {
      id: 'room /一',
      name: 'Morning',
      guest_access: { mode: 'static_password' as const },
    };
    const history = {
      track_ref: 'ncm:42',
      title: 'Song',
      requested_by: 'g_alice',
      started_at: 100,
      ended_at: 200,
      end_reason: 'finished',
    };
    const stat = {
      track_ref: 'ncm:42',
      title: 'Song',
      play_count: 3,
      first_played_at: 100,
      last_played_at: 300,
    };
    const accessCode = {
      code: '7M2K-Q9TR-W4HX',
      period_seconds: 86400,
      valid_from: 1_720_000_000_000,
      expires_at: 1_720_086_400_000,
    };
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ room }))
      .mockResolvedValueOnce(
        jsonResponse({
          room: {
            ...room,
            name: 'Evening',
            guest_access: { mode: 'open' },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ history: [history] }))
      .mockResolvedValueOnce(jsonResponse({ stats: [stat] }))
      .mockResolvedValueOnce(jsonResponse({ room_id: room.id, access_code: accessCode }));
    const client = new ApiClient(() => 'admin-token', {
      base: 'https://yuzu.test',
      fetchFn,
    });

    await expect(
      client.createRoom({
        id: room.id,
        name: room.name,
        guest_access_mode: 'static_password',
        guest_password: 'guest',
        policy: { max_queue: 20, queue_limits: { requester: 5 } },
      }),
    ).resolves.toEqual(room);
    await expect(
      client.updateRoom(room.id, {
        name: 'Evening',
        guest_access_mode: 'open',
        policy: { max_queue: 30, member_player_volume: true },
      }),
    ).resolves.toEqual({
      ...room,
      name: 'Evening',
      guest_access: { mode: 'open' },
    });
    await expect(client.deleteRoom(room.id)).resolves.toBeUndefined();
    await expect(client.roomHistory(room.id, 10, 25)).resolves.toEqual([history]);
    await expect(client.roomStats(room.id, 7)).resolves.toEqual([stat]);
    await expect(client.roomAccessCode(room.id)).resolves.toEqual(accessCode);

    const encodedRoom = 'room%20%2F%E4%B8%80';
    const [createUrl, createInit] = fetchFn.mock.calls[0];
    expect(createUrl).toBe('https://yuzu.test/api/v1/rooms');
    expect(createInit?.method).toBe('POST');
    expect(JSON.parse(String(createInit?.body))).toEqual({
      id: room.id,
      name: room.name,
      guest_access_mode: 'static_password',
      guest_password: 'guest',
      policy: '{"max_queue":20,"queue_limits":{"requester":5}}',
    });

    const [updateUrl, updateInit] = fetchFn.mock.calls[1];
    expect(updateUrl).toBe(`https://yuzu.test/api/v1/rooms/${encodedRoom}`);
    expect(updateInit?.method).toBe('PATCH');
    expect(JSON.parse(String(updateInit?.body))).toEqual({
      name: 'Evening',
      guest_access_mode: 'open',
      policy: '{"max_queue":30,"member_player_volume":true}',
    });
    expect(fetchFn.mock.calls[2][0]).toBe(`https://yuzu.test/api/v1/rooms/${encodedRoom}`);
    expect(fetchFn.mock.calls[2][1]?.method).toBe('DELETE');
    expect(fetchFn.mock.calls[3][0]).toBe(
      `https://yuzu.test/api/v1/rooms/${encodedRoom}/history?offset=10&limit=25`,
    );
    expect(fetchFn.mock.calls[4][0]).toBe(
      `https://yuzu.test/api/v1/rooms/${encodedRoom}/stats?limit=7`,
    );
    expect(fetchFn.mock.calls[5][0]).toBe(
      `https://yuzu.test/api/v1/rooms/${encodedRoom}/access-code`,
    );
  });

  it('manages playlists using each endpoint actual body and response wrapper', async () => {
    const playlist = {
      id: 'pl /精选',
      name: '精选',
      description: 'favorites',
      created_by: 'g_alice',
      created_at: 100,
      updated_at: 100,
      track_count: 0,
    };
    const imported = { ...playlist, id: 'pl_imported', name: 'Daily', track_count: 2 };
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ playlist }, 201))
      .mockResolvedValueOnce(jsonResponse({ deleted: playlist.id }))
      .mockResolvedValueOnce(jsonResponse({ added: 2 }))
      .mockResolvedValueOnce(jsonResponse({ deleted: 3 }))
      .mockResolvedValueOnce(jsonResponse({ moved: 2, to_ord: 5 }))
      .mockResolvedValueOnce(jsonResponse({ playlist: imported }, 201));
    const client = new ApiClient(() => 'admin-token', {
      base: 'https://yuzu.test',
      fetchFn,
    });

    await expect(
      client.createPlaylist({ name: playlist.name, description: playlist.description }),
    ).resolves.toEqual(playlist);
    await expect(client.deletePlaylist(playlist.id)).resolves.toBeUndefined();
    await expect(client.addPlaylistItems(playlist.id, ['ncm:1', 'local:two'])).resolves.toEqual({
      added: 2,
    });
    await expect(client.deletePlaylistItem(playlist.id, 3)).resolves.toEqual({ deleted: 3 });
    await expect(client.movePlaylistItem(playlist.id, 2, 5)).resolves.toEqual({
      moved: 2,
      to_ord: 5,
    });
    await expect(
      client.importPlaylist({ provider: 'ncm', playlist_id: '123 / 456', name: 'Daily' }),
    ).resolves.toEqual(imported);

    expect(fetchFn.mock.calls[0][0]).toBe('https://yuzu.test/api/v1/playlists');
    expect(fetchFn.mock.calls[0][1]?.method).toBe('POST');
    expect(JSON.parse(String(fetchFn.mock.calls[0][1]?.body))).toEqual({
      name: '精选',
      description: 'favorites',
    });
    const itemBase = 'https://yuzu.test/api/v1/playlists/pl%20%2F%E7%B2%BE%E9%80%89/items';
    expect(fetchFn.mock.calls[1][0]).toBe(
      'https://yuzu.test/api/v1/playlists/pl%20%2F%E7%B2%BE%E9%80%89',
    );
    expect(fetchFn.mock.calls[1][1]?.method).toBe('DELETE');
    expect(fetchFn.mock.calls[2][0]).toBe(itemBase);
    expect(fetchFn.mock.calls[2][1]?.method).toBe('POST');
    expect(JSON.parse(String(fetchFn.mock.calls[2][1]?.body))).toEqual({
      track_refs: ['ncm:1', 'local:two'],
    });
    expect(fetchFn.mock.calls[3][0]).toBe(`${itemBase}/3`);
    expect(fetchFn.mock.calls[3][1]?.method).toBe('DELETE');
    expect(fetchFn.mock.calls[4][0]).toBe(`${itemBase}/2`);
    expect(fetchFn.mock.calls[4][1]?.method).toBe('PATCH');
    expect(JSON.parse(String(fetchFn.mock.calls[4][1]?.body))).toEqual({ to_ord: 5 });
    expect(fetchFn.mock.calls[5][0]).toBe('https://yuzu.test/api/v1/playlists/import');
    expect(fetchFn.mock.calls[5][1]?.method).toBe('POST');
    expect(JSON.parse(String(fetchFn.mock.calls[5][1]?.body))).toEqual({
      provider: 'ncm',
      playlist_id: '123 / 456',
      name: 'Daily',
    });
  });

  it('uploads media as multipart without a JSON content type and manages cache', async () => {
    const track = {
      track_ref: 'local:uploaded',
      title: 'Upload',
      artist: 'Alice',
      duration_ms: 1234,
    };
    const cache = {
      entries: [
        {
          track_ref: 'ncm:42',
          file_path: '/cache/42.mp3',
          size_bytes: 1024,
          bitrate_kbps: 320,
          last_accessed_at: 200,
          created_at: 100,
        },
      ],
      downloads: [
        {
          track_ref: 'ncm:43',
          fetched_bytes: 512,
          total_bytes: 1024,
          started_at: 300,
          status: 'downloading',
        },
      ],
      history: [
        {
          track_ref: 'ncm:41',
          fetched_bytes: 2048,
          total_bytes: 2048,
          started_at: 50,
          finished_at: 60,
          status: 'ok',
        },
      ],
    };
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ track }, 201))
      .mockResolvedValueOnce(jsonResponse(cache))
      .mockResolvedValueOnce(jsonResponse({ evicted: 'ncm:42/part' }));
    const client = new ApiClient(() => 'admin-token', {
      base: 'https://yuzu.test',
      fetchFn,
    });
    const file = new Blob(['audio bytes'], { type: 'audio/mpeg' });

    await expect(
      client.uploadMedia(file, { title: 'Upload', artist: 'Alice', duration_ms: 1234 }),
    ).resolves.toEqual(track);
    await expect(client.listCache()).resolves.toEqual(cache);
    await expect(client.evictCache('ncm:42/part')).resolves.toBeUndefined();

    const [uploadUrl, uploadInit] = fetchFn.mock.calls[0];
    expect(uploadUrl).toBe('https://yuzu.test/api/v1/media/upload');
    expect(uploadInit?.method).toBe('POST');
    expect(uploadInit?.body).toBeInstanceOf(FormData);
    expect(new Headers(uploadInit?.headers).has('Content-Type')).toBe(false);
    expect(new Headers(uploadInit?.headers).get('Authorization')).toBe('Bearer admin-token');
    const form = uploadInit?.body as FormData;
    expect(form.get('file')).toBeInstanceOf(Blob);
    expect(await (form.get('file') as Blob).text()).toBe('audio bytes');
    expect(form.get('title')).toBe('Upload');
    expect(form.get('artist')).toBe('Alice');
    expect(form.get('duration_ms')).toBe('1234');
    expect(fetchFn.mock.calls[1][0]).toBe('https://yuzu.test/api/v1/media/cache');
    expect(fetchFn.mock.calls[2][0]).toBe(
      'https://yuzu.test/api/v1/media/cache/ncm%3A42%2Fpart',
    );
    expect(fetchFn.mock.calls[2][1]?.method).toBe('DELETE');
  });

  it('sets credentials and drives provider QR login with encoded path parameters', async () => {
    const credential = { provider: 'ncm / cloud', status: 'ok' as const };
    const started = { key: 'qr/key + 一', qr_content: 'https://qr.test/content' };
    const polled = { status: 'scanned' as const, message: 'confirm in app' };
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(credential))
      .mockResolvedValueOnce(jsonResponse(started))
      .mockResolvedValueOnce(jsonResponse(polled));
    const client = new ApiClient(() => 'admin-token', {
      base: 'https://yuzu.test',
      fetchFn,
    });

    await expect(client.setCredential(credential.provider, 'MUSIC_U=secret')).resolves.toEqual(
      credential,
    );
    await expect(client.qrLoginStart(credential.provider)).resolves.toEqual(started);
    await expect(client.qrLoginPoll(credential.provider, started.key)).resolves.toEqual(polled);

    const provider = 'ncm%20%2F%20cloud';
    expect(fetchFn.mock.calls[0][0]).toBe(
      `https://yuzu.test/api/v1/providers/${provider}/credential`,
    );
    expect(fetchFn.mock.calls[0][1]?.method).toBe('POST');
    expect(JSON.parse(String(fetchFn.mock.calls[0][1]?.body))).toEqual({
      payload: 'MUSIC_U=secret',
    });
    expect(fetchFn.mock.calls[1][0]).toBe(
      `https://yuzu.test/api/v1/providers/${provider}/qrlogin`,
    );
    expect(fetchFn.mock.calls[1][1]?.method).toBe('POST');
    expect(fetchFn.mock.calls[2][0]).toBe(
      `https://yuzu.test/api/v1/providers/${provider}/qrlogin/qr%2Fkey%20%2B%20%E4%B8%80`,
    );
  });

  it('manages persistent players and online device commands', async () => {
    const player = {
      id: 'player / stage',
      name: 'Stage',
      active: true,
      key_configured: true,
      online: true,
      room_id: 'main',
      device: 'raspberry-pi',
      version: '1.2.3',
      caps: ['volume', 'mute'],
      volume: 75,
      muted: false,
      created_at: 1000,
      updated_at: 1200,
      last_seen_at: 1300,
      connected_at: 1234,
    };
    const credential = { player, key: 'yzp_secret' };
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ players: [player] }))
      .mockResolvedValueOnce(jsonResponse({ player }))
      .mockResolvedValueOnce(jsonResponse(credential, 201))
      .mockResolvedValueOnce(jsonResponse({ player: { ...player, name: 'Stage Left' } }))
      .mockResolvedValueOnce(jsonResponse(credential))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new ApiClient(() => 'admin-token', {
      base: 'https://yuzu.test',
      fetchFn,
    });

    await expect(client.listPlayers()).resolves.toEqual([player]);
    await expect(client.getPlayer(player.id)).resolves.toEqual(player);
    await expect(client.createPlayer({ id: player.id, name: player.name })).resolves.toEqual(
      credential,
    );
    await expect(client.updatePlayer(player.id, { name: 'Stage Left' })).resolves.toEqual({
      ...player,
      name: 'Stage Left',
    });
    await expect(client.rotatePlayerKey(player.id)).resolves.toEqual(credential);
    await expect(client.deletePlayer(player.id)).resolves.toBeUndefined();
    await expect(client.playerCommand(player.id, 'set_volume', 42)).resolves.toEqual({ ok: true });

    const encodedPlayer = 'player%20%2F%20stage';
    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      'https://yuzu.test/api/v1/players',
      `https://yuzu.test/api/v1/players/${encodedPlayer}`,
      'https://yuzu.test/api/v1/players',
      `https://yuzu.test/api/v1/players/${encodedPlayer}`,
      `https://yuzu.test/api/v1/players/${encodedPlayer}/key`,
      `https://yuzu.test/api/v1/players/${encodedPlayer}`,
      `https://yuzu.test/api/v1/players/${encodedPlayer}/command`,
    ]);
    expect(fetchFn.mock.calls[2][1]?.method).toBe('POST');
    expect(JSON.parse(String(fetchFn.mock.calls[2][1]?.body))).toEqual({
      id: player.id,
      name: player.name,
    });
    expect(fetchFn.mock.calls[3][1]?.method).toBe('PATCH');
    expect(JSON.parse(String(fetchFn.mock.calls[3][1]?.body))).toEqual({ name: 'Stage Left' });
    expect(fetchFn.mock.calls[4][1]?.method).toBe('POST');
    expect(fetchFn.mock.calls[5][1]?.method).toBe('DELETE');
    expect(JSON.parse(String(fetchFn.mock.calls[6][1]?.body))).toEqual({
      op: 'set_volume',
      value: 42,
    });
  });

  it('manages room output and multi-player assignments through room-scoped endpoints', async () => {
    const roomId = 'room /一';
    const player = {
      id: 'player / stage',
      name: 'Stage',
      active: true,
      bound: true,
      online: true,
      device: 'speaker-01',
      room_id: roomId,
      volume: 42,
      muted: false,
    };
    const offlinePlayer = {
      id: 'living-room-right',
      name: 'Living Room Right',
      active: true,
      bound: true,
      online: false,
      volume: 0,
      muted: false,
    };
    const outputUpdate = {
      output: { volume: 58, updated_at: 1_720_000_600_000 },
      delivery: { commands_sent: 2 },
    };
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ output: { volume: null } }))
      .mockResolvedValueOnce(jsonResponse(outputUpdate))
      .mockResolvedValueOnce(jsonResponse({ players: [player, offlinePlayer] }))
      .mockResolvedValueOnce(jsonResponse({ binding: { room_id: roomId, player_id: player.id }, player }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new ApiClient(() => 'admin-token', {
      base: 'https://yuzu.test',
      fetchFn,
    });

    await expect(client.roomOutput(roomId)).resolves.toEqual({ volume: null });
    await expect(client.setRoomOutputVolume(roomId, 58)).resolves.toEqual(outputUpdate);
    await expect(client.roomPlayers(roomId)).resolves.toEqual([player, offlinePlayer]);
    await expect(client.bindRoomPlayer(roomId, player.id)).resolves.toEqual(player);
    await expect(client.unbindRoomPlayer(roomId, player.id)).resolves.toBeUndefined();

    const encodedRoom = 'room%20%2F%E4%B8%80';
    const encodedPlayer = 'player%20%2F%20stage';
    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      `https://yuzu.test/api/v1/rooms/${encodedRoom}/output`,
      `https://yuzu.test/api/v1/rooms/${encodedRoom}/output`,
      `https://yuzu.test/api/v1/rooms/${encodedRoom}/players`,
      `https://yuzu.test/api/v1/rooms/${encodedRoom}/players/${encodedPlayer}`,
      `https://yuzu.test/api/v1/rooms/${encodedRoom}/players/${encodedPlayer}`,
    ]);
    expect(fetchFn.mock.calls[1][1]?.method).toBe('PATCH');
    expect(JSON.parse(String(fetchFn.mock.calls[1][1]?.body))).toEqual({ volume: 58 });
    expect(fetchFn.mock.calls[3][1]?.method).toBe('PUT');
    expect(fetchFn.mock.calls[3][1]?.body).toBeUndefined();
    expect(new Headers(fetchFn.mock.calls[3][1]?.headers).has('Content-Type')).toBe(false);
    expect(fetchFn.mock.calls[4][1]?.method).toBe('DELETE');
  });

  it('consumes capabilities and integration management wire contracts', async () => {
    const scope = {
      adapter_id: 'onebot/v11',
      scope_type: 'group',
      scope_id: 'group/42',
      room_id: 'room /一',
    };
    const subject = {
      adapter_id: scope.adapter_id,
      scope_type: scope.scope_type,
      scope_id: scope.scope_id,
      subject_id: 'user/7',
      principal_id: 'principal /七',
    };
    const grant = {
      room_id: scope.room_id,
      principal_id: subject.principal_id,
      capability: 'controller' as const,
    };
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ capabilities: { controller: true } }))
      .mockResolvedValueOnce(jsonResponse({ integrations: [{ id: 'bridge /一' }] }))
      .mockResolvedValueOnce(jsonResponse({ scopes: [{ integration_id: 'bridge /一', ...scope }] }))
      .mockResolvedValueOnce(jsonResponse({ subjects: [{ integration_id: 'bridge /一', ...subject }] }))
      .mockResolvedValueOnce(
        jsonResponse({
          principals: [
            { id: subject.principal_id, name: '柚子', kind: 'oidc', roles: [], active: true },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ grants: [grant] }))
      .mockResolvedValueOnce(jsonResponse({ scope: { integration_id: 'bridge /一', ...scope } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ grant }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new ApiClient(() => 'admin-token', {
      base: 'https://yuzu.test',
      fetchFn,
    });

    await expect(client.roomCapabilities(scope.room_id)).resolves.toEqual({ controller: true });
    await expect(client.listIntegrations()).resolves.toEqual([{ id: 'bridge /一' }]);
    await expect(client.listIntegrationScopes('bridge /一')).resolves.toEqual([
      { integration_id: 'bridge /一', ...scope },
    ]);
    await expect(client.listIntegrationSubjects('bridge /一')).resolves.toEqual([
      { integration_id: 'bridge /一', ...subject },
    ]);
    await expect(client.listPrincipals('柚 子', 25)).resolves.toHaveLength(1);
    await expect(client.listRoomGrants(scope.room_id)).resolves.toEqual([grant]);
    await expect(client.bindIntegrationScope('bridge /一', scope)).resolves.toEqual({
      integration_id: 'bridge /一',
      ...scope,
    });
    await expect(client.unlinkIntegrationSubject('bridge /一', subject)).resolves.toBeUndefined();
    await expect(
      client.grantRoomController(scope.room_id, subject.principal_id),
    ).resolves.toEqual(grant);
    await expect(
      client.revokeRoomController(scope.room_id, subject.principal_id),
    ).resolves.toBeUndefined();

    expect(fetchFn.mock.calls[0][0]).toBe(
      'https://yuzu.test/api/v1/rooms/room%20%2F%E4%B8%80/capabilities',
    );
    expect(fetchFn.mock.calls[2][0]).toBe(
      'https://yuzu.test/api/v1/integrations/bridge%20%2F%E4%B8%80/scopes',
    );
    expect(fetchFn.mock.calls[4][0]).toBe(
      'https://yuzu.test/api/v1/principals?q=%E6%9F%9A+%E5%AD%90&limit=25',
    );
    expect(fetchFn.mock.calls[6][1]?.method).toBe('PUT');
    expect(JSON.parse(String(fetchFn.mock.calls[6][1]?.body))).toEqual(scope);
    expect(fetchFn.mock.calls[7][1]?.method).toBe('DELETE');
    expect(JSON.parse(String(fetchFn.mock.calls[7][1]?.body))).toEqual(subject);
    expect(fetchFn.mock.calls[8][1]?.method).toBe('PUT');
    expect(JSON.parse(String(fetchFn.mock.calls[8][1]?.body))).toEqual(grant);
    expect(fetchFn.mock.calls[9][1]?.method).toBe('DELETE');
    expect(JSON.parse(String(fetchFn.mock.calls[9][1]?.body))).toEqual(grant);
  });

  it('manages the complete Integration credential lifecycle', async () => {
    const integration = {
      id: 'bridge /一',
      name: 'Bridge',
      active: true,
      created_at: 100,
      updated_at: 100,
    };
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ integration, token: 'new-token' }))
      .mockResolvedValueOnce(
        jsonResponse({ integration: { ...integration, name: 'Renamed', updated_at: 200 } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          integration: { ...integration, updated_at: 300 },
          token: 'rotated-token',
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new ApiClient(() => 'admin-token', {
      base: 'https://yuzu.test',
      fetchFn,
    });

    await expect(client.createIntegration(integration.id, integration.name)).resolves.toEqual({
      integration,
      token: 'new-token',
    });
    await expect(client.updateIntegration(integration.id, { name: 'Renamed' })).resolves.toEqual({
      ...integration,
      name: 'Renamed',
      updated_at: 200,
    });
    await expect(client.rotateIntegrationToken(integration.id)).resolves.toEqual({
      integration: { ...integration, updated_at: 300 },
      token: 'rotated-token',
    });
    await expect(client.deleteIntegration(integration.id)).resolves.toBeUndefined();

    const encodedId = 'bridge%20%2F%E4%B8%80';
    expect(fetchFn.mock.calls[0][0]).toBe('https://yuzu.test/api/v1/integrations');
    expect(fetchFn.mock.calls[0][1]?.method).toBe('POST');
    expect(JSON.parse(String(fetchFn.mock.calls[0][1]?.body))).toEqual({
      id: integration.id,
      name: integration.name,
    });
    expect(fetchFn.mock.calls[1][0]).toBe(
      `https://yuzu.test/api/v1/integrations/${encodedId}`,
    );
    expect(fetchFn.mock.calls[1][1]?.method).toBe('PATCH');
    expect(fetchFn.mock.calls[2][0]).toBe(
      `https://yuzu.test/api/v1/integrations/${encodedId}/token`,
    );
    expect(fetchFn.mock.calls[2][1]?.method).toBe('POST');
    expect(fetchFn.mock.calls[3][1]?.method).toBe('DELETE');
  });
  it('manages acceleration resources, credentials, status, and requests', async () => {
    const acceleration = {
      id: 'edgeone / main',
      name: 'EdgeOne',
      kind: 'edgeone',
      enabled: false,
      publish_on_cache_ready: true,
      control_base_url: 'https://edge.test/control',
      backend_base_url: 'https://edge.test/backend',
      lease_ttl_seconds: 600,
      upload_rate_bytes_per_second: 187500,
      max_object_bytes: 23 * 1024 * 1024,
      storage_budget_bytes: 850 * 1024 * 1024,
      storage_high_watermark_percent: 95,
      storage_low_watermark_percent: 85,
      inventory_interval_seconds: 900,
      inventory_stale_after_seconds: 1800,
      publisher_credential_configured: true,
      delivery_credential_configured: true,
      backend_credential_configured: true,
      publisher_credential_pending: false,
      delivery_credential_pending: false,
      backend_credential_pending: false,
      control_healthy: true,
      backend_healthy: true,
      created_at: 100,
      updated_at: 200,
    };
    const status = {
      acceleration,
      summary: { requested: 4, queued: 1, leased: 1, retry_wait: 0, cancel_requested: 0, ready: 2, canceled: 0 },
      inventory_scan: null,
      storage: {
        managed: true,
        budget_bytes: 850 * 1024 * 1024,
        high_watermark_percent: 95,
        low_watermark_percent: 85,
        accounted_bytes: 100,
        reserved_bytes: 20,
        observed_bytes: 110,
        object_count: 2,
        observed_object_count: 2,
        orphan_count: 0,
        missing_count: 0,
        pending_deletion_count: 0,
        pressure: 'normal',
      },
      publishers: [],
      active: [],
      counters: { requests: 4 },
      last_24_hours: { requests: 2 },
    };
    const request = {
      acceleration_id: acceleration.id,
      track_ref: 'ncm:42',
      state: 'ready',
      requested_at: 100,
      updated_at: 200,
      next_attempt_at: 0,
      attempts: 1,
    };
    const scan = {
      id: 'inv-1',
      acceleration_id: acceleration.id,
      state: 'queued',
      attempts: 1,
      requested_at: 100,
      updated_at: 200,
    };
    const canceledRequest = { ...request, state: 'canceled' };
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ accelerations: [acceleration] }))
      .mockResolvedValueOnce(jsonResponse({ acceleration }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            acceleration,
            credentials: {
              publisher_token: 'publisher-token',
              delivery_token: 'delivery-token',
              backend_token: 'backend-token',
            },
          },
          201,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ acceleration: { ...acceleration, name: 'Renamed' } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse(status))
      .mockResolvedValueOnce(jsonResponse({ requests: [request] }))
      .mockResolvedValueOnce(jsonResponse({ request }))
      .mockResolvedValueOnce(jsonResponse({ request: canceledRequest }))
      .mockResolvedValueOnce(jsonResponse({ scan }, 202))
      .mockResolvedValueOnce(jsonResponse({ storage: status.storage, scan }))
      .mockResolvedValueOnce(jsonResponse({ acceleration, token: 'pending-token' }))
      .mockResolvedValueOnce(jsonResponse({ acceleration }));
    const client = new ApiClient(() => 'admin-token', {
      base: 'https://yuzu.test',
      fetchFn,
    });

    await expect(client.listAccelerations()).resolves.toEqual([acceleration]);
    await expect(client.getAcceleration(acceleration.id)).resolves.toEqual(acceleration);
    await expect(
      client.createAcceleration({
        id: acceleration.id,
        name: acceleration.name,
        control_base_url: acceleration.control_base_url,
        backend_base_url: acceleration.backend_base_url,
      }),
    ).resolves.toMatchObject({ acceleration, credentials: expect.any(Object) });
    await expect(client.updateAcceleration(acceleration.id, { name: 'Renamed' })).resolves.toEqual({
      ...acceleration,
      name: 'Renamed',
    });
    await expect(client.deleteAcceleration(acceleration.id)).resolves.toBeUndefined();
    await expect(client.accelerationStatus(acceleration.id)).resolves.toEqual(status);
    await expect(client.accelerationRequests(acceleration.id, 'ready', 7)).resolves.toEqual({
      requests: [request],
    });
    await expect(client.accelerationRequest(acceleration.id, request.track_ref)).resolves.toEqual({ request });
    await expect(client.cancelAccelerationRequest(acceleration.id, request.track_ref)).resolves.toEqual({
      request: canceledRequest,
    });
    await expect(client.refreshAccelerationInventory(acceleration.id)).resolves.toEqual({ scan });
    await expect(client.accelerationInventoryStatus(acceleration.id)).resolves.toEqual({
      storage: status.storage,
      scan,
    });
    await expect(client.prepareAccelerationCredential(acceleration.id, 'publisher')).resolves.toEqual({
      acceleration,
      token: 'pending-token',
    });
    await expect(client.activateAccelerationCredential(acceleration.id, 'publisher')).resolves.toEqual({
      acceleration,
    });

    const encodedId = 'edgeone%20%2F%20main';
    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
      'https://yuzu.test/api/v1/accelerations',
      `https://yuzu.test/api/v1/accelerations/${encodedId}`,
      'https://yuzu.test/api/v1/accelerations',
      `https://yuzu.test/api/v1/accelerations/${encodedId}`,
      `https://yuzu.test/api/v1/accelerations/${encodedId}`,
      `https://yuzu.test/api/v1/accelerations/${encodedId}/status`,
      `https://yuzu.test/api/v1/accelerations/${encodedId}/requests?limit=7&state=ready`,
      `https://yuzu.test/api/v1/accelerations/${encodedId}/requests/ncm%3A42`,
      `https://yuzu.test/api/v1/accelerations/${encodedId}/requests/ncm%3A42`,
      `https://yuzu.test/api/v1/accelerations/${encodedId}/inventory/refresh`,
      `https://yuzu.test/api/v1/accelerations/${encodedId}/inventory/status`,
      `https://yuzu.test/api/v1/accelerations/${encodedId}/credentials/publisher/prepare`,
      `https://yuzu.test/api/v1/accelerations/${encodedId}/credentials/publisher/activate`,
    ]);
    expect(fetchFn.mock.calls[2][1]?.method).toBe('POST');
    expect(fetchFn.mock.calls[2][1]?.body).toContain('control_base_url');
    expect(fetchFn.mock.calls[3][1]?.method).toBe('PATCH');
    expect(fetchFn.mock.calls[4][1]?.method).toBe('DELETE');
    expect(fetchFn.mock.calls[8][1]?.method).toBe('DELETE');
    expect(fetchFn.mock.calls[9][1]?.method).toBe('POST');
    expect(fetchFn.mock.calls[11][1]?.method).toBe('POST');
    expect(fetchFn.mock.calls[12][1]?.method).toBe('POST');
  });
});
