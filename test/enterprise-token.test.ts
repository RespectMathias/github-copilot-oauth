import { describe, expect, test, vi } from 'vitest';
import { copilotBase, normalizeEnterpriseDomain } from '../src/enterprise';
import { exchangeGitHubCopilotToken } from '../src/token-exchange';

describe('enterprise and token exchange', () => {
  test('normalizes github.com and rejects custom enterprise by default', () => {
    expect(normalizeEnterpriseDomain('https://github.com')).toBeUndefined();
    expect(() => normalizeEnterpriseDomain('company.ghe.com')).toThrow('Custom GitHub Enterprise hosts are not enabled.');
  });

  test('allows validated enterprise when enabled', () => {
    expect(normalizeEnterpriseDomain('https://company.ghe.com/', { allowEnterprise: true })).toBe('company.ghe.com');
    expect(copilotBase('company.ghe.com', { allowEnterprise: true })).toBe('https://copilot-api.company.ghe.com');
  });

  test('exchanges GitHub token for Copilot API token', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: 'copilot-token', expires_at: 1_900_000_000 }), { status: 200 }),
    );

    const result = await exchangeGitHubCopilotToken({ fetch, githubToken: 'github-token' });

    expect(result).toEqual({ token: 'copilot-token', expiresAt: 1_900_000_000_000 });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/copilot_internal/v2/token',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer github-token',
        }),
      }),
    );
  });
});
