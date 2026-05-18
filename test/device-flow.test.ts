import { describe, expect, test, vi } from 'vitest';
import { startGitHubCopilotDeviceFlow } from '../src/device-flow';
import { createMemoryTokenStore } from '../src/memory-token-store';

describe('GitHub Copilot device flow', () => {
  test('completes device flow and stores GitHub OAuth credentials', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            verification_uri: 'https://github.com/login/device',
            user_code: 'GITHUB-CODE',
            device_code: 'device-code',
            interval: 1,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'authorization_pending' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'github-token' }), { status: 200 }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const tokenStore = createMemoryTokenStore();

    const flow = await startGitHubCopilotDeviceFlow({ fetch, sleep, tokenStore });

    expect(flow.url).toBe('https://github.com/login/device');
    expect(flow.code).toBe('GITHUB-CODE');

    const tokens = await flow.complete();

    expect(tokens).toEqual({ githubToken: 'github-token' });
    await expect(tokenStore.load()).resolves.toEqual(tokens);
    expect(sleep).toHaveBeenCalledWith(4000);
  });

  test('handles slow_down polling response', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            verification_uri: 'https://github.com/login/device',
            user_code: 'GITHUB-CODE',
            device_code: 'device-code',
            interval: 1,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'slow_down', interval: 7 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'github-token' }), { status: 200 }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const flow = await startGitHubCopilotDeviceFlow({ fetch, sleep });
    await flow.complete();

    expect(sleep).toHaveBeenCalledWith(10000);
  });
});
