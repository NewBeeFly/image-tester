# LLM Judge 内嵌式断言实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在断言编辑器中直接内嵌配置 LLM 判定规则，无需预先创建提示词模板；后端按新内嵌字段调用判定模型并解析结果。

**Architecture:** 后端废弃旧 `judge_prompt_profile_id` 等字段，改用 `provider_profile_id` + `model` + `system_prompt` + `user_prompt_template` 内嵌字段；`llmJudge.ts` 直接渲染提示词并调用 `chatText`。前端 `AssertionBuilder` 新增 LLM 判定规则卡片式配置面板。

**Tech Stack:** TypeScript, Fastify, SQLite, React, Vite, Node.js built-in test runner (`node:test`).

---

## 文件结构

| 文件 | 责任 |
| --- | --- |
| `server/src/model/types.ts` | 扩展 `AssertionRule` 的 `llmJudge` 分支字段 |
| `server/src/assert/llmJudge.ts` | 重写 `evaluateLlmJudgeRule`，支持内嵌字段；增强结果解析（去 Markdown code block） |
| `server/src/assert/engine.ts` | 无需大改，确认异步路径正确传递上下文即可 |
| `server/src/controller/http.ts` | 新增 `llmJudge` 规则字段校验 |
| `web/src/components/AssertionBuilder.tsx` | 新增 LLM 判定规则可视化编辑/渲染 |
| `web/src/App.css` | 补充 LLM 判定卡片样式 |
| `server/tests/assert/llmJudge.test.ts` | 使用 `node:test` 测试 `parseJudgePassResponse` |
| `server/package.json` | 新增 `test` 脚本 |

---

## Task 1: 扩展 AssertionRule 类型

**Files:**
- Modify: `server/src/model/types.ts:119-128`

- [ ] **Step 1: 用新内嵌字段替换旧 `llmJudge` 分支**

将原来的 `llmJudge` 分支：

```ts
| {
    /** 调用另一套提示词（纯文本，勿使用 {{img:}}）让大模型判定是否通过，例如门头名称语义是否一致 */
    type: 'llmJudge';
    /** 判定专用的提示词模板 ID（与主任务视觉提示词分开） */
    judge_prompt_profile_id: number;
    /** 可选；默认与当前运行使用同一 Provider */
    judge_provider_profile_id?: number;
    judge_model_override?: string | null;
    judge_params_override_json?: string | null;
  };
```

替换为：

```ts
| {
    /** 调用纯文本大模型判定输出是否合规 */
    type: 'llmJudge';
    /** 判定用 Provider 档案 ID */
    provider_profile_id: number;
    /** 覆盖 Provider 默认模型；空/null 则使用 Provider 默认 */
    model?: string | null;
    /** 覆盖请求参数 JSON，如 {"temperature":0.1} */
    params_json?: string | null;
    /** 系统提示词；空/null 则使用默认约束模板 */
    system_prompt?: string | null;
    /** 用户提示词模板，支持 {{var:xxx}} */
    user_prompt_template: string;
  };
```

- [ ] **Step 2: 暂不运行 TypeScript 检查**

因为 `llmJudge.ts` 仍在引用旧字段，此时运行 `npx tsc --noEmit` 会报错；留在 Task 2 完成后统一检查。

- [ ] **Step 3: Commit**

```bash
git add server/src/model/types.ts
git commit -m "types: redefine llmJudge rule with inline fields"
```

---

## Task 2: 重写 llmJudge.ts 执行逻辑

**Files:**
- Modify: `server/src/assert/llmJudge.ts`

- [ ] **Step 1: 写失败测试**

Create: `server/tests/assert/llmJudge.test.ts`

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseJudgePassResponse } from '../src/assert/llmJudge.js';

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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/newbeefly/Coder/Project/cursor/image-tester/server && npx tsx --test tests/assert/llmJudge.test.ts`
Expected: 失败，因为 `parseJudgePassResponse` 还没导出或文件路径不对。

- [ ] **Step 3: 修改 `parseJudgePassResponse` 以支持 Markdown fence**

在 `server/src/assert/llmJudge.ts` 中，修改 `parseJudgePassResponse` 开头：

```ts
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
  // ... 剩余逻辑不变
