/**
 * 合并 OpenAI Chat Completions 请求体：
 * - 禁止用 extra 覆盖 model / messages（避免误配）
 * - 支持 `request_body_extra`：与顶层参数浅合并，后者覆盖前者（用于厂商文档中的扩展字段）
 */
export function mergeChatCompletionParams(
  core: { model: string; messages: unknown[] },
  extra: Record<string, unknown>,
): Record<string, unknown> {
  const { request_body_extra, ...rest } = extra;
  const reserved = new Set(['model', 'messages', 'stream']);
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (!reserved.has(k)) {
      safe[k] = v;
    }
  }
  const merged: Record<string, unknown> = {
    ...safe,
  };
  if (request_body_extra != null && typeof request_body_extra === 'object' && !Array.isArray(request_body_extra)) {
    Object.assign(merged, request_body_extra as Record<string, unknown>);
  }
  merged.model = core.model;
  merged.messages = core.messages;
  return merged;
}

/**
 * 从 Chat Completions 类响应中提取用于断言与落库 `model_output` 的文本。
 *
 * **只用 `message.content`**（助手最终回复），不把 `reasoning_content` / `reasoning` 拼在前面，
 * 否则输出形如 `[推理]…\n\n{json}`，断言里 `jsonPath` / `JSON.parse` 会失败。
 * 深度思考全文仍在接口返回的 `raw`（choices[0].message）里可查。
 */
export function extractAssistantDisplayText(resp: unknown): string {
  const r = resp as {
    choices?: Array<{
      message?: {
        content?: unknown;
        reasoning_content?: unknown;
        reasoning?: unknown;
      };
    }>;
  };
  const msg = r.choices?.[0]?.message;
  if (!msg) return '';

  const c = msg.content;
  let main = '';
  if (typeof c === 'string') {
    main = c;
  } else if (Array.isArray(c)) {
    main = c
      .map((part: unknown) => {
        if (typeof part === 'object' && part && 'text' in (part as object)) {
          return String((part as { text?: string }).text ?? '');
        }
        return typeof part === 'string' ? part : JSON.stringify(part);
      })
      .join('');
  } else if (c != null) {
    main = JSON.stringify(c);
  }

  const trimmed = main.trim();
  if (trimmed) return trimmed;

  const reasoning =
    typeof msg.reasoning_content === 'string'
      ? msg.reasoning_content
      : typeof msg.reasoning === 'string'
        ? msg.reasoning
        : '';
  if (reasoning.trim()) {
    return `[推理]\n${reasoning.trim()}`;
  }
  return '';
}
