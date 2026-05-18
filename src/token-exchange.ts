import { copilotTokenExchangeUrl } from './enterprise';
import { copilotTokenExchangeHeaders } from './headers';
import type { FetchLike } from './types';
import { GitHubCopilotOAuthError } from './types';

/** Exchange a GitHub OAuth token for a short-lived GitHub Copilot API token. */
export async function exchangeGitHubCopilotToken({
  fetch,
  githubToken,
  enterpriseUrl,
  allowEnterprise,
}: {
  fetch: FetchLike;
  githubToken: string;
  enterpriseUrl?: string;
  allowEnterprise?: boolean;
}): Promise<{ token: string; expiresAt: number }> {
  const response = await fetch(copilotTokenExchangeUrl(enterpriseUrl, { allowEnterprise }), {
    headers: copilotTokenExchangeHeaders(githubToken),
  });

  if (!response.ok) {
    throw new GitHubCopilotOAuthError(
      'auth_failed',
      `GitHub Copilot token exchange failed (${response.status}).`,
    );
  }

  const payload = (await response.json()) as {
    token?: string;
    expires_at?: number;
  };

  if (!payload.token?.trim()) {
    throw new GitHubCopilotOAuthError('auth_failed', 'GitHub Copilot token exchange did not return a token.');
  }

  return {
    token: payload.token,
    expiresAt: (payload.expires_at ?? 0) * 1000,
  };
}