```

- [ ] **Step 4: 重写 `evaluateLlmJudgeRule` 使用内嵌字段**

将 `evaluateLlmJudgeRule` 函数整体替换为：

```ts
const DEFAULT_JUDGE_SYSTEM_PROMPT = `你是一位结果判定员。请根据用户提供的【模型输出】和【期望信息】，判断模型输出是否符合期望。
只输出 JSON，不要任何解释：{"pass": true/false, "reason": "简要原因"}`;

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
    lastRecognition: visionOutputText,
    visionOutput: visionOutputText,
  };

  const system = renderTextPlaceholders(rule.system_prompt?.trim() || DEFAULT_JUDGE_SYSTEM_PROMPT, vars);
  const user = renderTextPlaceholders(rule.user_prompt_template, vars);

  const model = rule.model?.trim() || provider.default_model;
  const extraParams = mergeParams(provider.default_params_json, rule.params_json ?? null);

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
```

- [ ] **Step 5: 清理不再使用的 import**

移除 `server/src/assert/llmJudge.ts` 顶部的：

```ts
import * as promptsRepo from '../repository/promptsRepo.js';
```

以及 `IMG_PH` 常量（不再需要检查 `{{img:}}`，因为系统已固定走纯文本）。

- [ ] **Step 6: 运行测试**

Run: `cd /Users/newbeefly/Coder/Project/cursor/image-tester/server && npx tsx --test tests/assert/llmJudge.test.ts`
Expected: 全部 PASS。

- [ ] **Step 7: 运行 TypeScript 检查**

Run: `cd /Users/newbeefly/Coder/Project/cursor/image-tester/server && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 8: Commit**

```bash
git add server/src/assert/llmJudge.ts server/tests/assert/llmJudge.test.ts
git commit -m "feat(assert): inline llmJudge evaluation with markdown fence parsing"
```

---

## Task 3: 后端断言规则校验

**Files:**
- Modify: `server/src/controller/http.ts`

- [ ] **Step 1: 新增 `llmJudge` 规则校验函数**

在 `server/src/controller/http.ts` 的 `validateOutputSchemaJson` 之后新增：

```ts
function validateLlmJudgeRule(rule: unknown, index: number): void {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    const err = new Error(`第 ${index + 1} 条 LLM 判定规则格式错误`);
    (err as Error & { statusCode?: number }).statusCode = 400;
    throw err;
  }
  const r = rule as Record<string, unknown>;
  if (typeof r.provider_profile_id !== 'number' || !Number.isFinite(r.provider_profile_id) || r.provider_profile_id <= 0) {
    const err = new Error(`第 ${index + 1} 条 LLM 判定规则缺少合法的 provider_profile_id`);
    (err as Error & { statusCode?: number }).statusCode = 400;
    throw err;
  }
  if (typeof r.user_prompt_template !== 'string' || !r.user_prompt_template.trim()) {
    const err = new Error(`第 ${index + 1} 条 LLM 判定规则 user_prompt_template 不能为空`);
    (err as Error & { statusCode?: number }).statusCode = 400;
    throw err;
  }
  if (r.params_json != null && typeof r.params_json === 'string' && r.params_json.trim()) {
    try {
      JSON.parse(r.params_json);
    } catch {
      const err = new Error(`第 ${index + 1} 条 LLM 判定规则 params_json 不是合法 JSON`);
      (err as Error & { statusCode?: number }).statusCode = 400;
      throw err;
    }
  }
}
```

- [ ] **Step 2: 在保存测试集/用例时调用校验**

找到 `parseAssertionConfig` 调用处（创建和更新测试集、用例共 4 处），在调用后增加：

