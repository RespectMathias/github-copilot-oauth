/**
 * GitHub Copilot OAuth integration for AI SDK and OpenAI-compatible clients.
 *
 * Provides OAuth-based authentication for GitHub Copilot's language models,
 * including device flow for CLI/headless sign-in, token exchange for API tokens,
 * and fetch wrappers for OpenAI-compatible endpoints.
 */
export { createGitHubCopilotOAuthFetch, createGitHubCopilotClient, hasVisionInput, isCopilotResponsesModel } from './copilot-fetch';
export { DEFAULT_GITHUB_COPILOT_CLIENT_ID, startGitHubCopilotDeviceFlow } from './device-flow';
export { copilotBase, copilotTokenExchangeUrl, githubOAuthUrls, normalizeEnterpriseDomain } from './enterprise';
export { COPILOT_HEADERS, copilotHeaders, copilotModelHeaders, copilotTokenExchangeHeaders } from './headers';
export { createMemoryTokenStore } from './memory-token-store';
export { createGitHubCopilot } from './provider';
export { exchangeGitHubCopilotToken } from './token-exchange';
export type { GitHubCopilotModelId, GitHubCopilotProvider } from './provider';
export type {
  CopilotInitiator,
  FetchLike,
  GitHubCopilotDeviceFlow,
  GitHubCopilotDeviceFlowOptions,
  GitHubCopilotOAuthSettings,
  GitHubCopilotOAuthTokens,
  GitHubCopilotProviderSettings,
  TokenStore,
} from './types';
export { GitHubCopilotOAuthError } from './types';
