import vm from 'node:vm';
import { config } from '../config.js';

/**
 * 自定义表达式：需为一段返回真假值的 JavaScript 表达式。
 * 可用变量：outputText, parsedJson, caseVars
 */
export function evalCustomAssertionExpression(
  expression: string,
  ctx: { outputText: string; parsedJson: unknown; caseVars: Record<string, string> },
): boolean {
  const wrapped = `"use strict"; (${expression})`;
  const sandbox: Record<string, unknown> = {
    outputText: ctx.outputText,
    parsedJson: ctx.parsedJson,
    caseVars: ctx.caseVars,
  };
  const result = vm.runInNewContext(wrapped, sandbox, {
    timeout: config.customScriptTimeoutMs,
  });
  return Boolean(result);
}
