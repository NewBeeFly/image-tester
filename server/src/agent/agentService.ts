/**
 * Agent Service：使用 LangGraph.js 构建 ReAct 循环，支持 SSE 真流式推送。
 *
 * 流式策略（基于 LangGraph v3 event streaming 官方推荐用法）：
 *  - stream.messages    → 逐 token 推送 answer_delta
 *  - stream.values      → 状态快照，检测 tool_call / tool_result
 *  - stream.output      → 最终完整状态兜底
 */
import type Database from 'better-sqlite3';
import { ChatOpenAI } from '@langchain/openai';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import type { BaseMessage, BaseMessageLike } from '@langchain/core/messages';
import { getAgent } from '../agents/registry.js';
import { createAllTools } from './tools/index.js';
import * as agentRepo from './agentRepo.js';
import * as providersRepo from '../repository/providersRepo.js';
import type { ProviderProfile } from '../model/types.js';
import { computeContextStats } from './tokenCounter.js';
import { createSummarizer } from './summarizer.js';
import { compressMessageHistory } from './contextCompressor.js';
import { config } from '../config.js';

/** SSE 事件类型 */
export type AgentSSEEvent =
  | { type: 'answer_delta'; content: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; result: string; truncated: boolean }
  | { type: 'context_stats'; total_tokens: number; message_count: number; system_prompt_tokens: number; history_tokens: number; limit?: number }
  | { type: 'done'; messageId: number; fullContent?: string }
  | { type: 'error'; message: string };

export type SSEEmitter = (event: AgentSSEEvent) => void;

/** 取消标记 */
const cancelledSessions = new Set<number>();
/** session 对应的 AbortController，用于真正中断底层模型调用 */
const sessionControllers = new Map<number, AbortController>();

export function cancelAgentRun(sessionId: number): void {
  cancelledSessions.add(sessionId);
  const controller = sessionControllers.get(sessionId);
  if (controller) {
    controller.abort();
    sessionControllers.delete(sessionId);
  }
}

/** 从 Provider 档案创建 ChatOpenAI 实例（启用 streaming） */
function createChatModel(provider: ProviderProfile, modelOverride?: string | null): ChatOpenAI {
  const apiKey = process.env[provider.api_key_env];
  if (!apiKey) throw new Error(`未找到环境变量 ${provider.api_key_env}`);
  const model = modelOverride?.trim() || provider.default_model;
  let extraParams: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(provider.default_params_json || '{}') as Record<string, unknown>;
    // Agent 对话必须输出自由文本+工具调用，移除 Provider 可能配置的 json_object 限制
    const { response_format: _ignored, ...rest } = parsed;
    extraParams = rest;
  } catch {
    /* ignore */
  }

  const streaming = provider.streaming !== 0;

  return new ChatOpenAI({
    model,
    apiKey,
    temperature: 0.2,
    streaming,
    configuration: { baseURL: provider.base_url.replace(/\/+$/, '') },
    ...(extraParams as Record<string, unknown>),
  });
}

/** 从 content 字段提取纯文本（兼容 string / ContentPart[] 等） */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: unknown) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) return String((part as { text: unknown }).text);
        return '';
      })
      .join('');
  }
  return content != null ? JSON.stringify(content) : '';
}

/** 从消息中提取 tool_calls */
function extractToolCalls(msg: unknown): Array<{ id?: string; name: string; args: Record<string, unknown> }> {
  const raw: unknown[] =
    (msg as { tool_calls?: unknown[] })?.tool_calls ??
    (msg as { additional_kwargs?: { tool_calls?: unknown[] } })?.additional_kwargs?.tool_calls ??
    [];
  return raw.filter(
    (tc: unknown) => tc && typeof tc === 'object' && 'name' in tc,
  ) as Array<{ id?: string; name: string; args: Record<string, unknown> }>;
}

/** 从消息中提取 role */
function extractRole(msg: unknown): string {
  return (
    (msg as { role?: string })?.role ??
    (msg as { _getType?: () => string })?._getType?.() ??
    ''
  );
}

/**
 * 执行 agent 对话：加载历史 → 构建 graph → 流式运行 → 推送事件。
 */
