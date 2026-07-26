import type { OidcConfig } from '../api/types';
import { YuzuError } from '../protocol/types';

export interface OidcFlow {
  begin(cfg: OidcConfig, opts?: { scopes?: string[]; clientId?: string }): Promise<void>;
  handleCallback(url?: string): Promise<{ idToken: string; accessToken?: string } | null>;
}

interface OidcFlowOptions {
  storage?: Storage;
  fetchFn?: typeof fetch;
  redirectFn?: (url: string) => void;
}

interface DiscoveryDocument {
  authorization_endpoint: string;
  token_endpoint: string;
}

interface TokenResponse {
  id_token?: string;
  access_token?: string;
  error?: string;
  error_description?: string;
}

const STORAGE_PREFIX = 'yuzu-oidc-';
const STATE_KEY = `${STORAGE_PREFIX}state`;
const VERIFIER_KEY = `${STORAGE_PREFIX}verifier`;
const CLIENT_ID_KEY = `${STORAGE_PREFIX}client-id`;
const ISSUER_KEY = `${STORAGE_PREFIX}issuer`;
const REDIRECT_URI_KEY = `${STORAGE_PREFIX}redirect-uri`;
const FLOW_KEYS = [STATE_KEY, VERIFIER_KEY, CLIENT_ID_KEY, ISSUER_KEY, REDIRECT_URI_KEY] as const;

function encodeBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function randomBase64Url(): string {
  return encodeBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

export function createOidcFlow(opts: OidcFlowOptions = {}): OidcFlow {
  const storage = opts.storage ?? globalThis.sessionStorage;
  const fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
  const redirect = opts.redirectFn ?? ((url: string) => globalThis.location.assign(url));
  const discoveryCache = new Map<string, DiscoveryDocument>();

  const discover = async (issuer: string): Promise<DiscoveryDocument> => {
    const normalizedIssuer = issuer.replace(/\/$/, '');
    const cached = discoveryCache.get(normalizedIssuer);
    if (cached !== undefined) {
      return cached;
    }

    const response = await fetchFn(`${normalizedIssuer}/.well-known/openid-configuration`);
    if (!response.ok) {
      throw new YuzuError('provider_error', `OIDC discovery failed: HTTP ${response.status}`);
    }
    const document = (await response.json()) as Partial<DiscoveryDocument>;
    if (typeof document.authorization_endpoint !== 'string' || typeof document.token_endpoint !== 'string') {
      throw new YuzuError('provider_error', 'OIDC discovery document is missing endpoints');
    }
    const completeDocument: DiscoveryDocument = {
      authorization_endpoint: document.authorization_endpoint,
      token_endpoint: document.token_endpoint,
    };
    discoveryCache.set(normalizedIssuer, completeDocument);
    return completeDocument;
  };

  return {
    async begin(cfg, beginOpts = {}) {
      const discovery = await discover(cfg.issuer);
      const verifier = randomBase64Url();
      const state = randomBase64Url();
      const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
      const challenge = encodeBase64Url(new Uint8Array(digest));
      const callbackUrl = new URL(globalThis.location.href);
      callbackUrl.search = '';
      callbackUrl.hash = '';
      const clientId = beginOpts.clientId ?? cfg.client_id;

      storage.setItem(STATE_KEY, state);
      storage.setItem(VERIFIER_KEY, verifier);
      storage.setItem(CLIENT_ID_KEY, clientId);
      storage.setItem(ISSUER_KEY, cfg.issuer);
      storage.setItem(REDIRECT_URI_KEY, callbackUrl.href);

      const scopes = [...new Set(['openid', 'profile', ...(beginOpts.scopes ?? [])])];
      const authorizationUrl = new URL(discovery.authorization_endpoint);
      authorizationUrl.searchParams.set('response_type', 'code');
      authorizationUrl.searchParams.set('client_id', clientId);
      authorizationUrl.searchParams.set('redirect_uri', callbackUrl.href);
      authorizationUrl.searchParams.set('scope', scopes.join(' '));
      authorizationUrl.searchParams.set('state', state);
      authorizationUrl.searchParams.set('code_challenge', challenge);
      authorizationUrl.searchParams.set('code_challenge_method', 'S256');
      redirect(authorizationUrl.href);
    },

    async handleCallback(url) {
      const fallbackUrl = globalThis.location?.href ?? 'http://localhost/';
      const callbackUrl = new URL(url ?? fallbackUrl, fallbackUrl);
      const code = callbackUrl.searchParams.get('code');
      const returnedState = callbackUrl.searchParams.get('state');
      const providerError = callbackUrl.searchParams.get('error');
      if (code === null && returnedState === null && providerError === null) {
        return null;
      }

      const expectedState = storage.getItem(STATE_KEY);
      if (expectedState === null || returnedState !== expectedState) {
        throw new YuzuError('bad_request', 'OIDC callback state does not match');
      }

      const verifier = storage.getItem(VERIFIER_KEY);
      const clientId = storage.getItem(CLIENT_ID_KEY);
      const issuer = storage.getItem(ISSUER_KEY);
      const redirectUri = storage.getItem(REDIRECT_URI_KEY);
      for (const key of FLOW_KEYS) {
        storage.removeItem(key);
      }

      if (providerError !== null) {
        const description = callbackUrl.searchParams.get('error_description');
        throw new YuzuError('provider_error', description ?? providerError);
      }
      if (code === null || verifier === null || clientId === null || issuer === null || redirectUri === null) {
        throw new YuzuError('bad_request', 'OIDC callback has no matching login flow');
      }

      const discovery = await discover(issuer);
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
      });
      const response = await fetchFn(discovery.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const token = (await response.json().catch(() => ({}))) as TokenResponse;
      if (!response.ok || typeof token.id_token !== 'string') {
        throw new YuzuError(
          'provider_error',
          token.error_description ?? token.error ?? `OIDC token exchange failed: HTTP ${response.status}`,
        );
      }
      return token.access_token === undefined
        ? { idToken: token.id_token }
        : { idToken: token.id_token, accessToken: token.access_token };
    },
  };
}
