import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';

export const DEFAULT_MODEL = 'claude-sonnet-4-6';

/**
 * Resolve a model id to a LanguageModel instance by routing on provider prefix
 * or well-known id pattern.
 *
 * Supported forms:
 *   "anthropic/claude-sonnet-4-6"
 *   "openai/gpt-4o"
 *   "google/gemini-1.5-pro"
 *   "claude-sonnet-4-6"   (auto-routed to Anthropic by prefix)
 *   "gpt-4o"              (auto-routed to OpenAI)
 *   "o1-preview"          (auto-routed to OpenAI)
 *   "gemini-1.5-pro"      (auto-routed to Google)
 */
export function resolveModel(id: string): LanguageModel {
  const [maybeProvider, ...rest] = id.split('/');
  if (rest.length > 0) {
    const modelId = rest.join('/');
    switch (maybeProvider) {
      case 'anthropic':
        return anthropic(modelId);
      case 'openai':
        return openai(modelId);
      case 'google':
        return google(modelId);
      default:
        throw new Error(`Unknown provider prefix: ${maybeProvider}`);
    }
  }

  if (id.startsWith('claude-')) return anthropic(id);
  if (isOpenAiId(id)) return openai(id);
  if (id.startsWith('gemini-')) return google(id);

  throw new Error(
    `Cannot resolve model "${id}". Use a known prefix (claude-/gpt-/o1/o3/o4/gemini-) ` +
      `or an explicit "provider/model" form like "openai/gpt-5.5".`,
  );
}

export function requiredEnvKeyFor(id: string): string {
  const provider = id.includes('/') ? id.split('/')[0] : inferProvider(id);
  switch (provider) {
    case 'anthropic':
      return 'ANTHROPIC_API_KEY';
    case 'openai':
      return 'OPENAI_API_KEY';
    case 'google':
      return 'GOOGLE_GENERATIVE_AI_API_KEY';
    default:
      return '';
  }
}

function isOpenAiId(id: string): boolean {
  return (
    id.startsWith('gpt-') ||
    id.startsWith('o1') ||
    id.startsWith('o3') ||
    id.startsWith('o4')
  );
}

function inferProvider(id: string): string {
  if (id.startsWith('claude-')) return 'anthropic';
  if (isOpenAiId(id)) return 'openai';
  if (id.startsWith('gemini-')) return 'google';
  return 'unknown';
}
