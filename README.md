# github-copilot-oauth

GitHub Copilot OAuth provider and token helpers for the Vercel AI SDK.

This package lets local apps use a user's GitHub Copilot OAuth session with AI SDK functions such as `generateText` and `streamText`. It handles GitHub device OAuth, GitHub-to-Copilot token exchange, Copilot request headers, and OpenAI-compatible AI SDK provider creation.

It is unofficial and is not affiliated with, endorsed by, or sponsored by GitHub.

## Install

```bash
npm install github-copilot-oauth ai @ai-sdk/openai @ai-sdk/provider
```

## Quick Start

```ts
import { generateText } from 'ai';
import { createGitHubCopilot } from 'github-copilot-oauth';

const copilot = createGitHubCopilot({
  tokens: {
    githubToken: process.env.GITHUB_COPILOT_OAUTH_TOKEN!,
  },
});

const result = await generateText({
  model: copilot('gpt-4.1'),
  prompt: 'Reply with exactly: hello',
});

console.log(result.text);
```

## Sign In With Device OAuth

```ts
import { startGitHubCopilotDeviceFlow } from 'github-copilot-oauth';

const flow = await startGitHubCopilotDeviceFlow();

console.log(`Open ${flow.url}`);
console.log(`Enter code ${flow.code}`);

const tokens = await flow.complete();
```

`flow.complete()` polls until the user authorizes the code and returns:

```ts
type GitHubCopilotOAuthTokens = {
  githubToken: string;
  copilotToken?: string;
  copilotTokenExpiresAt?: number;
  enterpriseUrl?: string;
};
```

Persist these tokens in secure storage. The `githubToken` is used to mint short-lived Copilot API tokens.

## Token Store

For real apps, prefer a `TokenStore` over hard-coded env values. The provider loads tokens lazily, exchanges the GitHub token for a short-lived Copilot API token, then saves the exchanged token back through the same store.

```ts
import { createGitHubCopilot, type TokenStore } from 'github-copilot-oauth';

const tokenStore: TokenStore = {
  async load() {
    const raw = await secureStore.get('github-copilot-oauth');
    return raw ? JSON.parse(raw) : undefined;
  },
  async save(tokens) {
    await secureStore.set('github-copilot-oauth', JSON.stringify(tokens));
  },
};

const copilot = createGitHubCopilot({ tokenStore });
```

## Streaming

```ts
import { streamText } from 'ai';
import { createGitHubCopilot } from 'github-copilot-oauth';

const copilot = createGitHubCopilot({ tokenStore });

const result = streamText({
  model: copilot('gpt-4.1'),
  prompt: 'Write one sentence about the moon.',
});

for await (const delta of result.textStream) {
  process.stdout.write(delta);
}
```

## Model Routing

The callable provider routes models using the behavior from Tolksyn's working integration:

- `gpt-5` and newer non-mini models use Copilot's `/responses` endpoint.
- `gpt-4` models and `gpt-5-mini` use `/chat/completions`.

You can override routing explicitly:

```ts
const chatModel = copilot.chat('gpt-4.1');
const responsesModel = copilot.responses('gpt-5.4');
```

## Browser/Web Proxy Handlers

Browsers should not call GitHub OAuth or Copilot token endpoints directly. Use the proxy helpers from `github-copilot-oauth/proxy` in server routes.

```ts
import { createGitHubCopilotProxy } from 'github-copilot-oauth/proxy';

const proxy = createGitHubCopilotProxy();

export const deviceCode = proxy.deviceCode;
export const deviceToken = proxy.deviceToken;
export const models = proxy.models;
export const chatCompletions = proxy.chatCompletions;
export const responses = proxy.responses;
```

The proxy expects browser API requests to send the GitHub OAuth token as `Authorization: Bearer <token>`. It exchanges that token server-side and forwards to the Copilot API.

In browser runtimes, `createGitHubCopilotOAuthFetch` automatically routes Copilot API calls through `/api/proxy/github-copilot` unless `browserProxyBaseUrl: false` is set. This avoids direct Copilot API CORS failures and keeps Copilot token exchange on the server route.

## Credential Safety

GitHub Copilot OAuth tokens are account credentials.

- Do store tokens in OS keychain storage, encrypted app storage, or a trusted server-side secret store.
- Do not store tokens in browser `localStorage`, plaintext app config, Git, logs, analytics, crash reports, or build output.
- Do not expose this provider from a shared hosted API unless each user has isolated storage and authorization.
- Do not pool, proxy, or redistribute tokens across users.
- Use `tokenStore` in production so exchanged Copilot tokens are persisted and reused until expiry.
- Pass `tokens` directly only for short-lived scripts, tests, or already-secured server runtime secrets.

The package does not phone home, does not persist tokens unless you provide a `TokenStore`, and does not log tokens.

## API

### `createGitHubCopilot(settings)`

Creates an AI SDK provider. The provider is callable:

```ts
const model = copilot('gpt-4.1');
```

Important settings:

- `tokens`: in-memory credentials for scripts/tests.
- `tokenStore`: async credential store used for loading and saving exchanged tokens.
- `fetch`: custom fetch implementation.
- `baseURL`: Copilot API base URL. Defaults to `https://api.githubcopilot.com`.
- `browserProxyBaseUrl`: browser proxy base URL. Defaults to `/api/proxy/github-copilot`; pass `false` to disable browser proxy routing.
- `enterpriseUrl`: optional GitHub Enterprise hostname.
- `allowEnterprise`: allow validated custom GitHub Enterprise hostnames. Defaults to `false`.
- `headers`: additional upstream headers.
- `initiator`: `X-Initiator` header. Defaults to `user`.
- `vision`: force the `Copilot-Vision-Request` header. Otherwise image input is detected from JSON.
- `fallbackToGitHubToken`: fallback to the GitHub OAuth token when exchange fails or returns an unusable token. Defaults to `true`.
- `onTokens`: callback invoked after a successful Copilot token exchange.

### `startGitHubCopilotDeviceFlow(options)`

Starts GitHub's device OAuth flow and returns `{ url, code, instructions, complete }`.

### `exchangeGitHubCopilotToken(options)`

Exchanges a GitHub OAuth token for a short-lived Copilot API token.

### `createGitHubCopilotOAuthFetch(settings)`

Creates a `fetch` implementation that rewrites OpenAI-compatible paths, exchanges tokens, and injects Copilot headers.

In browsers, it routes through `browserProxyBaseUrl` by default and sends the GitHub OAuth token to the local proxy for server-side Copilot token exchange.

### `createGitHubCopilotProxy(options)`

Creates framework-agnostic server handlers for browser-safe device OAuth and Copilot API proxying.

## Limitations

- This is an unofficial integration over GitHub Copilot endpoints, which can change.
- Embedding and image model factories intentionally throw `NoSuchModelError` for now.
- Custom GitHub Enterprise hostnames are disabled by default. Pass `allowEnterprise: true` only when you trust and validate the deployment environment.
- The package does not provide a multi-user auth service. You own user isolation and secure storage.
