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

  it('parses JSON ok field as true', () => {
    const result = parseJudgePassResponse('{"ok": true}');
    assert.equal(result.ok, true);
    assert.equal(result.detail.includes('JSON.ok 为 true'), true);
  });

  it('parses JSON ok field as false', () => {
    const result = parseJudgePassResponse('{"ok": false}');
    assert.equal(result.ok, false);
    assert.equal(result.detail.includes('JSON.ok 为 false'), true);
  });

  it('parses code block without json tag', () => {
    const text = '```\n{"pass": true}\n```';
    const result = parseJudgePassResponse(text);
    assert.equal(result.ok, true);
    assert.equal(result.detail.includes('JSON.pass 为 true'), true);
  });

  it('falls back to first line when JSON lacks pass/ok', () => {
    const result = parseJudgePassResponse('{"foo": true}\nPASS');
    assert.equal(result.ok, true);
    assert.equal(result.detail.includes('首行为通过标记'), true);
  });

  it('returns fail for unparsable text', () => {
    const result = parseJudgePassResponse('unparsable gibberish');
    assert.equal(result.ok, false);
  });
});
