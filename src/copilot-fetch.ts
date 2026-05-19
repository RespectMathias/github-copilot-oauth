import { copilotBase } from './enterprise';
import { copilotHeaders, copilotModelHeaders } from './headers';
import { createMemoryTokenStore } from './memory-token-store';
import { exchangeGitHubCopilotToken } from './token-exchange';
import type { FetchLike, GitHubCopilotOAuthSettings, GitHubCopilotOAuthTokens, TokenStore } from './types';
import { GitHubCopilotOAuthError } from './types';

const DEFAULT_REFRESH_MARGIN_MS = 60 * 1000;
const DEFAULT_BROWSER_PROXY_BASE_URL = '/api/proxy/github-copilot';

type RequestParts = {
  url: string;
  method?: string;
  headers: Headers;
  body?: BodyInit | null;
  signal?: AbortSignal | null;
};

// Resolves fetch with fallback: custom override > globalThis.fetch > error.
function pickFetch(customFetch?: FetchLike): FetchLike {
  if (typeof customFetch === 'function') {
    return customFetch;
  }

  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis);
  }

  throw new GitHubCopilotOAuthError('fetch_required', 'A fetch implementation is required for GitHub Copilot OAuth.');
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}

function createStore(settings: GitHubCopilotOAuthSettings): TokenStore {
  if (settings.tokenStore) {
    return settings.tokenStore;
  }

  if (settings.tokens) {
    return createMemoryTokenStore(settings.tokens);
  }

  throw new GitHubCopilotOAuthError(
    'tokens_required',
    'GitHub Copilot OAuth tokens are required. Pass `tokens` or `tokenStore`.',
  );
}

class TokenManager {
  private inflight?: Promise<{ token: string; fromExchange: boolean }>;
  private current?: GitHubCopilotOAuthTokens;

  constructor(
    private readonly settings: GitHubCopilotOAuthSettings,
    private readonly store: TokenStore,
    private readonly fetch: FetchLike,
  ) {}

  async token(): Promise<{ token: string; fromExchange: boolean }> {
    if (this.inflight) {
      return this.inflight;
    }

    this.inflight = this.loadToken()
      .finally(() => {
        this.inflight = undefined;
      });
    return this.inflight;
  }

  async githubToken(): Promise<string> {
    const tokens = this.current ?? (await this.store.load());
    if (!tokens?.githubToken) {
      throw new GitHubCopilotOAuthError('auth_failed', 'GitHub Copilot OAuth token is missing.');
    }

    this.current = tokens;
    return tokens.githubToken;
  }

  private async loadToken(): Promise<{ token: string; fromExchange: boolean }> {
    let tokens = this.current ?? (await this.store.load());
    if (!tokens?.githubToken) {
      throw new GitHubCopilotOAuthError('auth_failed', 'GitHub Copilot OAuth token is missing.');
    }

    this.current = tokens;
    const margin = this.settings.tokenRefreshMarginMs ?? DEFAULT_REFRESH_MARGIN_MS;
    const expiresAt = tokens.copilotTokenExpiresAt ?? 0;
    if (tokens.copilotToken && (expiresAt <= 0 || expiresAt > Date.now() + margin)) {
      return { token: tokens.copilotToken, fromExchange: true };
    }

    try {
      const exchanged = await exchangeGitHubCopilotToken({
        fetch: this.fetch,
        githubToken: tokens.githubToken,
        enterpriseUrl: this.settings.enterpriseUrl ?? tokens.enterpriseUrl,
        allowEnterprise: this.settings.allowEnterprise,
      });
      tokens = {
        ...tokens,
        copilotToken: exchanged.token,
        copilotTokenExpiresAt: exchanged.expiresAt,
      };
      this.current = tokens;
      await this.store.save(tokens);
      await this.settings.onTokens?.(tokens);
      return { token: exchanged.token, fromExchange: true };
    } catch (error) {
      if (this.settings.fallbackToGitHubToken === false) {
        throw error;
      }

      return { token: tokens.githubToken, fromExchange: false };
    }
  }
}

