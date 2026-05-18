import { describe, expect, test, vi } from 'vitest';
import { createGitHubCopilotOAuthFetch, hasVisionInput, isCopilotResponsesModel } from '../src/copilot-fetch';

describe('Copilot OAuth fetch', () => {
  test('routes browser chat requests through the local proxy without token exchange', async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { location: { origin: 'http://localhost:8081' } };
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const copilotFetch = createGitHubCopilotOAuthFetch({
      fetch,
      tokens: { githubToken: 'github-token' },
    });

    try {
      await copilotFetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ content: [{ type: 'image_url' }] }] }),
      });
    } finally {
      (globalThis as { window?: unknown }).window = originalWindow;
    }

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('http://localhost:8081/api/proxy/github-copilot/chat/completions');
    const headers = new Headers(fetch.mock.calls[0][1]?.headers);
    expect(headers.get('authorization')).toBe('Bearer github-token');
    expect(headers.get('copilot-vision-request')).toBeNull();
  });

  test('detects responses models', () => {
    expect(isCopilotResponsesModel('GPT-5.4')).toBe(true);
    expect(isCopilotResponsesModel('GPT-5-MINI')).toBe(false);
    expect(isCopilotResponsesModel('gpt-4.1')).toBe(false);
  });

  test('detects vision input in chat and responses bodies', () => {
    expect(hasVisionInput(JSON.stringify({ messages: [{ content: [{ type: 'image_url' }] }] }))).toBe(true);
    expect(hasVisionInput(JSON.stringify({ input: [{ content: [{ type: 'input_image' }] }] }))).toBe(true);
    expect(hasVisionInput(JSON.stringify({ messages: [{ content: [{ type: 'text' }] }] }))).toBe(false);
  });

  test('exchanges token and forwards chat completions request with Copilot headers', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'copilot-token', expires_at: 1_900_000_000 }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const copilotFetch = createGitHubCopilotOAuthFetch({
      fetch,
      tokens: { githubToken: 'github-token' },
    });

    await copilotFetch('https://example.test/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ content: [{ type: 'image_url' }] }] }),
    });

    expect(fetch).toHaveBeenNthCalledWith(1, 'https://api.github.com/copilot_internal/v2/token', expect.any(Object));
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://api.githubcopilot.com/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );

    const headers = new Headers(fetch.mock.calls[1][1]?.headers);
    expect(headers.get('authorization')).toBe('Bearer copilot-token');
    expect(headers.get('copilot-vision-request')).toBe('true');
    expect(headers.get('openai-intent')).toBe('conversation-edits');
    expect(headers.get('x-initiator')).toBe('user');
  });

  test('retries with GitHub OAuth token on exchanged token auth failure', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'copilot-token', expires_at: 1_900_000_000 }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const copilotFetch = createGitHubCopilotOAuthFetch({
      fetch,
      tokens: { githubToken: 'github-token' },
    });

    const response = await copilotFetch('/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: [] }),
    });

    expect(response.status).toBe(200);
    expect(new Headers(fetch.mock.calls[2][1]?.headers).get('authorization')).toBe('Bearer github-token');
  });
});
