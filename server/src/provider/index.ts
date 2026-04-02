import type { ProviderProfile, VisionChatInput, VisionChatResult } from '../model/types.js';
import { chatVisionOpenAICompatible } from './openaiCompatibleVision.js';

export async function chatVision(profile: ProviderProfile, input: VisionChatInput): Promise<VisionChatResult> {
  if (
    profile.provider_type === 'openai_compatible' ||
    profile.provider_type === 'dashscope' ||
    profile.provider_type === 'volcengine'
  ) {
    return chatVisionOpenAICompatible(profile, input);
  }
  throw new Error(`不支持的 provider_type: ${String((profile as ProviderProfile).provider_type)}`);
}