async function readStoredTokens(settings: GitHubCopilotOAuthSettings): Promise<GitHubCopilotOAuthTokens | undefined> {
  if (settings.tokens) {
    return settings.tokens;
  }

  const tokenStore = settings.tokenStore as (TokenStore & {
    getTokens?: () => Promise<GitHubCopilotOAuthTokens | undefined>;
  }) | undefined;

  if (typeof tokenStore?.getTokens === 'function') {
    return tokenStore.getTokens();
  }

  return undefined;
}

async function resolveBaseURL(settings: GitHubCopilotOAuthSettings): Promise<string> {
  if (settings.baseURL) {
    return withoutTrailingSlash(settings.baseURL);
  }

  const storedTokens = await readStoredTokens(settings);
  const enterpriseUrl = settings.enterpriseUrl ?? settings.tokens?.enterpriseUrl ?? storedTokens?.enterpriseUrl;

  return withoutTrailingSlash(copilotBase(enterpriseUrl, settings));
}

// Normalizes an incoming OpenAI-compatible URL against a base URL.
// Strips /v1 prefix to map to Copilot API paths while preserving query strings.
function resolveTargetUrl(input: string, baseURL: string): string {
  const base = new URL(baseURL);
  const parsed = /^https?:\/\//.test(input) ? new URL(input) : new URL(input, 'https://copilot.invalid');
  let pathname = parsed.pathname;
  const basePath = withoutTrailingSlash(base.pathname);

  if (basePath && pathname.startsWith(`${basePath}/`)) {
    pathname = pathname.slice(basePath.length);
  }

  if (pathname === '/v1') {
    pathname = '/';
  } else if (pathname.startsWith('/v1/')) {
    pathname = pathname.slice(3);
  }

  if (!pathname.startsWith('/')) {
    pathname = `/${pathname}`;
  }

  return `${base.origin}${basePath}${pathname}${parsed.search}`;
}

function browserOrigin(): string | undefined {
  const maybeWindow = (globalThis as { window?: { location?: { origin?: string } } }).window;
  return typeof maybeWindow?.location?.origin === 'string' ? maybeWindow.location.origin.replace(/\/$/, '') : undefined;
}

// Resolves a browser proxy URL for Copilot API requests. Returns undefined in Node.js
// or when browser proxy is disabled. Strips the upstream base path so proxy can route correctly.
function resolveBrowserProxyUrl(target: URL, baseURL: string, settings: GitHubCopilotOAuthSettings): string | undefined {
  const origin = browserOrigin();
  if (!origin || settings.browserProxyBaseUrl === false) {
    return undefined;
  }

  const proxyBase = settings.browserProxyBaseUrl ?? DEFAULT_BROWSER_PROXY_BASE_URL;
  const absoluteProxyBase = /^https?:\/\//.test(proxyBase) ? proxyBase.replace(/\/$/, '') : `${origin}${proxyBase.startsWith('/') ? '' : '/'}${proxyBase}`.replace(/\/$/, '');
  const upstreamBasePath = withoutTrailingSlash(new URL(baseURL).pathname);
  let pathname = target.pathname;

  if (upstreamBasePath && pathname.startsWith(`${upstreamBasePath}/`)) {
    pathname = pathname.slice(upstreamBasePath.length);
  }

  return `${absoluteProxyBase}${pathname}${target.search}`;
}

async function readRequestParts(input: Parameters<FetchLike>[0], init?: Parameters<FetchLike>[1]): Promise<RequestParts> {
  if (input instanceof Request) {
    const headers = new Headers(input.headers);
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    return {
      url: input.url,
      method: init?.method ?? input.method,
      headers,
      body: init?.body ?? (input.body == null ? undefined : await input.clone().text()),
      signal: init?.signal ?? input.signal,
    };
  }

  return {
    url: String(input),
    method: init?.method,
    headers: new Headers(init?.headers),
    body: init?.body,
    signal: init?.signal,
  };
}

async function bodyToText(body: BodyInit | null | undefined): Promise<string | undefined> {
  if (body == null) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof FormData || body instanceof ReadableStream) return undefined;
  if (body instanceof Blob) return body.text();
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body);
  return undefined;
}

