import OpenAI from 'openai';
import type { ProviderProfile, VisionChatResult } from '../model/types.js';
import { extractAssistantDisplayText, mergeChatCompletionParams } from './chatBodyMerge.js';

function getApiKey(profile: ProviderProfile): string {
  const key = process.env[profile.api_key_env];
  if (!key) {
    throw new Error(`未找到环境变量 ${profile.api_key_env}，请在 .env 或系统环境中配置 API Key`);
  }
  return key;
}

/** 纯文本对话（无图片），用于 LLM 判定等场景 */
export async function chatTextOpenAICompatible(
  profile: ProviderProfile,
  input: {
    model: string;
    system: string;
    user: string;
    extraParams?: Record<string, unknown>;
  },
): Promise<VisionChatResult> {
  const apiKey = getApiKey(profile);
  const client = new OpenAI({
    apiKey,
    baseURL: profile.base_url.replace(/\/+$/, ''),
  });
  const messages = [
    { role: 'system' as const, content: input.system },
    { role: 'user' as const, content: input.user },
  ];
  const body = mergeChatCompletionParams(
    { model: input.model, messages },
    input.extraParams ?? {},
  );
  const resp = await client.chat.completions.create(
    body as unknown as Parameters<typeof client.chat.completions.create>[0],
  );
  const text = extractAssistantDisplayText(resp);
  return { text, raw: resp };
}
