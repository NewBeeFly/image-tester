---
name: report-optimization
description: 报告分析与提示词优化的完整工作流，包含数据格式化和图片传递规范
related_tools:
  - get_test_run_report
  - get_run_items
  - get_run_item_detail
  - get_prompt_profile
  - update_prompt_profile
  - load_images_base64
---

# 报告优化技能

本技能指导 agent 完成从「报告分析」到「提示词优化」的完整闭环，包含视觉复核和输出示例补全。

## 完整工作流

### Phase 1：数据收集

1. 调用 `get_test_run_report(run_id)` 获取运行概览（含提示词模板 ID、提示词全文、output_schema_json）
2. 调用 `get_prompt_profile(prompt_id)` 加载该运行使用的完整提示词（确认 system_prompt、user_prompt_template、output_schema_json）
3. 调用 `get_run_items(run_id, pass=false, limit=10)` 抽样失败用例
4. **视觉复核**：从失败用例中挑选 **最多 3 个代表性案例**，收集它们的 `image_absolute_path`，调用 `load_images_base64(file_paths=[...])` 一次性批量获取 base64。工具返回 JSON 数组，每个元素有 `base64` 字段：
   - 解析每个元素的 `base64` 字段
   - 将每张图片作为独立 image message 传给模型
   - 让模型判断：原输出是否正确？失败根因是「模型识别错误」还是「断言/标注/配置问题」？

### Phase 2：失败模式分析

5. 将失败用例按断言类型和失败原因分组
6. 结合视觉复核结论，区分：
   - **模型识别错误**：模型输出与图片实际内容不符
   - **提示词理解错误**：模型没有按提示词要求输出（如漏字段、格式错）
   - **断言/标注问题**：模型输出合理，但断言期望或标注答案有误
7. 找出高频失败模式（Top 3）

### Phase 3：优化建议

8. 针对每种失败模式提出具体的提示词修改建议
9. **补全输出 Demo（如缺失）**：
   - 检查 system_prompt 中是否已包含输出示例（demo / 示例输出 / sample）
   - 如果没有，根据 `output_schema_json.fields` 和报告中的通过用例 `model_output`，补一个合理的 JSON 输出示例
   - Demo 必须放在 system_prompt 的「输出格式」「输出示例」或「识别判定规则」之后等合适位置
10. 展示修改前后的对比（diff 格式）
11. 等待用户确认

### Phase 4：应用修改

12. 用户确认后调用 `update_prompt_profile(prompt_id, system_prompt=完整新提示词)` 应用修改
13. 建议用户重新运行测试验证效果

## 数据格式化规范

### 消息构造（当需要向 LLM 传递分析上下文时）

每个失败案例拆为 2-3 条独立消息：
- 消息A（text）：变量 + 模型输出 + 断言失败原因 + 待分析问题
- 消息B（image）：图片（multimodal image_url 格式）
- 消息C（text）：分析指令

### 信息分层

- **参考数据**：运行统计、提示词内容、失败用例详情 —— 用明确标记包裹
- **指令**：分析请求、优化建议请求 —— 明确告知要做什么

### 图片处理策略

- 默认只传递图片路径（`image_absolute_path`）
- 需要视觉分析时调用 `load_images_base64` 批量获取 base64（返回 JSON 数组，用每个元素的 `base64` 字段）
- 每次最多加载 3 张代表性图片
- 图片以独立 image message 传递，不要拼在 text 里

## Demo 补全规范

当 system_prompt 缺少输出示例时，必须补齐一个清晰的 demo。

### Demo 来源（按优先级）

1. **报告中的通过用例**：从 `get_run_items(run_id, pass=true, limit=20)` 中选择一条 `model_output` 完整、质量高的作为基础
2. **output_schema_json**：根据 `fields` 定义，为每个字段填充合理示例值
3. **结合展台编号映射表**：如果提示词里有「展台编号和展台名称映射关系」，demo 中的 `scene_no` 必须来自该映射表

### Demo 格式要求

- 必须是有效的 JSON
- 必须包含 output_schema_json 中定义的所有字段
- 必须展示「差异特征优先」的推理过程（如 match_reason 要包含具体差异依据）
- 示例格式：

```markdown
## 输出示例

```json
{
  "scene_no": "23",
  "match_reason": "图片中可见白色落地大展柜、顶部发光 Insta360 LOGO、上层横向多机位陈列 Ace/X/GO/Flow 全系列、下层带锁玻璃仓储仓，整体体量明显大于标准小展柜，且台面横向展开程度强，符合 23 白色标准大展柜的核心特征；与 24 白色标准小展柜的区别在于体量更大、陈列更完整、主展位感更强。"
}
```
```

### Demo 放置位置

- 放在 system_prompt 的「输出格式规范」「识别判定规则」或「展台特征库」之后
- 确保模型在输出前能看到该示例

## 优化建议输出示例

```
## 运行 #39 优化建议

### 失败根因
| 根因 | 数量 | 占比 |
|------|------|------|
| 模型对图片识别错误 | 12 | 60% |
| match_reason 质量不足 | 5 | 25% |
| 断言/标注问题 | 3 | 15% |

### 视觉复核结论（3 张图）
- case_id=2301：实际为 23 白色标准大展柜，模型输出 24，属于识别错误
- case_id=2305：实际为 A1 复合展台，模型输出正确，但断言期望 A1 单独展台，属于标注问题
- case_id=2312：图片角度刁钻，模型输出 match_reason 为空，属于输出质量不足

### 建议修改
1. 在 system_prompt 中补充「白色标准大展柜 vs 小展柜」的体型差异对比说明
2. 补全输出 Demo（当前缺少）
3. 在 match_reason 规则中增加「必须 mention 至少 1 个与最相近类别的差异点」

### 修改后 Demo
```json
{...}
```
```