```ts
const cfg = parseAssertionConfig(body.default_assertions_json); // 或 case override
for (let i = 0; i < cfg.rules.length; i++) {
  if (cfg.rules[i].type === 'llmJudge') {
    validateLlmJudgeRule(cfg.rules[i], i);
  }
}
```

四处位置：
- `app.post('/api/test-suites', ...)` 内
- `app.patch('/api/test-suites/:id', ...)` 内
- `app.post('/api/test-suites/:suiteId/cases', ...)` 内
- `app.patch('/api/test-cases/:id', ...)` 内

- [ ] **Step 3: 运行 TypeScript 检查**

Run: `cd /Users/newbeefly/Coder/Project/cursor/image-tester/server && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add server/src/controller/http.ts
git commit -m "feat(api): validate inline llmJudge rule fields"
```

---

## Task 4: 前端 AssertionBuilder 支持 LLM 判定

**Files:**
- Modify: `web/src/components/AssertionBuilder.tsx`
- Modify: `web/src/App.css`

- [ ] **Step 1: 新增必要类型和常量**

在 `web/src/components/AssertionBuilder.tsx` 顶部，在 `type EditorRule` 之前新增：

```ts
export interface LlmJudgeRuleData {
  provider_profile_id: number | '';
  model: string;
  params_json: string;
  system_prompt: string;
  user_prompt_template: string;
}
```

在 `AssertionBuilderProps` 中新增：

```ts
export interface AssertionBuilderProps {
  value: string;
  onChange: (next: string) => void;
  schemaFields?: SchemaFieldOption[];
  varKeys?: string[];
  /** LLM 判定可选的 Provider 档案列表 */
  providerProfiles?: { id: number; name: string; default_model: string }[];
}
```

- [ ] **Step 2: 新增 `EditorRule` 联合类型**

```ts
type EditorRule =
  | { kind: 'visual'; data: VisualRule }
  | { kind: 'llmJudge'; data: LlmJudgeRuleData }
  | { kind: 'unknown'; raw: unknown }
```

- [ ] **Step 3: 新增解析/序列化逻辑**

在 `toEditor` 函数中，在 `return { kind: 'unknown', raw }` 之前增加 `llmJudge` 分支：

```ts
if (type === 'llmJudge') {
  return {
    kind: 'llmJudge',
    data: {
      provider_profile_id: typeof r.provider_profile_id === 'number' ? r.provider_profile_id : '',
      model: String(r.model ?? ''),
      params_json: typeof r.params_json === 'string' ? r.params_json : '',
      system_prompt: typeof r.system_prompt === 'string' ? r.system_prompt : '',
      user_prompt_template: typeof r.user_prompt_template === 'string' ? r.user_prompt_template : '',
    },
  };
}
```

新增 `llmJudgeToJson` 函数：

```ts
function llmJudgeToJson(data: LlmJudgeRuleData): Record<string, unknown> | null {
  if (!data.provider_profile_id && data.provider_profile_id !== 0) return null;
  const out: Record<string, unknown> = {
    type: 'llmJudge',
    provider_profile_id: Number(data.provider_profile_id),
  };
  if (data.model.trim()) out.model = data.model.trim();
  if (data.params_json.trim()) out.params_json = data.params_json.trim();
  if (data.system_prompt.trim()) out.system_prompt = data.system_prompt.trim();
  out.user_prompt_template = data.user_prompt_template;
  return out;
}
```

修改 `editorToJson`：

```ts
function editorToJson(rules: EditorRule[]): string {
  const out: unknown[] = [];
  for (const r of rules) {
    if (r.kind === 'visual') {
      const j = visualToJsonRule(r.data);
      if (j) out.push(j);
    } else if (r.kind === 'llmJudge') {
      const j = llmJudgeToJson(r.data);
      if (j) out.push(j);
    } else {
      out.push(r.raw);
    }
  }
  return JSON.stringify({ rules: out }, null, 2);
}
```

- [ ] **Step 4: 新增 LLM 判定规则编辑组件**

