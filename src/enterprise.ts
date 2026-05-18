import { GitHubCopilotOAuthError } from './types';

/** Normalize and validate a GitHub Enterprise hostname. Returns undefined for github.com. */
export function normalizeEnterpriseDomain(enterpriseUrl?: string, options: { allowEnterprise?: boolean } = {}): string | undefined {
  const value = enterpriseUrl?.trim();
  if (!value) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch (error) {
    throw new GitHubCopilotOAuthError('unsupported', 'Invalid GitHub Enterprise URL.', { cause: error });
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new GitHubCopilotOAuthError('unsupported', 'Invalid GitHub Enterprise URL protocol.');
  }

  if (parsed.username || parsed.password || parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new GitHubCopilotOAuthError('unsupported', 'GitHub Enterprise URL must be a hostname only.');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || isUnsafeEnterpriseHostname(hostname)) {
    throw new GitHubCopilotOAuthError('unsupported', 'Unsafe GitHub Enterprise hostname.');
  }

  if (hostname === 'github.com') {
    return undefined;
  }

  if (!options.allowEnterprise) {
    throw new GitHubCopilotOAuthError('unsupported', 'Custom GitHub Enterprise hosts are not enabled.');
  }

  return hostname;
}

// Blocks hostnames that could resolve to local development environments or be confused
// with loopback addresses. Prevents SSRF and local network access attacks.
function isUnsafeEnterpriseHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.includes(':') ||
    /^\d+(?:\.\d+){3}$/.test(hostname)
  );
}

/** Resolve the Copilot API base URL for github.com or a validated Enterprise hostname. */
export function copilotBase(enterpriseUrl?: string, options: { allowEnterprise?: boolean } = {}): string {
  const domain = normalizeEnterpriseDomain(enterpriseUrl, options);
  if (!domain) {
    return 'https://api.githubcopilot.com';
  }

  return `https://copilot-api.${domain}`;
}

/** Resolve the GitHub endpoint used to exchange OAuth tokens for Copilot API tokens. */
export function copilotTokenExchangeUrl(enterpriseUrl?: string, options: { allowEnterprise?: boolean } = {}): string {
  const domain = normalizeEnterpriseDomain(enterpriseUrl, options);
  if (!domain) {
    return 'https://api.github.com/copilot_internal/v2/token';
  }

  return `https://api.${domain}/copilot_internal/v2/token`;
}

/** Resolve the GitHub device OAuth endpoints for github.com or Enterprise. */
export function githubOAuthUrls(enterpriseUrl?: string, options: { allowEnterprise?: boolean } = {}) {
  const domain = normalizeEnterpriseDomain(enterpriseUrl, options) ?? 'github.com';
  return {
    domain,
    code: `https://${domain}/login/device/code`,
    token: `https://${domain}/login/oauth/access_token`,
  };
}
