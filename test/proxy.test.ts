import { describe, expect, test, vi } from 'vitest';
import { createGitHubCopilotProxy } from '../src/proxy';

describe('GitHub Copilot proxy handlers', () => {
  test('forwards device code request', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user_code: 'CODE' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const proxy = createGitHubCopilotProxy({ fetch });

    const response = await proxy.deviceCode(new Request('http://localhost/api/device/code', { method: 'POST' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ user_code: 'CODE' });
    expect(fetch).toHaveBeenCalledWith('https://github.com/login/device/code', expect.objectContaining({ method: 'POST' }));
  });

  test('forwards token request', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'github-token' }), { status: 200 }));
    const proxy = createGitHubCopilotProxy({ fetch });

    const response = await proxy.deviceToken(
      new Request('http://localhost/api/device/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_code: 'device-123' }),
      }),
    );

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'https://github.com/login/oauth/access_token',
      expect.objectContaining({ body: expect.stringContaining('device-123') }),
    );
  });

  test('proxies models with token exchange', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'copilot-token', expires_at: 1_900_000_000 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const proxy = createGitHubCopilotProxy({ fetch });

    const response = await proxy.models(
      new Request('http://localhost/api/models', {
        headers: { authorization: 'Bearer github-token' },
      }),
    );

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenNthCalledWith(2, 'https://api.githubcopilot.com/models', expect.any(Object));
    expect(new Headers(fetch.mock.calls[1][1]?.headers).get('authorization')).toBe('Bearer copilot-token');
  });

  test('proxies chat completions with vision header', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'copilot-token', expires_at: 1_900_000_000 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    const proxy = createGitHubCopilotProxy({ fetch });

    await proxy.chatCompletions(
      new Request('http://localhost/api/chat/completions', {
        method: 'POST',
        headers: { authorization: 'Bearer github-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ content: [{ type: 'image_url' }] }] }),
      }),
    );

    const headers = new Headers(fetch.mock.calls[1][1]?.headers);
    expect(fetch.mock.calls[1][0]).toBe('https://api.githubcopilot.com/chat/completions');
    expect(headers.get('copilot-vision-request')).toBe('true');
  });
});
