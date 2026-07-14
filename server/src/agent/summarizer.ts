import type { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

export interface Summarizer {
  /** 对长文本进行摘要，返回指定最大 token 数以内的内容 */
  summarize(text: string, instruction: string, maxTokens?: number): Promise<string>;
}

/** 基于当前 LLM 创建一个简易摘要器（无工具绑定，避免递归调用） */
export function createSummarizer(llm: ChatOpenAI): Summarizer {
  return {
    async summarize(text: string, instruction: string, maxTokens = 1200): Promise<string> {
      if (!text.trim()) return '';
      const messages = [
        new SystemMessage(
          `你是内容压缩助手。请对输入文本进行摘要/总结，严格遵循以下原则：\n` +
            `1. 不得改变原文核心含义，不得新增原文不存在的信息，不得编造、捏造、臆造任何内容。\n` +
            `2. 保留所有真实、关键、可执行的信息（如编号映射、输出格式、判定规则、阈值等）。\n` +
            `3. 仅删除重复描述、过度修辞、冗余示例，合并相似条目。\n` +
            `4. 只输出压缩后的正文，不要解释、不要道歉、不要加标题。输出控制在 ${maxTokens} tokens 以内。`,
        ),
        new HumanMessage(`【压缩要求】\n${instruction}\n\n【原始文本】\n${text}`),
      ];
      const response = await llm.invoke(messages);
      const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      return content.trim();
    },
  };
}

/** 占位摘要器：不做 LLM 摘要，仅做截断 */
export function createTruncator(): Summarizer {
  return {
    async summarize(text: string, instruction: string, maxTokens = 1200): Promise<string> {
      void instruction;
      // 按中文字符估算 1 token/字，英文 0.25 token/字符
      const cnChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
      const otherChars = text.length - cnChars;
      const estimated = cnChars + otherChars * 0.25;
      if (estimated <= maxTokens) return text;
      const ratio = maxTokens / estimated;
      const sliceLen = Math.floor(text.length * ratio);
      return text.slice(0, sliceLen) + '\n\n[内容已截断，未启用 LLM 摘要]';
    },
  };
}
