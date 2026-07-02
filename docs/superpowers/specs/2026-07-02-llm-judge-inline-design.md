# LLM Judge 内嵌式断言设计

## 背景

当前断言系统主要依赖代码实现的严格匹配（包含、正则、jsonPath、自定义脚本等）。视觉大模型的输出常有合理偏差（如标点、空格、同义表达），严格规则容易误杀。因此需要引入「大模型判定者」——LLM Judge，让另一个大模型根据模型输出和标注信息柔性判断是否合规。

现有后端已实现 `llmJudge` 规则，但依赖先在「提示词模板」表创建模板、再在断言 JSON 中引用 ID，前端也只能在 JSON 原文中编辑。本设计改为**在断言编辑器中直接内嵌配置**，无需预先创建提示词模板。

## 目标

1. 在测试集/用例的断言编辑器里，直接新增「LLM 判定」规则。
2. 可在规则内选择判定 Provider、覆盖模型、填写 system/user 提示词。
3. 提示词支持引用变量：模型输出（`modelOutput`）和用例变量（来自 `variables_json`/清单/侧车）。
4. 判定结果与现有断言规则统一走 AND 逻辑。
5. 判定失败时给出明确原因，便于排查是模型问题还是提示词问题。

## 范围

- 仅支持**纯文本**判定模型，不把原图传给判定模型。
- 本次废弃旧 `llmJudge` 字段（`judge_prompt_profile_id`、`judge_provider_profile_id` 等），采用新的内嵌式字段；经检查当前数据库无旧规则数据，可安全废弃。

## 数据结构

### AssertionRule 扩展

```ts
type AssertionRule =
  | ... // 原有规则不变
  | {
      type: 'llmJudge';
      provider_profile_id: number;        // 必填：选择已有 Provider 档案
      model?: string | null;               // 可选：覆盖 Provider 默认模型
      params_json?: string | null;         // 可选：覆盖请求参数 JSON
      system_prompt?: string | null;       // 可选：不填时使用默认约束模板
      user_prompt_template: string;        // 必填：判定提示词模板
    };
```

### JSON 示例

```json
{
  "rules": [
    {
      "type": "llmJudge",
      "provider_profile_id": 1,
      "model": "gpt-4o-mini",
      "system_prompt": "你是一位结果判定员。请根据【模型输出】和【期望信息】判断是否合格。只输出 JSON：{\"pass\": true/false, \"reason\": \"简要原因\"}",
      "user_prompt_template": "模型输出：\n{{var:modelOutput}}\n\n期望钢印存在：{{var:exists_steel_seal}}\n\n请判断模型输出是否与期望一致。"
    }
  ]
}
```

## 后端执行流程

1. **读取 Provider**：通过 `rule.provider_profile_id` 查询 Provider 档案；不存在则规则失败。
2. **确定模型**：`rule.model?.trim() || provider.default_model`。
3. **合并参数**：分别解析 `provider.default_params_json` 和 `rule.params_json`（若存在且非空），后者覆盖前者。
4. **注入变量**：
   - 基础变量：`modelOutput`、`visionOutput`、`lastRecognition`（均指向视觉模型输出文本）。
   - 用例变量：来自合并后的 `variables_json`、清单、侧车。
   - 注意：`system_prompt` 为空字符串时视为未填写，使用默认模板。
5. **渲染提示词**：使用 `renderTextPlaceholders` 替换 `{{var:xxx}}`。
6. **调用判定模型**：走 `chatText` 纯文本接口。
7. **解析结果**：
   - 先去掉可能的 Markdown code block 包裹（` ```json ... ``` ` / ` ``` ... ``` `）。
   - 尝试提取 JSON 并读取 `pass` 字段。
   - JSON 失败则读首行：PASS/YES/OK/是/true/1/通过 为通过；FAIL/NO/否/false/0/不通过 为不通过。
   - 都无法解析则规则失败。

### 默认 System Prompt

当用户未填写 `system_prompt` 时，后端自动拼接：

```text
你是一位结果判定员。请根据用户提供的【模型输出】和【期望信息】，判断模型输出是否符合期望。
只输出 JSON，不要任何解释：{"pass": true/false, "reason": "简要原因"}
```

## 前端交互设计

### 规则入口

- 在 `AssertionBuilder` 可视化模式下，新增「+ LLM 判定」按钮。
- LLM 判定规则单独占一行，内部用卡片式面板展开，不挤占普通规则的三列布局。

### 配置面板字段

1. **判定 Provider**（必填）：下拉选择现有 Provider 档案。
2. **判定模型**（可选）：input，placeholder「留空使用 Provider 默认模型」。
3. **请求参数**（可选，默认折叠）：textarea，placeholder `{"temperature": 0.1}`。
4. **System 提示词**（可选）：textarea，min-height 120px；上方提供「恢复默认」按钮。
5. **User 提示词模板**（必填）：textarea，min-height 160px，可拖拽拉高。
6. **可用变量提示**：在 user prompt 下方显示变量标签，如 `{{var:modelOutput}}`、`{{var:exists_steel_seal}}`，点击可插入到光标处。

### 校验

- 保存测试集/用例前，前端校验 `provider_profile_id` 已选、`user_prompt_template` 非空。
- 后端在 `http.ts` 中通过 `parseAssertionConfig` 校验 JSON 结构，并补充 `llmJudge` 字段校验。

## 错误处理

| 场景 | 行为 | detail 示例 |
| --- | --- | --- |
| Provider 档案不存在 | 规则失败 | `判定 Provider #1 不存在` |
| `user_prompt_template` 为空 | 规则失败 | `LLM 判定 user 提示词模板为空` |
| 请求判定模型失败 | 规则失败 | `LLM 判定请求失败：timeout` |
| 返回无法解析 | 规则失败 | `无法解析判定结果；回复：xxx` |
| 模型返回 JSON 但无 pass 字段 | 规则失败 | `无法解析判定结果；回复：xxx` |
| 模型明确返回 `pass: false` | 规则失败 | `LLM 判定：JSON.pass 为 false；原因：xxx` |

## 与现有断言的关系

- 断言配置 `{ "rules": [...] }` 中所有规则仍为 AND 关系。
- LLM 判定规则可与严格规则共存，也可单独使用。
- 批量运行时，`evaluateAssertionConfigAsync` 识别 `type: 'llmJudge'` 并异步调用判定模型。

## 兼容性说明

- 旧 `llmJudge` 字段（`judge_prompt_profile_id`、`judge_provider_profile_id`、`judge_model_override`、`judge_params_override_json`）在本次实现后直接废弃。
- 经检查当前数据库中无旧 `llmJudge` 规则数据，无需迁移逻辑。

## 验收标准

1. 前端 AssertionBuilder 可以可视化新增、编辑、删除 LLM 判定规则。
2. 配置面板可以正确选择 Provider、填写模型和提示词。
3. 批量运行时，LLM 判定规则能正确调用判定模型并解析结果。
4. 提示词中的 `{{var:modelOutput}}` 和用例变量被正确替换。
5. 判定失败时，报告详情中能看到明确原因。
6. 纯 LLM 判定、纯严格判定、混合判定三种组合都能正常工作。
