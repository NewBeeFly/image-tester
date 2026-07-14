---
name: prompt-optimization
description: 提示词优化策略和最佳实践，指导如何针对性地修改 system_prompt 和 user_prompt_template
related_tools:
  - get_prompt_profile
  - update_prompt_profile
---

# 提示词优化技能

## 使用场景
当需要修改提示词模板以提升模型输出质量时，加载此技能。

## 优化策略

### 1. System Prompt 优化
- **明确输出格式**：在 system_prompt 中清晰描述期望的输出 JSON 结构
- **增加约束条件**：针对常见错误类型添加约束（如"不要输出空字符串"）
- **添加示例**：提供 few-shot 示例，展示期望的输入-输出对
- **强调关键字段**：对容易出错的字段加强说明

### 2. User Prompt Template 优化
- **变量引用检查**：确认 `{{var:key}}` 引用的变量在用例中存在
- **指令清晰度**：使用更明确的指令语言（"请输出"而非"输出"）
- **结构引导**：在 user_prompt 中给出输出结构的引导

### 3. Output Schema 优化
- **字段描述增强**：为每个字段添加更详细的 description
- **枚举约束**：对有限取值的字段使用 enum 类型
- **必填标记**：标记关键 required 字段

## 修改展示格式

修改前向用户展示时，使用以下格式：

```
**修改字段**: system_prompt
**修改原因**: 45% 的失败是因为 scene_no 识别错误

修改前:
...原内容...

修改后:
...新内容...
```

## 注意事项
- 每次只修改一个方面，便于验证效果
- 修改后建议用户重新运行测试对比
- 保留修改历史（通过 notes 字段记录）
