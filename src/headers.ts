import type { CopilotInitiator } from './types';

export const COPILOT_HEADERS = {
  'User-Agent': 'GitHubCopilotChat/0.35.0',
  'Editor-Version': 'vscode/1.107.0',
  'Editor-Plugin-Version': 'copilot-chat/0.35.0',
  'Copilot-Integration-Id': 'vscode-chat',
} as const;

/** Build headers for Copilot chat/completions and responses requests. */
export function copilotHeaders(accessToken: string, options?: { vision?: boolean; initiator?: CopilotInitiator }) {
  return {
    ...COPILOT_HEADERS,
    Authorization: `Bearer ${accessToken}`,
    'Openai-Intent': 'conversation-edits',
    'X-Initiator': options?.initiator ?? 'user',
    ...(options?.vision ? { 'Copilot-Vision-Request': 'true' } : {}),
  };
}

/** Build headers for Copilot model-list requests. */
export function copilotModelHeaders(accessToken: string) {
  return {
    ...COPILOT_HEADERS,
    Authorization: `Bearer ${accessToken}`,
  };
}

/** Build headers for GitHub's Copilot token exchange endpoint. */
export function copilotTokenExchangeHeaders(githubToken: string) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${githubToken}`,
    ...COPILOT_HEADERS,
  };
}
