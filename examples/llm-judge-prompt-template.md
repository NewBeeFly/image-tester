# LLM 判定断言：提示词模板示例（门头名称语义一致）

在「提示词模板」中**新建一条**，专门用于 `llmJudge` 规则（**不要**包含 `{{img:}}`，仅文本 + `{{var:…}}`）。

## 系统提示词（system_prompt）示例

```
你是门店门头识别结果的校验员。只比较「语义是否指向同一店名」，忽略标点、全半角、空格、大小写、书名号等格式差异。
输出要求：第一行只写 PASS 或 FAIL；如需解释从第二行起简要说明。
```

## 用户提示词（user_prompt_template）示例

```
【模型对图识别出的原文】（可能含格式噪声）：
{{var:modelOutput}}

【元数据中的期望店名】（来自 variables / 侧车 / 清单）：
{{var:storeName}}

请判断二者是否表示同一店名。第一行只输出 PASS 或 FAIL。
```

## 可用占位符（自动注入）

| 占位符 | 含义 |
| --- | --- |
| `{{var:modelOutput}}` | 本次视觉任务模型返回的**完整文本**（即「上一次识别结果」） |
| `{{var:lastRecognition}}` | 与 `modelOutput` 相同 |
| `{{var:visionOutput}}` | 与 `modelOutput` 相同 |
| `{{var:你的键}}` | 与主任务相同：来自**合并后的用例元数据** `variables`（含库内、清单、侧车） |

例如：`variables` 里有 `storeName`，可写 `{{var:storeName}}`。

## 断言 JSON 中配置

在测试集「默认断言」或「用例级覆盖」里增加一条规则（示例见 `assertion-llm-judge-storefront.json`），把 `judge_prompt_profile_id` 设为上面模板在数据库里的 ID。

可选字段：

- `judge_provider_profile_id`：不填则与当前批量运行使用**同一 Provider**；填了则用指定 Provider 调判定模型。
- `judge_model_override`：判定用的模型名（不填则用该 Provider 默认模型）。
- `judge_params_override_json`：判定请求的参数 JSON（与 Provider 默认合并）。

## 判定结果解析

后端会优先解析回复中的 JSON `{ "pass": true }` / `{ "pass": false }`；否则读**首行**是否为 `PASS`、`FAIL`、`通过` 等。
