import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YuzuError } from '../protocol/types';
import { createOidcFlow } from './oidc';

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();

  get length(): number {
    return this.#values.size;
  }

  clear(): void {
    this.#values.clear();
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }
}

function encodeBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const config = {
  issuer: 'https://idp.example/',
  client_id: 'default-client',
  client_ids: ['default-client', 'web-client'],
};

describe('OIDC Authorization Code + PKCE flow', () => {
  beforeEach(() => {
    vi.stubGlobal('location', {
      href: 'https://app.example/login?from=lobby#top',
      assign: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates base64url PKCE values, redirects with authorization params, and exchanges the callback code', async () => {
    const storage = new MemoryStorage();
    const redirects: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/.well-known/openid-configuration')) {
        return new Response(
          JSON.stringify({
            authorization_endpoint: 'https://idp.example/oauth/v2/authorize',
            token_endpoint: 'https://idp.example/oauth/v2/token',
          }),
        );
      }
      expect(url).toBe('https://idp.example/oauth/v2/token');
      expect(init?.method).toBe('POST');
      return new Response(JSON.stringify({ id_token: 'signed-id-token', access_token: 'opaque-access' }));
    });
    const flow = createOidcFlow({
      storage,
      fetchFn: fetchMock as typeof fetch,
      redirectFn: (url) => redirects.push(url),
    });

    await flow.begin(config, {
      clientId: 'web-client',
      scopes: ['urn:zitadel:iam:org:projects:roles', 'profile'],
    });

    expect(redirects).toHaveLength(1);
    const authorizeUrl = new URL(redirects[0]);
    const verifier = storage.getItem('yuzu-oidc-verifier');
    const state = storage.getItem('yuzu-oidc-state');
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe('https://idp.example/oauth/v2/authorize');
    expect(authorizeUrl.searchParams.get('response_type')).toBe('code');
    expect(authorizeUrl.searchParams.get('client_id')).toBe('web-client');
    expect(authorizeUrl.searchParams.get('redirect_uri')).toBe('https://app.example/login');
    expect(authorizeUrl.searchParams.get('scope')).toBe(
      'openid profile urn:zitadel:iam:org:projects:roles',
    );
    expect(authorizeUrl.searchParams.get('state')).toBe(state);
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');

    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier!));
    expect(authorizeUrl.searchParams.get('code_challenge')).toBe(
      encodeBase64Url(new Uint8Array(digest)),
    );

    const callbackUrl = `https://app.example/login?code=auth-code&state=${state}`;
    const firstCallback = flow.handleCallback(callbackUrl);
    const duplicateCallback = flow.handleCallback(callbackUrl);
    await expect(Promise.all([firstCallback, duplicateCallback])).resolves.toEqual([
      { idToken: 'signed-id-token', accessToken: 'opaque-access' },
      { idToken: 'signed-id-token', accessToken: 'opaque-access' },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, tokenInit] = fetchMock.mock.calls[1];
    expect(new Headers(tokenInit?.headers).get('Content-Type')).toBe(
      'application/x-www-form-urlencoded',
    );
    const tokenBody = new URLSearchParams(String(tokenInit?.body));
    expect(Object.fromEntries(tokenBody)).toEqual({
      grant_type: 'authorization_code',
      code: 'auth-code',
      redirect_uri: 'https://app.example/login',
      client_id: 'web-client',
      code_verifier: verifier,
    });
    expect(storage.getItem('yuzu-oidc-state')).toBeNull();
    expect(storage.getItem('yuzu-oidc-verifier')).toBeNull();
  });

  it('rejects a mismatched callback state before token exchange', async () => {
    const storage = new MemoryStorage();
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          authorization_endpoint: 'https://idp.example/authorize',
          token_endpoint: 'https://idp.example/token',
        }),
      ),
    );
    const flow = createOidcFlow({
      storage,
      fetchFn: fetchMock as typeof fetch,
      redirectFn: vi.fn(),
    });
    await flow.begin(config);

    await expect(
      flow.handleCallback('https://app.example/login?code=auth-code&state=attacker'),
    ).rejects.toEqual(new YuzuError('bad_request', 'OIDC callback state does not match'));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('maps an authorization provider error after validating state', async () => {
    const storage = new MemoryStorage();
    const redirects: string[] = [];
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          authorization_endpoint: 'https://idp.example/authorize',
          token_endpoint: 'https://idp.example/token',
        }),
      ),
    );
    const flow = createOidcFlow({
      storage,
      fetchFn: fetchMock as typeof fetch,
      redirectFn: (url) => redirects.push(url),
    });
    await flow.begin(config);
    const state = new URL(redirects[0]).searchParams.get('state');

    await expect(
      flow.handleCallback(
        `https://app.example/login?error=access_denied&error_description=User+cancelled&state=${state}`,
      ),
    ).rejects.toEqual(new YuzuError('provider_error', 'User cancelled'));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('returns null for a URL that is not an OIDC callback', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const flow = createOidcFlow({
      storage: new MemoryStorage(),
      fetchFn: fetchMock,
      redirectFn: vi.fn(),
    });

    await expect(flow.handleCallback('https://app.example/lobby?room=main')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
