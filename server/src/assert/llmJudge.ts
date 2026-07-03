import type Database from 'better-sqlite3';
import type { AssertionRule, ProviderProfile, TestRun } from '../model/types.js';
import { chatText } from '../provider/index.js';
import * as providersRepo from '../repository/providersRepo.js';
import { renderTextPlaceholders } from '../utils/multimodalPrompt.js';
import { applySchemaToSystemPrompt } from '../utils/outputSchema.js';
import type { RuleResult } from './ruleResult.js';

function mergeParams(defaultJson: string, overrideJson: string | null): Record<string, unknown> {
  const a = JSON.parse(defaultJson || '{}') as Record<string, unknown>;
  const b = overrideJson ? (JSON.parse(overrideJson) as Record<string, unknown>) : {};
  return { ...a, ...b };
}

const DEFAULT_JUDGE_SYSTEM_PROMPT = `你是一位结果判定员。请根据用户提供的【模型输出】和【期望信息】，判断模型输出是否符合期望。`;
const DEFAULT_OUTPUT_SCHEMA_JSON = JSON.stringify({
  fields: [
    { name: 'pass', type: 'boolean', required: true, description: '是否合格' },
    { name: 'reason', type: 'string', required: true, description: '简要原因' },
  ],
});

/**
 * 解析判定模型输出：优先 JSON `{ "pass": true }`，否则看首行 PASS/FAIL 等。
 */
export function parseJudgePassResponse(text: string): { ok: boolean; detail: string } {
  let t = text.trim();
  if (!t) {
    return { ok: false, detail: '判定模型输出为空' };
  }

  // 去掉 Markdown code block 包裹
  const codeBlockMatch = t.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (codeBlockMatch) {
    t = codeBlockMatch[1].trim();
  }

  const jsonBlock = t.match(/\{[\s\S]*\}/);
  if (jsonBlock) {
    try {
      const j = JSON.parse(jsonBlock[0]) as { pass?: boolean; ok?: boolean };
      if (typeof j.pass === 'boolean') {
        return {
          ok: j.pass,
          detail: j.pass ? 'JSON.pass 为 true' : 'JSON.pass 为 false',
        };
      }
      if (typeof j.ok === 'boolean') {
        return {
          ok: j.ok,
          detail: j.ok ? 'JSON.ok 为 true' : 'JSON.ok 为 false',
        };
      }
      // JSON 中无 pass/ok 字段时，忽略该 JSON 块，继续按首行判断
      t = t.replace(jsonBlock[0], '').trim();
    } catch {
      /* 继续走首行 */
    }
  }

  const firstLine = t.split(/\r?\n/)[0]?.trim() ?? '';
  if (/^(PASS|YES|OK|是|true|1|通过)/i.test(firstLine)) {
    return { ok: true, detail: '首行为通过标记' };
  }
  if (/^(FAIL|NO|否|false|0|不通过)/i.test(firstLine)) {
    return { ok: false, detail: '首行为不通过标记' };
  }

  return {
    ok: false,
    detail:
      '无法解析判定结果；请让模型输出 JSON 如 {"pass":true,"reason":"..."} 或首行 PASS / FAIL',
  };
}

export interface LlmJudgeContext {
  db: Database.Database;
  runProvider: ProviderProfile;
  run: TestRun;
}

export async function evaluateLlmJudgeRule(
  rule: AssertionRule & { type: 'llmJudge' },
  visionOutputText: string,
  caseVars: Record<string, string | string[]>,
  ctx: LlmJudgeContext,
): Promise<RuleResult> {
  if (!rule.provider_profile_id) {
    return { rule, ok: false, detail: 'LLM 判定规则缺少 provider_profile_id' };
  }
  if (!rule.user_prompt_template?.trim()) {
    return { rule, ok: false, detail: 'LLM 判定 user 提示词模板为空' };
  }

  const provider = providersRepo.getProviderProfile(ctx.db, rule.provider_profile_id);
  if (!provider) {
    return { rule, ok: false, detail: `判定 Provider #${rule.provider_profile_id} 不存在` };
  }

  const vars: Record<string, string | string[]> = {
    ...caseVars,
    modelOutput: visionOutputText,
  };

  const systemBase = renderTextPlaceholders(rule.system_prompt?.trim() || DEFAULT_JUDGE_SYSTEM_PROMPT, vars);
  const outputSchemaJson = rule.output_schema_json?.trim() || DEFAULT_OUTPUT_SCHEMA_JSON;
  const system = applySchemaToSystemPrompt(systemBase, outputSchemaJson);
  const user = renderTextPlaceholders(rule.user_prompt_template, vars);

  try {
    const model = rule.model?.trim() || provider.default_model;
    const extraParams = mergeParams(provider.default_params_json, rule.params_json ?? null);
    const result = await chatText(provider, {
      model,
      system,
      user,
      extraParams,
    });
    const parsed = parseJudgePassResponse(result.text);
    const snippet = result.text.trim().slice(0, 400);
    return {
      rule,
      ok: parsed.ok,
      detail: `LLM 判定：${parsed.detail}；回复摘录：${snippet}`,
    };
  } catch (e) {
    return {
      rule,
      ok: false,
      detail: `LLM 判定请求失败：${(e as Error).message}`,
    };
  }
}
