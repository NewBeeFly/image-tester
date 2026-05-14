import { JSONPath } from 'jsonpath-plus';
import { config } from '../config.js';
import type { AssertionConfig, AssertionRule } from '../model/types.js';
import { evalCustomAssertionExpression } from './customScript.js';
import { evaluateLlmJudgeRule, type LlmJudgeContext } from './llmJudge.js';
import type { RuleResult } from './ruleResult.js';

export type { RuleResult } from './ruleResult.js';
export type { LlmJudgeContext } from './llmJudge.js';

function tryParseJson(text: string): unknown | undefined {
  const t = text.trim();
  if (!t) return undefined;
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return undefined;
  }
}

function applyJsonPath(path: string, data: unknown): unknown {
  const res = JSONPath({ path, json: data as object | unknown[], wrap: false });
  // 注意：不要对数组结果做自动拆包，调用方（如数组断言）需要完整的数组
  return res;
}

function deepEqualAssertion(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqualAssertion(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

/** 判断两个数组是否相等（忽略顺序，逐项 deep 比较） */
function arrayEqualsIgnoreOrder(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  const bRemaining = [...b];
  for (const item of a) {
    const idx = bRemaining.findIndex((bi) => deepEqualAssertion(item, bi));
    if (idx === -1) return false;
    bRemaining.splice(idx, 1);
  }
  return bRemaining.length === 0;
}

type StringOrArray = string | string[];

/** 从用例 variables 字符串值解析 JSON 数组（用于数组类断言） */
function parseCaseVarJsonArray(
  caseVars: Record<string, StringOrArray>,
  suiteVars: Record<string, StringOrArray>,
  varName: string,
): { ok: true; arr: unknown[] } | { ok: false; detail: string } {
  // 优先从 caseVars 获取，如果不存在则从 suiteVars 获取
  const raw = caseVars[varName] ?? suiteVars[varName] ?? '';
  if (raw === undefined || String(raw).trim() === '') {
    return { ok: false, detail: `变量「${varName}」为空` };
  }
  // 如果 raw 本身已经是数组，直接返回
  if (Array.isArray(raw)) {
    return { ok: true, arr: raw };
  }
  // 否则尝试解析为 JSON 字符串
  try {
    const v = JSON.parse(String(raw).trim()) as unknown;
    if (!Array.isArray(v)) {
      return { ok: false, detail: `变量「${varName}」解析后不是 JSON 数组` };
    }
    return { ok: true, arr: v };
  } catch {
    return { ok: false, detail: `变量「${varName}」不是合法 JSON 数组` };
  }
}

export function evaluateAssertionConfig(
  outputText: string,
  rules: AssertionRule[],
  caseVars: Record<string, StringOrArray>,
  suiteVars: Record<string, StringOrArray> = {},
): { pass: boolean; results: RuleResult[] } {
  const parsedJson = tryParseJson(outputText);
  const results: RuleResult[] = [];

  for (const rule of rules) {
    const r = evaluateRule(outputText, parsedJson, caseVars, suiteVars, rule);
    results.push(r);
  }

  return { pass: results.every((x) => x.ok), results };
}

/** 批量运行使用：支持 `llmJudge` 规则（异步调用判定模型） */
export async function evaluateAssertionConfigAsync(
  outputText: string,
  rules: AssertionRule[],
  caseVars: Record<string, StringOrArray>,
  ctx: LlmJudgeContext,
  suiteVars: Record<string, StringOrArray> = {},
): Promise<{ pass: boolean; results: RuleResult[] }> {
  const parsedJson = tryParseJson(outputText);
  const results: RuleResult[] = [];
  for (const rule of rules) {
    if (rule.type === 'llmJudge') {
      results.push(await evaluateLlmJudgeRule(rule, outputText, caseVars, ctx));
    } else {
      results.push(evaluateRule(outputText, parsedJson, caseVars, suiteVars, rule));
    }
  }
  return { pass: results.every((x) => x.ok), results };
}

function evaluateRule(
  outputText: string,
  parsedJson: unknown,
  caseVars: Record<string, StringOrArray>,
  suiteVars: Record<string, StringOrArray>,
  rule: AssertionRule,
): RuleResult {
  switch (rule.type) {
    case 'contains': {
      const hay = rule.caseInsensitive ? outputText.toLowerCase() : outputText;
      const needle = rule.caseInsensitive ? rule.value.toLowerCase() : rule.value;
      const hit = hay.includes(needle);
      const ok = rule.negate ? !hit : hit;
      return {
        rule,
        ok,
        detail: ok ? '包含校验通过' : rule.negate ? '不应包含却包含' : '未包含期望文本',
      };
    }
    case 'regex': {
      if (rule.pattern.length > config.maxRegexPatternLength) {
        return { rule, ok: false, detail: `正则过长（>${config.maxRegexPatternLength}）` };
      }
      try {
        const re = new RegExp(rule.pattern, rule.flags);
        const ok = re.test(outputText);
        return { rule, ok, detail: ok ? '正则匹配通过' : '正则不匹配' };
      } catch (e) {
        return { rule, ok: false, detail: `正则无效：${(e as Error).message}` };
      }
    }
    case 'jsonPath': {
      if (parsedJson === undefined) {
        return { rule, ok: false, detail: '输出不是合法 JSON，无法使用 jsonPath' };
      }
      let value: unknown;
      try {
        value = applyJsonPath(rule.path, parsedJson);
      } catch (e) {
        return { rule, ok: false, detail: `jsonPath 失败：${(e as Error).message}` };
      }
      if (rule.equalsCaseVar != null) {
        const expected = caseVars[rule.equalsCaseVar] ?? '';
        const ok = String(value) === String(expected);
        return {
          rule,
          ok,
          detail: ok
            ? `字段与用例变量 ${rule.equalsCaseVar} 一致`
            : `字段值为 ${JSON.stringify(value)}，期望等于变量「${rule.equalsCaseVar}」=${JSON.stringify(expected)}`,
        };
      }
      if (rule.equalsSuiteVar != null) {
        // 向后兼容：老版本的"全局变量比较"。
        // 新版语义已合并到 equalsCaseVar（测试集只声明变量名，值由用例 variables 提供）。
        // 这里先查 suiteVars（老数据默认值），找不到再 fallback 到 caseVars（新行为）。
        const expected =
          suiteVars[rule.equalsSuiteVar] ?? caseVars[rule.equalsSuiteVar] ?? '';
        const ok = String(value) === String(expected);
        return {
          rule,
          ok,
          detail: ok
            ? `字段与测试集变量 ${rule.equalsSuiteVar} 一致`
            : `字段值为 ${JSON.stringify(value)}，期望等于测试集变量「${rule.equalsSuiteVar}」=${JSON.stringify(expected)}`,
        };
      }
      if (rule.equals != null) {
        const ok = String(value) === rule.equals;
        return { rule, ok, detail: ok ? '字段等于期望值' : `字段值为 ${JSON.stringify(value)}` };
      }
      if (rule.inList != null) {
        const ok = rule.inList.map(String).includes(String(value));
        return { rule, ok, detail: ok ? '字段在允许列表内' : `字段值 ${JSON.stringify(value)} 不在列表中` };
      }
      if (rule.regex != null) {
        if (rule.regex.length > config.maxRegexPatternLength) {
          return { rule, ok: false, detail: `正则过长（>${config.maxRegexPatternLength}）` };
        }
        try {
          const re = new RegExp(rule.regex);
          const ok = re.test(String(value));
          return { rule, ok, detail: ok ? '字段正则匹配' : '字段正则不匹配' };
        } catch (e) {
          return { rule, ok: false, detail: `字段正则无效：${(e as Error).message}` };
        }
      }
      if (rule.numericEquals != null) {
        const num = Number(value);
        const ok = Number.isFinite(num) && num === rule.numericEquals;
        return { rule, ok, detail: ok ? '数值相等' : `期望数值 ${rule.numericEquals}，实际 ${String(value)}` };
      }
      if (rule.arrayEqualsCaseVar != null || rule.arrayEqualsConst != null) {
        if (!Array.isArray(value)) {
          return { rule, ok: false, detail: `路径取值不是数组，无法做「数组相等」校验（实际为 ${JSON.stringify(value)}）` };
        }
        let expected: unknown[];
        if (rule.arrayEqualsCaseVar != null) {
          const parsed = parseCaseVarJsonArray(caseVars, suiteVars, rule.arrayEqualsCaseVar);
          if (!parsed.ok) return { rule, ok: false, detail: parsed.detail };
          expected = parsed.arr;
        } else {
          expected = rule.arrayEqualsConst ?? [];
        }
        const ok = deepEqualAssertion(value, expected);
        return {
          rule,
          ok,
          detail: ok
            ? '数组相等（逐项顺序一致）'
            : `数组不相等：实际 ${JSON.stringify(value)}，期望 ${JSON.stringify(expected)}`,
        };
      }
      if (rule.arrayUnorderedEqualsCaseVar != null || rule.arrayUnorderedEqualsConst != null) {
        if (!Array.isArray(value)) {
          return { rule, ok: false, detail: `路径取值不是数组，无法做「无序数组相等」校验（实际为 ${JSON.stringify(value)}）` };
        }
        let expected: unknown[];
        if (rule.arrayUnorderedEqualsCaseVar != null) {
          const parsed = parseCaseVarJsonArray(caseVars, suiteVars, rule.arrayUnorderedEqualsCaseVar);
          if (!parsed.ok) return { rule, ok: false, detail: parsed.detail };
          expected = parsed.arr;
        } else {
          expected = rule.arrayUnorderedEqualsConst ?? [];
        }
        const ok = arrayEqualsIgnoreOrder(value, expected);
        return {
          rule,
          ok,
          detail: ok
            ? '无序数组相等校验通过'
            : `无序数组不相等：实际 ${JSON.stringify(value)}，期望 ${JSON.stringify(expected)}`,
        };
      }
      if (rule.arrayContainsAllCaseVar != null || rule.arrayContainsAll != null) {
        if (!Array.isArray(value)) {
          return { rule, ok: false, detail: `路径取值不是数组，无法做「全部包含」校验（实际为 ${JSON.stringify(value)}）` };
        }
        let required: unknown[];
        if (rule.arrayContainsAllCaseVar != null) {
          const parsed = parseCaseVarJsonArray(caseVars, suiteVars, rule.arrayContainsAllCaseVar);
          if (!parsed.ok) return { rule, ok: false, detail: parsed.detail };
          required = parsed.arr;
        } else {
          required = rule.arrayContainsAll ?? [];
        }
        if (required.length === 0) {
          return { rule, ok: true, detail: '「全部包含」期望集合为空，视为通过' };
        }
        const missing = required.filter((item) => !value.some((av) => deepEqualAssertion(av, item)));
        const ok = missing.length === 0;
        return {
          rule,
          ok,
          detail: ok
            ? '数组全部包含校验通过'
            : `缺少期望项：${JSON.stringify(missing)}；实际数组为 ${JSON.stringify(value)}`,
        };
      }
      const ok = value !== undefined && value !== null && value !== '';
      return { rule, ok, detail: ok ? '路径存在且非空' : '路径不存在或为空' };
    }
    case 'customScript': {
      try {
        const ok = evalCustomAssertionExpression(rule.expression, { outputText, parsedJson, caseVars });
        return { rule, ok, detail: ok ? '自定义表达式为真' : '自定义表达式为假' };
      } catch (e) {
        return { rule, ok: false, detail: `自定义表达式执行失败：${(e as Error).message}` };
      }
    }
    case 'llmJudge': {
      return {
        rule,
        ok: false,
        detail: 'llmJudge 仅在批量运行中生效；请发起批量任务以执行 LLM 判定',
      };
    }
    default: {
      const _never: never = rule;
      return { rule: _never, ok: false, detail: '未知规则类型' };
    }
  }
}

export function parseAssertionConfig(raw: string): AssertionConfig {
  const data = JSON.parse(raw || '{"rules":[]}') as unknown;
  if (!data || typeof data !== 'object' || !Array.isArray((data as AssertionConfig).rules)) {
    throw new Error('断言配置必须是 { "rules": [...] }');
  }
  return data as AssertionConfig;
}