在文件末尾新增 `LlmJudgeRuleRow` 组件：

```tsx
const DEFAULT_JUDGE_SYSTEM = `你是一位结果判定员。请根据用户提供的【模型输出】和【期望信息】，判断模型输出是否符合期望。
只输出 JSON，不要任何解释：{"pass": true/false, "reason": "简要原因"}`;

function LlmJudgeRuleRow(props: {
  rule: LlmJudgeRuleData;
  providerProfiles: { id: number; name: string; default_model: string }[];
  varKeys: string[];
  onChange: (patch: Partial<LlmJudgeRuleData>) => void;
  onRemove: () => void;
}) {
  const { rule, providerProfiles, varKeys, onChange, onRemove } = props;
  const userRef = useRef<HTMLTextAreaElement>(null);

  function insertVar(varName: string) {
    const el = userRef.current;
    if (!el) return;
    const start = el.selectionStart ?? rule.user_prompt_template.length;
    const end = el.selectionEnd ?? start;
    const before = rule.user_prompt_template.slice(0, start);
    const after = rule.user_prompt_template.slice(end);
    const inserted = `{{var:${varName}}}`;
    const next = before + inserted + after;
    onChange({ user_prompt_template: next });
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + inserted.length;
      el.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="abLlmJudgeCard">
      <div className="abLlmJudgeHeader">
        <span className="abLlmJudgeBadge">LLM 判定</span>
        <button type="button" className="btn btnGhost" onClick={onRemove}>
          删
        </button>
      </div>

      <div className="abLlmJudgeField">
        <label>判定 Provider *</label>
        <select
          className="abInput"
          value={rule.provider_profile_id}
          onChange={(e) => onChange({ provider_profile_id: Number(e.target.value) })}
        >
          <option value="">请选择 Provider 档案</option>
          {providerProfiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}（默认 {p.default_model}）
            </option>
          ))}
        </select>
      </div>

      <div className="abLlmJudgeField">
        <label>判定模型（可选）</label>
        <input
          className="abInput"
          placeholder="留空使用 Provider 默认模型"
          value={rule.model}
          onChange={(e) => onChange({ model: e.target.value })}
        />
      </div>

      <details className="abLlmJudgeDetails">
        <summary>请求参数（可选）</summary>
        <textarea
          className="modalTextarea"
          placeholder='{"temperature": 0.1}'
          value={rule.params_json}
          onChange={(e) => onChange({ params_json: e.target.value })}
        />
      </details>

      <div className="abLlmJudgeField">
        <div className="abLlmJudgeLabelRow">
          <label>System 提示词（可选）</label>
          <button
            type="button"
            className="btn btnGhost btnTiny"
            onClick={() => onChange({ system_prompt: DEFAULT_JUDGE_SYSTEM })}
          >
            恢复默认
          </button>
        </div>
        <textarea
          className="modalTextarea"
          style={{ minHeight: 120 }}
          placeholder="留空使用默认约束模板"
          value={rule.system_prompt}
          onChange={(e) => onChange({ system_prompt: e.target.value })}
        />
      </div>

      <div className="abLlmJudgeField">
        <label>User 提示词模板 *</label>
        <textarea
          ref={userRef}
          className="modalTextarea"
          style={{ minHeight: 160 }}
          placeholder="例如：模型输出：&#10;{{var:modelOutput}}&#10;&#10;请判断..."
          value={rule.user_prompt_template}
          onChange={(e) => onChange({ user_prompt_template: e.target.value })}
        />
      </div>

      <div className="abLlmJudgeVars">
        <span className="muted">可用变量：</span>
        {['modelOutput', ...varKeys].map((vk) => (
          <button
            key={vk}
            type="button"
            className="abVarTag"
            onClick={() => insertVar(vk)}
          >
            {vk}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 修改渲染逻辑和新增按钮**

修改 `AssertionBuilder` 的 `rules.map` 渲染，增加 `llmJudge` 分支：

```tsx
{rules.map((r, i) =>
  r.kind === 'visual' ? (
    <VisualRuleRow ... />
  ) : r.kind === 'llmJudge' ? (
    <LlmJudgeRuleRow
      key={i}
      rule={r.data}
      providerProfiles={providerProfiles}
      varKeys={varKeys}
      onChange={(patch) => updateLlmJudge(i, patch)}
      onRemove={() => removeRule(i)}
    />
  ) : (
    <div className="abRuleRow abRuleRow--advanced" key={i}>...</div>
  ),
)}
```

新增 `updateLlmJudge` 和 `addLlmJudge` 函数：

```ts
function updateLlmJudge(i: number, patch: Partial<LlmJudgeRuleData>) {
  const next = rules.map((r, idx) =>
    idx === i && r.kind === 'llmJudge' ? { ...r, data: { ...r.data, ...patch } } : r,
  );
  emitRules(next);
}

