import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseJudgePassResponse } from '../../src/assert/llmJudge.js';

describe('parseJudgePassResponse', () => {
  it('parses JSON with markdown fence', () => {
    const text = '```json\n{"pass": true, "reason": "ok"}\n```';
    const result = parseJudgePassResponse(text);
    assert.equal(result.ok, true);
    assert.equal(result.detail.includes('JSON.pass 为 true'), true);
  });

  it('parses plain JSON', () => {
    const text = '{"pass": false, "reason": "bad"}';
    const result = parseJudgePassResponse(text);
    assert.equal(result.ok, false);
    assert.equal(result.detail.includes('JSON.pass 为 false'), true);
  });

  it('falls back to first line PASS', () => {
    const result = parseJudgePassResponse('PASS\nsome reason');
    assert.equal(result.ok, true);
  });

  it('falls back to first line FAIL', () => {
    const result = parseJudgePassResponse('FAIL\nsome reason');
    assert.equal(result.ok, false);
  });

  it('returns fail for empty text', () => {
    const result = parseJudgePassResponse('');
    assert.equal(result.ok, false);
  });
});
