import type { GitHubCopilotOAuthTokens, TokenStore } from './types';

/**
 * Create an in-memory token store.
 *
 * This is useful for tests and short-lived scripts. It does not persist tokens
 * across process restarts.
 */
export function createMemoryTokenStore(initial?: GitHubCopilotOAuthTokens): TokenStore {
  let current = initial;

  return {
    async load() {
      return current;
    },
    async save(tokens) {
      current = tokens;
    },
  };
}