function addLlmJudge() {
  emitRules([
    ...rules,
    {
      kind: 'llmJudge',
      data: {
        provider_profile_id: '',
        model: '',
        params_json: '',
        system_prompt: '',
        user_prompt_template: '',
      },
    },
  ]);
}
```

在「+ 新增规则」按钮旁边新增：

```tsx
<button type="button" className="btn btnGhost" onClick={addLlmJudge}>
  + LLM 判定
</button>
```

- [ ] **Step 6: 更新父组件传入 `providerProfiles`**

在 `web/src/App.tsx` 中使用 `AssertionBuilder` 的两处，需要传入 `providerProfiles`：

```tsx
<AssertionBuilder
  value={suiteForm.default_assertions_json}
  onChange={...}
  schemaFields={...}
  varKeys={...}
  providerProfiles={providerProfiles.map((p) => ({ id: p.id, name: p.name, default_model: p.default_model }))}
/>
```

两处分别位于测试集默认断言（搜索 `<AssertionBuilder` 第一处）和用例覆盖断言（搜索 `<AssertionBuilder` 第二处）。

如果当前组件尚未获取 `providerProfiles`，需要在 `App.tsx` 对应区域从已有状态中获取，例如已有 `providerProfiles` 状态时直接传入：

```tsx
providerProfiles={providerProfiles}
```

- [ ] **Step 7: 添加样式**

在 `web/src/App.css` 末尾新增：

```css
.abLlmJudgeCard {
  border: 1px solid var(--border, #ddd);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
  background: var(--card-bg, #fafafa);
}

.abLlmJudgeHeader {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.abLlmJudgeBadge {
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: #7c3aed;
  padding: 2px 8px;
  border-radius: 4px;
}

.abLlmJudgeField {
  margin-bottom: 12px;
}

.abLlmJudgeField label {
  display: block;
  font-size: 12px;
  margin-bottom: 4px;
  color: var(--muted, #666);
}

.abLlmJudgeLabelRow {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.abLlmJudgeDetails {
  margin-bottom: 12px;
}

.abLlmJudgeDetails summary {
  font-size: 12px;
  color: var(--muted, #666);
  cursor: pointer;
}

.abLlmJudgeVars {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  font-size: 12px;
}

.abVarTag {
  font-size: 12px;
  padding: 2px 6px;
  border: 1px solid var(--border, #ddd);
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
}

.abVarTag:hover {
  background: #f0f0f0;
}

.btnTiny {
  font-size: 11px;
  padding: 2px 6px;
}
```

- [ ] **Step 8: 前端校验与构建检查**

在 `AssertionBuilder` 的 `emitRules` 之前增加简单校验：若存在 `llmJudge` 规则且 `provider_profile_id` 为空或 `user_prompt_template` 为空，则给出提示（如 alert 或在卡片顶部显示红色提示），避免保存后被后端 400 拒绝。

Run: `cd /Users/newbeefly/Coder/Project/cursor/image-tester/web && npm run build`
Expected: 构建成功。

- [ ] **Step 9: Commit**

```bash
git add web/src/components/AssertionBuilder.tsx web/src/App.css web/src/App.tsx
git commit -m "feat(web): inline LLM judge assertion editor"
```

---

## Task 5: 联调与验证

- [ ] **Step 1: 启动后端**

Run: `cd /Users/newbeefly/Coder/Project/cursor/image-tester/server && npm run dev`
Expected: 服务在 8787 启动。

- [ ] **Step 2: 启动前端**

Run: `cd /Users/newbeefly/Coder/Project/cursor/image-tester/web && npm run dev`
Expected: Vite 服务启动，通常端口 5173。

- [ ] **Step 3: 浏览器验证**

打开前端页面，按以下步骤验证：
1. 进入一个测试集编辑页。
2. 在「默认断言」区域点击「+ LLM 判定」。
3. 选择 Provider、填写 user prompt（包含 `{{var:modelOutput}}` 和某个用例变量）。
4. 保存测试集。
5. 发起批量运行。
6. 查看运行结果详情，确认 LLM 判定规则被调用并显示判定详情。

- [ ] **Step 4: 边界验证**

1. Provider 未选时保存，应触发校验错误。
2. user prompt 为空时保存，应触发校验错误。
3. params_json 非法 JSON 时保存，应触发校验错误。
4. 只保留 LLM 判定规则，验证纯 LLM 判定模式。
5. LLM 判定 + jsonPath 严格规则共存，验证混合模式。

- [ ] **Step 5: Commit（如仅有配置数据变更则跳过）**

---

## Task 6: 收尾

- [ ] **Step 1: 更新 examples（可选）**

修改 `examples/assertion-llm-judge-storefront.json` 为新字段格式：

```json
{
  "rules": [
    {
      "type": "llmJudge",
      "provider_profile_id": 1,
      "model": "gpt-4o-mini",
      "system_prompt": "你是一位结果判定员。请根据用户提供的【模型输出】和【期望信息】，判断模型输出是否符合期望。只输出 JSON：{\"pass\": true/false, \"reason\": \"简要原因\"}",
      "user_prompt_template": "模型输出：\n{{var:modelOutput}}\n\n期望店名：{{var:storeName}}\n\n请判断二者是否语义一致。"
    }
  ]
}
```

- [ ] **Step 2: 删除/更新旧文档 `examples/llm-judge-prompt-template.md`**

由于不再需要预先创建提示词模板，该示例文档已过时。可选择：
- 删除该文件；或
- 重写为「LLM 判定断言：内嵌配置示例」。

建议删除，避免误导。

- [ ] **Step 3: 运行全量 TypeScript 检查**

Run:
```bash
cd /Users/newbeefly/Coder/Project/cursor/image-tester/server && npx tsc --noEmit
cd /Users/newbeefly/Coder/Project/cursor/image-tester/web && npm run build
```
Expected: 均无错误。

- [ ] **Step 4: 最终 Commit**

```bash
git add examples/
git commit -m "docs: update llmJudge examples to inline format"
```

---

## 补充：server package.json 测试脚本

在 `server/package.json` 的 `scripts` 中新增：

```json
"test": "tsx --test tests/assert/llmJudge.test.ts"
```

这样后续可直接运行 `npm test` 执行后端单元测试。

---

## 自检清单

对照规格文档检查：

- [x] 数据结构：使用 `provider_profile_id`、`model`、`params_json`、`system_prompt`、`user_prompt_template`。
- [x] 后端执行：读取 Provider、合并参数、注入 `modelOutput` 和用例变量、调用 `chatText`、解析结果。
- [x] 结果解析：支持 Markdown code block 包裹和首行兜底。
- [x] 前端 UI：卡片式面板、Provider 下拉、模型输入、折叠参数、system/user textarea、变量标签。
- [x] 校验：前后端均校验必填字段和 `params_json` JSON 合法性。
- [x] 错误处理：Provider 不存在、模板为空、请求失败、无法解析均有明确 detail。
- [x] 兼容性：废弃旧字段，无迁移逻辑。
