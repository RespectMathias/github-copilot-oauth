import { createOpenAI } from '@ai-sdk/openai';
import { describe, expect, test, vi } from 'vitest';

import { createGitHubCopilot } from '../src/provider';

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => ({
    chat: vi.fn(() => ({ provider: 'github-copilot.chat' })),
    responses: vi.fn(() => ({ provider: 'github-copilot.responses' })),
  })),
}));

describe('createGitHubCopilot', () => {
  test('passes a placeholder api key so the OpenAI SDK does not require OPENAI_API_KEY', () => {
    createGitHubCopilot({
      tokens: {
        githubToken: 'github-token',
      },
    });

    expect(createOpenAI).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'oauth',
    }));
  });
});