export async function runAgentChat(
  db: Database.Database,
  sessionId: number,
  userContent: string,
  emit: SSEEmitter,
): Promise<void> {
  cancelledSessions.delete(sessionId);

  const session = agentRepo.getSession(db, sessionId);
  if (!session) {
    emit({ type: 'error', message: '会话不存在' });
    return;
  }

  // 加载 agent 定义
  const agentDef = getAgent(session.agent_name);
  if (!agentDef) {
    emit({ type: 'error', message: `Agent "${session.agent_name}" 不存在` });
    return;
  }

  // 加载 Provider
  const provider = providersRepo.getProviderProfile(db, session.provider_profile_id);
  if (!provider) {
    emit({ type: 'error', message: 'Provider 档案不存在' });
    return;
  }

  // 创建工具、摘要器和 LLM
  const chatModel = createChatModel(provider, session.model);
  const summarizer = createSummarizer(chatModel);
  const allTools = createAllTools(db, agentDef, summarizer);
  // 绑定 abort signal，确保停止按钮能切断底层模型 HTTP 请求
  const controller = new AbortController();
  sessionControllers.set(sessionId, controller);
  const llmWithTools = chatModel.bindTools(allTools).withConfig({ signal: controller.signal });

  // 加载历史消息（createReactAgent 的 stateModifier 会自动加 system prompt）
  const historyMessages = agentRepo.listMessages(db, sessionId);
  const langchainMessages: BaseMessage[] = [];

  // 还原历史消息（跳过 system prompt，只还原 user/assistant/tool）
  for (const msg of historyMessages) {
    if (msg.role === 'user') {
      langchainMessages.push(new HumanMessage(msg.content));
    } else if (msg.role === 'assistant') {
      const aiMsg = new AIMessage({
        content: msg.content,
        tool_calls: msg.tool_calls_json ? JSON.parse(msg.tool_calls_json) : undefined,
      });
      langchainMessages.push(aiMsg);
    } else if (msg.role === 'tool') {
      langchainMessages.push(
        new ToolMessage({ content: msg.content, tool_call_id: msg.tool_call_id || '' }),
      );
    }
  }

  // 添加本次用户消息
  langchainMessages.push(new HumanMessage(userContent));

  // 保存用户消息到 DB
  agentRepo.insertMessage(db, {
    session_id: sessionId,
    role: 'user',
    content: userContent,
  });

  // 上下文 token 统计（初始状态）
  const contextLimit = provider.context_window || 256000;
  const initialStats = await computeContextStats({
    systemPrompt: agentDef.systemPrompt,
    messages: langchainMessages,
    limit: contextLimit,
  });
  console.log(`[agent] session=${sessionId} initial_context total=${initialStats.total_tokens} messages=${initialStats.message_count} limit=${contextLimit}`);
  emit({ type: 'context_stats', ...initialStats });

  // 若历史消息超过阈值，压缩对话历史（只压用户/助手/工具消息，不压 system_prompt）
  const compressed = await compressMessageHistory(langchainMessages, summarizer, {
    limit: contextLimit,
    thresholdRatio: 0.8,
    keepRecentCount: 4,
  });
  if (compressed.compressed) {
    langchainMessages.splice(0, langchainMessages.length, ...compressed.messages);
    console.log(
      `[agent] session=${sessionId} context_compressed original=${compressed.originalTokens} compressed=${compressed.compressedTokens}`,
    );
    const compressedStats = await computeContextStats({
      systemPrompt: agentDef.systemPrompt,
      messages: langchainMessages,
      limit: contextLimit,
    });
    emit({ type: 'context_stats', ...compressedStats });
  }

  // ---- 使用 createReactAgent 构建 ReAct 图 ----
  const agentGraph = createReactAgent({
    stateModifier: (state): BaseMessageLike[] => {
      const messages = ((state as { messages?: BaseMessageLike[] }).messages || []).slice();
      const hasSystem = messages.some((m) => {
        const role = (m as { role?: string }).role ?? (m as { _getType?: () => string })._getType?.();
        return role === 'system';
      });
      if (hasSystem) {
        return messages;
      }
      return [new SystemMessage(agentDef.systemPrompt), ...messages];
    },
    llm: llmWithTools,
    tools: allTools,
  });
  const compiled = agentGraph;

  // ---- 真流式运行（v3 event streaming） ----
  try {
    const input = { messages: langchainMessages };

    // 调试日志：发送给模型的消息列表
    console.log(`[agent] session=${sessionId} model=${provider.default_model} temperature=0.2 sending_messages=${langchainMessages.length}`);
    for (let i = 0; i < langchainMessages.length; i++) {
      const msg = langchainMessages[i];
      const role = extractRole(msg);
      const content = extractText((msg as { content?: unknown }).content).slice(0, 200);
      const toolCalls = extractToolCalls(msg);
      console.log(`[agent] msg[${i}] role=${role} content_len=${extractText((msg as { content?: unknown }).content).length} content_preview=${JSON.stringify(content)} tool_calls=${toolCalls.length}`);
    }

    const stream = await compiled.streamEvents(input, {
      version: 'v3',
      recursionLimit: 20,
      signal: controller.signal,
      runName: `agent-chat-${sessionId}`,
      metadata: {
        session_id: sessionId,
        agent_name: session.agent_name,
        provider_id: session.provider_profile_id,
        model: provider.default_model,
      },
      tags: ['agent-chat', `agent:${session.agent_name}`],
    });

    let streamedText = '';
    const emittedToolCalls = new Set<string>();
    const emittedToolResults = new Set<string>();
    // 某些代理（如 aihub）在 SSE 流式 Tool Calling 时，后续 chunk 会丢失 function.name，
    // 导致 LangChain 累积后 tool_call.name 为空。这里按 tool_call_id 记住第一次出现的名字。
    const toolCallNameMap = new Map<string, string>();
    const intermediateMessages: Array<{
      role: 'assistant' | 'tool';
      content: string;
      tool_calls_json?: string;
      tool_call_id?: string;
    }> = [];
    // 记录已经处理过的 messages 长度，避免重复处理历史消息
    let processedMessageCount = 0;

    // 并发消费 messages（token 流）和 values（状态快照）
    await Promise.all([
      // --- token 流 ---
      (async () => {
        for await (const message of stream.messages) {
          if (cancelledSessions.has(sessionId)) break;
          for await (const token of message.text) {
            streamedText += token;
            console.log(`[agent] session=${sessionId} token=${JSON.stringify(token)} accumulated=${JSON.stringify(streamedText.slice(0, 100))}`);
            emit({ type: 'answer_delta', content: token });
          }
        }
      })(),

      // --- 状态快照：检测 tool_call / tool_result ---
      // LangGraph 的 ToolNode 默认并行执行所有 tool_calls，因此一个 assistant 消息
      // 可能对应多个 tool 消息。我们遍历每次新增的消息，而不是只看最后一条。
      (async () => {
        for await (const snapshot of stream.values) {
          if (cancelledSessions.has(sessionId)) break;
          const messages = (snapshot as { messages?: unknown[] })?.messages;
          if (!Array.isArray(messages)) continue;

          const newMessages = messages.slice(processedMessageCount);
          processedMessageCount = messages.length;

          for (const msg of newMessages) {
            const role = extractRole(msg);

            if (role === 'assistant' || role === 'ai') {
              const toolCalls = extractToolCalls(msg);
              const newToolCalls = toolCalls.filter((tc) => {
                const id = tc.id || tc.name;
                return id && !emittedToolCalls.has(id);
              });
              if (newToolCalls.length === 0) continue;

              // 同一个 assistant 消息只保存一次中间记录
              intermediateMessages.push({
                role: 'assistant',
                content: extractText((msg as { content?: unknown }).content),
                tool_calls_json: JSON.stringify(toolCalls),
              });

              for (const tc of newToolCalls) {
                const id = tc.id || tc.name;
                emittedToolCalls.add(id);
                // 兜底：如果名字为空，尝试从累积的 nameMap 恢复
                const resolvedName = tc.name || toolCallNameMap.get(id) || '';
                if (!resolvedName) {
                  console.log(`[agent] session=${sessionId} tool_call SKIPPED name empty id=${id} args=${JSON.stringify(tc.args).slice(0, 200)}`);
                  continue;
                }
                console.log(`[agent] session=${sessionId} tool_call name=${resolvedName} id=${id} args=${JSON.stringify(tc.args).slice(0, 200)}`);
                emit({
                  type: 'tool_call',
                  name: resolvedName,
                  args: tc.args || {},
                });
              }
            } else if (role === 'tool') {
              const toolCallId = (msg as { tool_call_id?: string }).tool_call_id || '';
              if (emittedToolResults.has(toolCallId)) continue;
              emittedToolResults.add(toolCallId);
              const content = extractText((msg as { content?: unknown }).content);
              const name = (msg as { name?: string }).name || toolCallNameMap.get(toolCallId) || 'unknown';
              console.log(`[agent] session=${sessionId} tool_result name=${name} tool_call_id=${toolCallId} content_len=${content.length}`);
              emit({
                type: 'tool_result',
                name,
                result: content.length > 500 ? content.slice(0, 500) + '...' : content,
                truncated: content.length > 500,
              });
              intermediateMessages.push({
                role: 'tool',
                content,
                tool_call_id: toolCallId,
              });
            }
          }

          // 工具返回后刷新上下文统计（最后一条是 tool 时说明本轮工具执行完成）
          const lastMsg = messages[messages.length - 1];
          if (extractRole(lastMsg) === 'tool') {
            const currentMessages = (snapshot as { messages?: BaseMessageLike[] }).messages || [];
            computeContextStats({
              systemPrompt: agentDef.systemPrompt,
              messages: currentMessages as BaseMessage[],
              limit: contextLimit,
            }).then((stats) => {
              console.log(`[agent] session=${sessionId} context_after_tool total=${stats.total_tokens} messages=${stats.message_count}`);
              emit({ type: 'context_stats', ...stats });
            }).catch(() => { /* ignore stats errors */ });
          }
        }
      })(),
    ]);

    if (cancelledSessions.has(sessionId)) {
      cancelledSessions.delete(sessionId);
      return;
    }

    // 最终状态兜底
    const finalState = await stream.output;
    const finalMessages = (finalState as { messages?: unknown[] })?.messages;
    let finalContent = streamedText;
    console.log(`[agent] session=${sessionId} final_state_messages=${Array.isArray(finalMessages) ? finalMessages.length : 'none'} streamedText=${JSON.stringify(streamedText)}`);
    if (Array.isArray(finalMessages)) {
      for (let i = 0; i < finalMessages.length; i++) {
        const msg = finalMessages[i];
        const role = extractRole(msg);
        const content = extractText((msg as { content?: unknown }).content).slice(0, 200);
        const toolCalls = extractToolCalls(msg);
        console.log(`[agent] final_msg[${i}] role=${role} content_len=${extractText((msg as { content?: unknown }).content).length} content_preview=${JSON.stringify(content)} tool_calls=${toolCalls.length}`);
      }
      for (let i = finalMessages.length - 1; i >= 0; i--) {
        const msg = finalMessages[i];
        const role = extractRole(msg);
        if (role !== 'assistant' && role !== 'ai') continue;
        const toolCalls = extractToolCalls(msg);
        if (toolCalls.length === 0) {
          const text = extractText((msg as { content?: unknown }).content);
          if (text) {
            finalContent = text;
          }
          break;
        }
      }
    }

    if (!finalContent.trim()) {
      console.warn(`[agent] session=${sessionId} final assistant content is empty; streamedText=${JSON.stringify(streamedText)} intermediateMessages=${intermediateMessages.length}`);
      finalContent = '（模型未生成回复内容）';
    } else if (finalContent.trim().length < 10) {
      console.warn(`[agent] session=${sessionId} final assistant content suspiciously short: ${JSON.stringify(finalContent)}`);
    }

    console.log(`[agent] session=${sessionId} model=${provider.default_model} finalContentLength=${finalContent.length} streamedTextLength=${streamedText.length}`);

    // 保存中间过程消息到 DB
    for (const msg of intermediateMessages) {
      agentRepo.insertMessage(db, {
        session_id: sessionId,
        role: msg.role,
        content: msg.content,
        tool_calls_json: msg.tool_calls_json,
        tool_call_id: msg.tool_call_id,
      });
    }

    const savedMsg = agentRepo.insertMessage(db, {
      session_id: sessionId,
      role: 'assistant',
      content: finalContent,
    });

    emit({
      type: 'done',
      messageId: savedMsg.id,
      fullContent: finalContent || undefined,
    });
  } catch (e) {
    const err = e as Error;
    if (err.name === 'AbortError' || err.message?.includes('abort')) {
      console.log(`[agent] session=${sessionId} run aborted by user`);
      emit({ type: 'error', message: '已取消' });
    } else {
      console.error(`[agent] error: ${err.message}`);
      emit({ type: 'error', message: err.message });
    }
  } finally {
    cancelledSessions.delete(sessionId);
    sessionControllers.delete(sessionId);
  }
}
