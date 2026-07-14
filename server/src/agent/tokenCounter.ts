import { getEncoding } from '@langchain/core/utils/tiktoken';
import type { BaseMessage } from '@langchain/core/messages';
import type { Tiktoken } from 'js-tiktoken/lite';

let encoderPromise: Promise<Tiktoken> | null = null;

async function getEncoder() {
  if (!encoderPromise) {
    encoderPromise = getEncoding('cl100k_base');
  }
  return encoderPromise;
}

/** 估算单段文本的 token 数（使用 cl100k_base，适用于 GPT-4 / Doubao 等现代模型） */
export async function estimateTokens(text: string): Promise<number> {
  try {
    const encoder = await getEncoder();
    if (!encoder) throw new Error('tiktoken encoder is null');
    return encoder.encode(text).length;
  } catch {
    // 兜底：按字符数粗略估计（中文约 1 token/字，英文约 0.25 token/字符）
    const cnChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - cnChars;
    return Math.ceil(cnChars + otherChars * 0.25);
  }
}

/** 提取消息中的文本内容（仅 text part，忽略图片） */
function extractMessageText(msg: BaseMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((part: unknown) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) return String((part as { text: unknown }).text);
        return '';
      })
      .join('');
  }
  return JSON.stringify(msg.content);
}

/** 估算消息中图片的 token 数（按 OpenAI gpt-4o 视觉规则简化估算）
 *  规则：图片按 512x512 tile 切分，每个 tile 85 tokens，基础 85 tokens。
 *  由于运行时难以从 base64 快速获取精确尺寸，对单张图片按 300 tokens 保守估算。
 *  实际 token 通常在 255（1024x1024）到 425（2048x2048）之间。
 */
function estimateImageTokens(msg: BaseMessage): number {
  if (typeof msg.content === 'string') return 0;
  if (!Array.isArray(msg.content)) return 0;

  let imageCount = 0;
  for (const part of msg.content as unknown[]) {
    if (!part || typeof part !== 'object') continue;
    const type = (part as { type?: string }).type;
    if (type === 'image_url') imageCount++;
  }
  return imageCount * 300;
}

/** 估算单条 LangChain 消息的 token 数（文本按 tiktoken，图片按视觉规则估算） */
export async function estimateSingleMessageTokens(msg: BaseMessage): Promise<number> {
  const role = (msg as { role?: string }).role || (msg as { _getType?: () => string })._getType?.() || 'unknown';
  const name = (msg as { name?: string }).name || '';
  const content = extractMessageText(msg);
  const toolCallId = (msg as { tool_call_id?: string }).tool_call_id || '';
  const toolCalls = (msg as { tool_calls?: unknown[] }).tool_calls;

  // 把消息序列化成类 OpenAI chat format 的字符串来估算文本部分
  let serialized = `${role}`;
  if (name) serialized += ` name=${name}`;
  if (toolCallId) serialized += ` tool_call_id=${toolCallId}`;
  serialized += `\n${content}`;
  if (toolCalls && toolCalls.length > 0) {
    serialized += `\n${JSON.stringify(toolCalls)}`;
  }

  // 角色 + 分隔符开销约 4 tokens；名字/tool_call_id 按实际 token 计
  // 图片按视觉模型规则单独估算，不编码 base64
  return 4 + (await estimateTokens(serialized)) + estimateImageTokens(msg);
}

/** 估算一组 LangChain 消息的总 token 数（包含格式化开销） */
export async function estimateMessageTokens(messages: BaseMessage[]): Promise<number> {
  let total = 0;
  for (const msg of messages) {
    total += await estimateSingleMessageTokens(msg);
  }
  // 对话格式收尾开销
  total += 3;
  return total;
}

/** 消息级别统计 */
export interface MessageTokenBreakdown {
  role: string;
  content_length: number;
  estimated_tokens: number;
}

/** 上下文统计快照 */
export interface ContextStats {
  total_tokens: number;
  message_count: number;
  system_prompt_tokens: number;
  history_tokens: number;
  user_input_tokens: number;
  tools_tokens: number;
  limit?: number;
  breakdown?: MessageTokenBreakdown[];
}

/** 根据当前消息列表计算上下文统计 */
export async function computeContextStats(params: {
  systemPrompt: string;
  messages: BaseMessage[];
  limit?: number;
}): Promise<ContextStats> {
  const systemTokens = await estimateTokens(params.systemPrompt);
  const messagesTokens = await estimateMessageTokens(params.messages);

  const breakdown: MessageTokenBreakdown[] = [];
  for (const msg of params.messages) {
    breakdown.push({
      role: (msg as { role?: string }).role || (msg as { _getType?: () => string })._getType?.() || 'unknown',
      content_length: extractMessageText(msg).length,
      estimated_tokens: await estimateSingleMessageTokens(msg),
    });
  }

  return {
    total_tokens: systemTokens + messagesTokens,
    message_count: params.messages.length,
    system_prompt_tokens: systemTokens,
    history_tokens: messagesTokens,
    user_input_tokens: 0,
    tools_tokens: 0,
    limit: params.limit,
    breakdown,
  };
}
