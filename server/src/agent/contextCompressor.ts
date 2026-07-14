import type { BaseMessage } from '@langchain/core/messages';
import { HumanMessage } from '@langchain/core/messages';
import type { Summarizer } from './summarizer.js';
import { estimateMessageTokens } from './tokenCounter.js';

export interface CompressOptions {
  /** 上下文上限 */
  limit: number;
  /** 触发压缩的阈值比例（默认 0.8） */
  thresholdRatio?: number;
  /** 始终保留的最近消息数（默认 4，约 2 轮对话） */
  keepRecentCount?: number;
}

/**
 * 压缩对话历史：system_prompt 不在入参中，因此本函数只压缩用户/助手/工具消息。
 * 超过阈值时，保留最近 N 条，将其余历史摘要成一条总结消息插入开头。
 */
export async function compressMessageHistory(
  messages: BaseMessage[],
  summarizer: Summarizer,
  options: CompressOptions,
): Promise<{ messages: BaseMessage[]; compressed: boolean; summary?: string; originalTokens: number; compressedTokens: number }> {
  const { limit, thresholdRatio = 0.8, keepRecentCount = 4 } = options;
  const threshold = Math.floor(limit * thresholdRatio);

  const originalTokens = await estimateMessageTokens(messages);
  if (originalTokens <= threshold || messages.length <= keepRecentCount) {
    return { messages, compressed: false, originalTokens, compressedTokens: originalTokens };
  }

  const recentMessages = messages.slice(-keepRecentCount);
  const olderMessages = messages.slice(0, -keepRecentCount);

  // 把旧消息序列化成文本供摘要
  const olderText = olderMessages
    .map((msg) => {
      const role = (msg as { role?: string }).role || (msg as { _getType?: () => string })._getType?.() || 'unknown';
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      return `[${role}] ${content.slice(0, 2000)}`;
    })
    .join('\n\n');

  const summary = await summarizer.summarize(
    olderText,
    '对前面的对话历史进行保真总结：保留用户的核心需求、模型已确认的事实、已执行的工具调用及其关键结果。不要新增原文没有的信息，不要改变原意。',
    Math.min(1500, Math.floor(limit * 0.15)),
  );

  const summaryMsg = new HumanMessage(`【前面对话的保真总结】\n${summary}`);
  const compressedMessages: BaseMessage[] = [summaryMsg, ...recentMessages];
  const compressedTokens = await estimateMessageTokens(compressedMessages);

  return { messages: compressedMessages, compressed: true, summary, originalTokens, compressedTokens };
}
