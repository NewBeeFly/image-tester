import OpenAI from 'openai';
import type { ProviderProfile, VisionChatInput, VisionChatResult } from '../model/types.js';
import { extractAssistantDisplayText, mergeChatCompletionParams } from './chatBodyMerge.js';

function getApiKey(profile: ProviderProfile): string {
  const key = process.env[profile.api_key_env];
  if (!key) {
    throw new Error(`未找到环境变量 ${profile.api_key_env}，请在 .env 或系统环境中配置 API Key`);
  }
  return key;
}

/**
 * 适用于：OpenAI 官方、阿里云 DashScope 兼容模式、火山方舟等 OpenAI 兼容视觉接口。
 */
export async function chatVisionOpenAICompatible(
  profile: ProviderProfile,
  input: VisionChatInput,
): Promise<VisionChatResult> {
  const apiKey = getApiKey(profile);
  const client = new OpenAI({
    apiKey,
    baseURL: profile.base_url.replace(/\/+$/, ''),
  });

  const extra = input.extraParams ?? {};

  const messages = [
    {
      role: 'system' as const,
      content: input.system as string | OpenAI.ChatCompletionContentPart[],
    },
    { role: 'user' as const, content: input.user as OpenAI.ChatCompletionContentPart[] },
  ];

  const body = mergeChatCompletionParams({ model: input.model, messages }, extra);

  const resp = await client.chat.completions.create(
    body as unknown as Parameters<typeof client.chat.completions.create>[0],
  );

  const text = extractAssistantDisplayText(resp);
  return { text, raw: resp };
}
