import type { AssertionRule } from '../model/types.js';

export interface RuleResult {
  rule: AssertionRule;
  ok: boolean;
  detail: string;
}
