import { githubOAuthUrls } from './enterprise';
import type { FetchLike, GitHubCopilotDeviceFlow, GitHubCopilotDeviceFlowOptions, GitHubCopilotOAuthTokens } from './types';
import { GitHubCopilotOAuthError } from './types';

export const DEFAULT_GITHUB_COPILOT_CLIENT_ID = 'Ov23li8tweQw6odWQebz';
// Adds buffer to server-provided interval to avoid race condition on slow responses.
const POLL_BUFFER_MS = 3000;

function pickFetch(customFetch?: FetchLike): FetchLike {
  if (typeof customFetch === 'function') {
    return customFetch;
  }

  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis);
  }

  throw new GitHubCopilotOAuthError('fetch_required', 'A fetch implementation is required for GitHub Copilot OAuth.');
}

/**
 * Start GitHub Copilot's device OAuth flow.
 *
 * The returned flow contains a URL and user code for authorization. Call
 * `flow.complete()` after showing those values to poll for authorization and
 * return the GitHub OAuth token used to mint Copilot API tokens.
 */
export async function startGitHubCopilotDeviceFlow(
  options: GitHubCopilotDeviceFlowOptions = {},
): Promise<GitHubCopilotDeviceFlow> {
  const fetch = pickFetch(options.fetch);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const clientId = options.clientId ?? DEFAULT_GITHUB_COPILOT_CLIENT_ID;
  const urls = githubOAuthUrls(options.enterpriseUrl, { allowEnterprise: options.allowEnterprise });

  const codeResponse = await fetch(urls.code, {
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

  if (!codeResponse.ok) {
    throw new GitHubCopilotOAuthError('auth_failed', 'Failed to initiate GitHub Copilot authorization.');
  }

  const code = (await codeResponse.json()) as {
    verification_uri?: string;
    user_code?: string;
    device_code?: string;
    interval?: number;
  };

  if (!code.verification_uri || !code.user_code || !code.device_code) {
    throw new GitHubCopilotOAuthError('auth_failed', 'GitHub Copilot authorization response did not include a device code.');
  }

  return {
    providerId: 'github-copilot',
    url: code.verification_uri,
    code: code.user_code,
    instructions: `Enter code: ${code.user_code}`,
    async complete() {
      while (true) {
        const tokenResponse = await fetch(urls.token, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            client_id: clientId,
            device_code: code.device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
        });

        if (!tokenResponse.ok) {
          throw new GitHubCopilotOAuthError('auth_failed', 'GitHub Copilot OAuth authorization failed.');
        }

        const token = (await tokenResponse.json()) as {
          access_token?: string;
          error?: string;
          interval?: number;
        };

        if (token.access_token) {
          const result: GitHubCopilotOAuthTokens = {
            githubToken: token.access_token,
            ...(urls.domain === 'github.com' ? {} : { enterpriseUrl: urls.domain }),
          };
          await options.tokenStore?.save(result);
          return result;
        }

        if (token.error === 'authorization_pending') {
          await sleep((code.interval ?? 5) * 1000 + POLL_BUFFER_MS);
          continue;
        }

        if (token.error === 'slow_down') {
          const nextInterval = token.interval && token.interval > 0 ? token.interval : (code.interval ?? 5) + 5;
          await sleep(nextInterval * 1000 + POLL_BUFFER_MS);
          continue;
        }

        throw new GitHubCopilotOAuthError('auth_failed', 'GitHub Copilot OAuth authorization failed.');
      }
    },
  };
}
