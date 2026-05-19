import { githubOAuthUrls, normalizeEnterpriseDomain, copilotBase } from './enterprise';
import { copilotHeaders, copilotModelHeaders } from './headers';
import { exchangeGitHubCopilotToken } from './token-exchange';
import { DEFAULT_GITHUB_COPILOT_CLIENT_ID } from './device-flow';
import { GitHubCopilotOAuthError, type FetchLike } from './types';
import { hasVisionInput } from './copilot-fetch';

export type GitHubCopilotProxyOptions = {
  /** Custom fetch implementation. Defaults to global fetch. */
  fetch?: FetchLike;
  /** OAuth client id. Defaults to the GitHub Copilot Chat client id. */
  clientId?: string;
  /** Allow validated custom GitHub Enterprise hostnames. Defaults to false. */
  allowEnterprise?: boolean;
};

function pickFetch(customFetch?: FetchLike): FetchLike {
  if (typeof customFetch === 'function') return customFetch;
  if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
  throw new GitHubCopilotOAuthError('fetch_required', 'A fetch implementation is required for GitHub Copilot proxy handlers.');
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function passthroughJson(response: Response): Response {
  return new Response(response.body, {
    status: response.status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

// Extracts token from Authorization header. Rejects non-Bearer schemes.
function parseBearer(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  return match ? match[1].trim() : '';
}

// Extracts enterprise URL from request: header > query param > undefined.
function enterpriseFromRequest(request: Request, options: GitHubCopilotProxyOptions): string | undefined {
  const fromHeader = request.headers.get('x-copilot-enterprise-url') ?? '';
  if (fromHeader.trim()) {
    return normalizeEnterpriseDomain(fromHeader, options);
  }

  const fromQuery = new URL(request.url).searchParams.get('enterpriseUrl') ?? '';
  if (fromQuery.trim()) {
    return normalizeEnterpriseDomain(fromQuery, options);
  }

  return undefined;
}

function errorResponse(error: unknown): Response {
  const status = error instanceof GitHubCopilotOAuthError
    ? error.code === 'unsupported'
      ? 400
      : error.code === 'auth_failed'
        ? 401
        : 502
    : 502;
  const message = error instanceof Error ? error.message : 'GitHub Copilot request failed.';
  return jsonResponse({ message }, status);
}

// Exchanges GitHub token for Copilot token, then calls `run`. Falls back to the
// original GitHub token on 401/403 if exchange succeeded (allows Copilot API retry).
async function withCopilotToken(
  request: Request,
  options: GitHubCopilotProxyOptions,
  run: (input: { token: string; enterpriseUrl?: string }) => Promise<Response>,
): Promise<Response> {
  const fetch = pickFetch(options.fetch);
  const refreshToken = parseBearer(request.headers.get('authorization') ?? '');
  if (!refreshToken) {
    return jsonResponse({ message: 'Missing GitHub Copilot OAuth token.' }, 401);
  }

  const enterpriseUrl = enterpriseFromRequest(request, options);
  let token = refreshToken;

  try {
    const exchanged = await exchangeGitHubCopilotToken({
      fetch,
      githubToken: refreshToken,
      enterpriseUrl,
      allowEnterprise: options.allowEnterprise,
    });
    token = exchanged.token;
  } catch {
  }

  const primary = await run({ token, enterpriseUrl });
  if (token !== refreshToken && (primary.status === 401 || primary.status === 403)) {
    return run({ token: refreshToken, enterpriseUrl });
  }

  return primary;
}

/** Create framework-agnostic fetch handlers for browser-safe OAuth/proxy routes. */
export function createGitHubCopilotProxy(options: GitHubCopilotProxyOptions = {}) {
  const fetch = pickFetch(options.fetch);
  const clientId = options.clientId ?? DEFAULT_GITHUB_COPILOT_CLIENT_ID;

  return {
    async deviceCode(request: Request): Promise<Response> {
      try {
        const enterpriseUrl = enterpriseFromRequest(request, options);
        const urls = githubOAuthUrls(enterpriseUrl, options);
        const response = await fetch(urls.code, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            client_id: clientId,
            scope: 'read:user',
          }),
        });
        return passthroughJson(response);
      } catch (error) {
        return errorResponse(error);
      }
    },

    async deviceToken(request: Request): Promise<Response> {
      try {
        const payload = (await request.json().catch(() => ({}))) as { device_code?: string; grant_type?: string };
        const enterpriseUrl = enterpriseFromRequest(request, options);
        const urls = githubOAuthUrls(enterpriseUrl, options);
        const response = await fetch(urls.token, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            client_id: clientId,
            device_code: payload.device_code ?? '',
            grant_type: payload.grant_type ?? 'urn:ietf:params:oauth:grant-type:device_code',
          }),
        });
        return passthroughJson(response);
      } catch (error) {
        return errorResponse(error);
      }
    },

    async models(request: Request): Promise<Response> {
      try {
        const upstream = await withCopilotToken(request, options, ({ token, enterpriseUrl }) =>
          fetch(`${copilotBase(enterpriseUrl, options)}/models`, {
            headers: copilotModelHeaders(token),
          }),
        );
        return passthroughJson(upstream);
      } catch (error) {
        return errorResponse(error);
      }
    },

    async chatCompletions(request: Request): Promise<Response> {
      return proxyPost(request, 'chat/completions');
    },

    async responses(request: Request): Promise<Response> {
      return proxyPost(request, 'responses');
    },
  };

  async function proxyPost(request: Request, path: 'chat/completions' | 'responses'): Promise<Response> {
    const body = await request.text();
    try {
      const upstream = await withCopilotToken(request, options, ({ token, enterpriseUrl }) =>
        fetch(`${copilotBase(enterpriseUrl, options)}/${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...copilotHeaders(token, {
              vision: hasVisionInput(body),
              initiator: 'user',
            }),
          },
          body,
        }),
      );
      return passthroughJson(upstream);
    } catch (error) {
      return errorResponse(error);
    }
  }
}