/** Return true when a chat/completions or responses JSON body contains image input. */
export function hasVisionInput(body: string): boolean {
  if (!body.trim()) {
    return false;
  }

  try {
    const payload = JSON.parse(body) as {
      messages?: { content?: { type?: string }[] }[];
      input?: { content?: { type?: string }[] }[];
    };

    const chatVision = payload.messages?.some(
      (item) => Array.isArray(item.content) && item.content.some((part) => part?.type === 'image_url'),
    );
    if (chatVision) {
      return true;
    }

    return Boolean(
      payload.input?.some((item) => Array.isArray(item.content) && item.content.some((part) => part?.type === 'input_image')),
    );
  } catch {
    return false;
  }
}

// Applies Copilot-specific headers. Detects vision capability from request body
// unless explicitly configured. Uses model headers for /models, chat headers otherwise.
function applyHeaders(headers: Headers, authToken: string, pathname: string, bodyText: string | undefined, settings: GitHubCopilotOAuthSettings) {
  const vision = settings.vision ?? (typeof bodyText === 'string' && hasVisionInput(bodyText));
  const authHeaders = pathname.endsWith('/models')
    ? copilotModelHeaders(authToken)
    : copilotHeaders(authToken, { vision, initiator: settings.initiator });

  headers.delete('authorization');
  for (const [key, value] of Object.entries(authHeaders)) {
    headers.set(key, value);
  }
}

/**
 * Create a fetch implementation that authenticates OpenAI-compatible requests
 * with GitHub Copilot OAuth credentials.
 */
export function createGitHubCopilotOAuthFetch(settings: GitHubCopilotOAuthSettings = {}): FetchLike {
  const fetch = pickFetch(settings.fetch);
  const store = createStore(settings);
  const manager = new TokenManager(settings, store, fetch);
  const baseURL = resolveBaseURL(settings);

  return async (input, init) => {
    const request = await readRequestParts(input, init);
    const targetUrl = resolveTargetUrl(request.url, baseURL);
    const target = new URL(targetUrl);
    const bodyText = await bodyToText(request.body);
    const body = bodyText ?? request.body;
    const headers = new Headers(settings.headers);

    request.headers.forEach((value, key) => headers.set(key, value));
    const proxyUrl = resolveBrowserProxyUrl(target, baseURL, settings);
    if (proxyUrl) {
      headers.delete('authorization');
      headers.set('Authorization', `Bearer ${await manager.githubToken()}`);
      const enterpriseUrl = settings.enterpriseUrl ?? settings.tokens?.enterpriseUrl;
      if (enterpriseUrl) headers.set('x-copilot-enterprise-url', enterpriseUrl);
      return fetch(proxyUrl, {
        method: request.method ?? init?.method,
        headers,
        body,
        signal: request.signal ?? undefined,
      });
    }

    const token = await manager.token();
    applyHeaders(headers, token.token, target.pathname, bodyText, settings);

    const response = await fetch(target.toString(), {
      method: request.method ?? init?.method,
      headers,
      body,
      signal: request.signal ?? undefined,
    });

    if (token.fromExchange && settings.fallbackToGitHubToken !== false && (response.status === 401 || response.status === 403)) {
      const fallbackHeaders = new Headers(headers);
      applyHeaders(fallbackHeaders, await manager.githubToken(), target.pathname, bodyText, settings);
      return fetch(target.toString(), {
        method: request.method ?? init?.method,
        headers: fallbackHeaders,
        body,
        signal: request.signal ?? undefined,
      });
    }

    return response;
  };
}

/** Create a small Copilot client around `createGitHubCopilotOAuthFetch`. */
export function createGitHubCopilotClient(settings: GitHubCopilotOAuthSettings = {}) {
  const baseURL = resolveBaseURL(settings);
  const fetch = createGitHubCopilotOAuthFetch(settings);

  return {
    baseURL,
    fetch,
    request: (path: string, init?: RequestInit) => fetch(resolveTargetUrl(path, baseURL), init),
  };
}

/** Route GPT-5 non-mini models to Copilot's Responses endpoint. */
export function isCopilotResponsesModel(modelId: string): boolean {
  const normalized = modelId.toLowerCase();
  const match = /^gpt-(\d+)/.exec(normalized);
  if (!match) {
    return false;
  }

  const generation = Number(match[1]);
  return generation >= 5 && !normalized.startsWith('gpt-5-mini');
}
