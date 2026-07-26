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
});
