import type Database from 'better-sqlite3';
import type { AssertionRule, ProviderProfile, TestRun } from '../model/types.js';
import { chatText } from '../provider/index.js';
import * as promptsRepo from '../repository/promptsRepo.js';
import * as providersRepo from '../repository/providersRepo.js';
import { renderTextPlaceholders } from '../utils/multimodalPrompt.js';
import type { RuleResult } from './ruleResult.js';

function mergeParams(defaultJson: string, overrideJson: string | null): Record<string, unknown> {
  const a = JSON.parse(defaultJson || '{}') as Record<string, unknown>;
  const b = overrideJson ? (JSON.parse(overrideJson) as Record<string, unknown>) : {};
  return { ...a, ...b };
}

const IMG_PH = /\{\{\s*img:/;

/**
 * 解析判定模型输出：优先 JSON `{ "pass": true }`，否则看首行 PASS/FAIL 等。
 */
export function parseJudgePassResponse(text: string): { ok: boolean; detail: string } {
  const t = text.trim();
  if (!t) {
    return { ok: false, detail: '判定模型输出为空' };
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
  caseVars: Record<string, string>,
  ctx: LlmJudgeContext,
): Promise<RuleResult> {
  const judgePrompt = promptsRepo.getPromptProfile(ctx.db, rule.judge_prompt_profile_id);
  if (!judgePrompt) {
    return { rule, ok: false, detail: `判定提示词模板 #${rule.judge_prompt_profile_id} 不存在` };
  }

  if (IMG_PH.test(judgePrompt.system_prompt) || IMG_PH.test(judgePrompt.user_prompt_template)) {
    return {
      rule,
      ok: false,
      detail: '判定模板不支持 {{img:}}，请使用纯文本与 {{var:键}}（如 {{var:modelOutput}}）',
    };
  }

  const provider = rule.judge_provider_profile_id
    ? providersRepo.getProviderProfile(ctx.db, rule.judge_provider_profile_id)
    : ctx.runProvider;
  if (!provider) {
    return {
      rule,
      ok: false,
      detail: rule.judge_provider_profile_id
        ? `判定 Provider #${rule.judge_provider_profile_id} 不存在`
        : '运行 Provider 不存在',
    };
  }

  const vars: Record<string, string> = {
    ...caseVars,
    modelOutput: visionOutputText,
    lastRecognition: visionOutputText,
    visionOutput: visionOutputText,
  };

  const system = renderTextPlaceholders(judgePrompt.system_prompt, vars);
  const user = renderTextPlaceholders(judgePrompt.user_prompt_template, vars);

  const model = rule.judge_model_override?.trim() || provider.default_model;
  const extraParams = mergeParams(provider.default_params_json, rule.judge_params_override_json ?? null);

  try {
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
      detail: parsed.ok
        ? `LLM 判定：${parsed.detail}；回复摘录：${snippet}`
        : `LLM 判定：${parsed.detail}；回复摘录：${snippet}`,
    };
  } catch (e) {
    return {
      rule,
      ok: false,
      detail: `LLM 判定请求失败：${(e as Error).message}`,
    };
  }
}
