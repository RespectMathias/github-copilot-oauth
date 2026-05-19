import { createOpenAI } from '@ai-sdk/openai';
import type { EmbeddingModelV3, ImageModelV3, LanguageModelV3, ProviderV3 } from '@ai-sdk/provider';
import { NoSuchModelError } from '@ai-sdk/provider';
import { copilotBase } from './enterprise';
import { createGitHubCopilotOAuthFetch, isCopilotResponsesModel } from './copilot-fetch';
import type { GitHubCopilotProviderSettings } from './types';

export type GitHubCopilotModelId = string;

/** AI SDK provider for GitHub Copilot OAuth-backed language models. */
export interface GitHubCopilotProvider extends ProviderV3 {
  (modelId: GitHubCopilotModelId): LanguageModelV3;
  languageModel(modelId: GitHubCopilotModelId): LanguageModelV3;
  chat(modelId: GitHubCopilotModelId): LanguageModelV3;
  responses(modelId: GitHubCopilotModelId): LanguageModelV3;
  embeddingModel(modelId: string): EmbeddingModelV3;
  imageModel(modelId: string): ImageModelV3;
}

/** Create a Vercel AI SDK provider backed by GitHub Copilot OAuth. */
export function createGitHubCopilot(settings: GitHubCopilotProviderSettings = {}): GitHubCopilotProvider {
  const providerName = settings.name ?? 'github-copilot';
  const fetch = createGitHubCopilotOAuthFetch(settings);
  const openai = createOpenAI({
    apiKey: 'oauth',
    baseURL: settings.baseURL ?? copilotBase(settings.enterpriseUrl ?? settings.tokens?.enterpriseUrl, settings),
    name: providerName,
    fetch,
  });

  const createChatModel = (modelId: GitHubCopilotModelId) => openai.chat(modelId as never);
  const createResponsesModel = (modelId: GitHubCopilotModelId) => openai.responses(modelId as never);
  // Route GPT-5+ non-mini models to the Responses endpoint for multimodal capability.
  // Fall back to Chat Completions for older models.
  const createLanguageModel = (modelId: GitHubCopilotModelId) =>
    isCopilotResponsesModel(modelId) ? createResponsesModel(modelId) : createChatModel(modelId);
  const provider: GitHubCopilotProvider = Object.assign(
    (modelId: GitHubCopilotModelId) => createLanguageModel(modelId),
    {
      specificationVersion: 'v3' as const,
      languageModel: createLanguageModel,
      chat: createChatModel,
      responses: createResponsesModel,
      embeddingModel: (modelId: string) => {
        throw new NoSuchModelError({ modelId, modelType: 'embeddingModel' });
      },
      imageModel: (modelId: string) => {
        throw new NoSuchModelError({ modelId, modelType: 'imageModel' });
      },
    },
  );

  return provider;
}
