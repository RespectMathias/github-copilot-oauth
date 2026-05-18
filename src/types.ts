export type FetchLike = typeof globalThis.fetch;

/** GitHub OAuth credentials plus optional short-lived Copilot API token. Treat these as account credentials. */
export type GitHubCopilotOAuthTokens = {
  /** GitHub OAuth access token returned by the device flow. Used to mint Copilot API tokens. */
  githubToken: string;
  /** Short-lived token returned by GitHub's Copilot token exchange endpoint. */
  copilotToken?: string;
  /** Copilot API token expiry as epoch milliseconds. */
  copilotTokenExpiresAt?: number;
  /** Optional validated GitHub Enterprise hostname. Omitted for github.com. */
  enterpriseUrl?: string;
};

/** Async storage interface for loading and persisting GitHub Copilot OAuth credentials. */
export type TokenStore = {
  /** Load the latest credentials. Return `undefined` when the user is not signed in. */
  load(): Promise<GitHubCopilotOAuthTokens | undefined>;
  /** Persist credentials after sign-in or Copilot token exchange. */
  save(tokens: GitHubCopilotOAuthTokens): Promise<void>;
};

/** In-progress GitHub Copilot device authorization flow. */
export type GitHubCopilotDeviceFlow = {
  providerId: 'github-copilot';
  /** URL the user should open to authorize the device flow. */
  url: string;
  /** User code to enter on the authorization page. */
  code: string;
  /** Human-readable instruction string for command-line or app UI. */
  instructions: string;
  /** Poll until authorization completes and return GitHub OAuth credentials. */
  complete(): Promise<GitHubCopilotOAuthTokens>;
};

/** Options for starting GitHub Copilot's device OAuth flow. */
export type GitHubCopilotDeviceFlowOptions = {
  /** Custom fetch implementation, useful for tests and non-standard runtimes. */
  fetch?: FetchLike;
  /** Sleep override used between polling attempts. */
  sleep?: (ms: number) => Promise<void>;
  /** OAuth client id. Defaults to the GitHub Copilot Chat client id. */
  clientId?: string;
  /** Optional GitHub Enterprise hostname. Custom hosts require `allowEnterprise: true`. */
  enterpriseUrl?: string;
  /** Allow validated custom GitHub Enterprise hostnames. Defaults to false. */
  allowEnterprise?: boolean;
  /** Optional store that receives credentials after successful authorization. */
  tokenStore?: TokenStore;
};

/** Shared settings for Copilot fetch and AI SDK provider creation. */
export type GitHubCopilotOAuthSettings = {
  /** Custom fetch implementation for both token exchange and Copilot API requests. */
  fetch?: FetchLike;
  /** Secure token storage used to load and save exchanged Copilot tokens. */
  tokenStore?: TokenStore;
  /** Inline tokens for scripts/tests. Prefer `tokenStore` for production apps. */
  tokens?: GitHubCopilotOAuthTokens;
  /** Optional GitHub Enterprise hostname. Custom hosts require `allowEnterprise: true`. */
  enterpriseUrl?: string;
  /** Allow validated custom GitHub Enterprise hostnames. Defaults to false. */
  allowEnterprise?: boolean;
  /** Copilot API base URL override. Defaults to GitHub's public Copilot API. */
  baseURL?: string;
  /** Browser proxy base URL for Copilot API requests. Defaults to `/api/proxy/github-copilot` in browsers. Pass `false` to disable. */
  browserProxyBaseUrl?: string | false;
  /** Additional headers sent to the Copilot API before Copilot auth headers are applied. */
  headers?: Record<string, string>;
  /** `X-Initiator` header. Defaults to `user`. */
  initiator?: CopilotInitiator;
  /** Force `Copilot-Vision-Request` on or off. When omitted, image inputs are detected from JSON bodies. */
  vision?: boolean;
  /** Refresh Copilot API token this many milliseconds before expiry. */
  tokenRefreshMarginMs?: number;
  /** Allow fallback to the GitHub OAuth token if Copilot token exchange fails or gets 401/403. Defaults to true. */
  fallbackToGitHubToken?: boolean;
  /** Called after a successful Copilot token exchange. */
  onTokens?: (tokens: GitHubCopilotOAuthTokens) => void | Promise<void>;
};

/** Settings for the AI SDK provider factory. */
export type GitHubCopilotProviderSettings = GitHubCopilotOAuthSettings & {
  /** Provider name exposed to AI SDK telemetry and metadata. */
  name?: string;
};

export type CopilotInitiator = 'user' | 'agent';

/** Error class used for OAuth, token, and credential setup failures. */
export class GitHubCopilotOAuthError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'GitHubCopilotOAuthError';
    this.code = code;
  }
}
