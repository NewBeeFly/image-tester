---
name: image-tester-context
description: 图片Agent测试平台的数据模型和核心概念说明
related_tools: []
---

# 图片Agent测试平台上下文

## 核心概念

本平台用于批量测试「视觉大模型 + 提示词」的效果，核心实体：

- **Provider 档案**：LLM 服务配置（base_url、api_key、model），支持 OpenAI 兼容/DashScope/火山方舟
- **提示词模板（PromptProfile）**：包含 system_prompt、user_prompt_template、output_schema_json
- **测试集（TestSuite）**：一组图片用例的集合，包含默认断言配置和全局变量
- **测试用例（TestCase）**：单张图片 + 变量 + 可选断言覆盖
- **测试运行（TestRun）**：使用特定 Provider + 提示词模板对测试集执行批量推理
- **运行结果（TestRunItem）**：每条用例的模型输出、断言详情、通过/失败状态

## 数据关系

- 一次 TestRun 关联一个 TestSuite、一个 ProviderProfile、一个 PromptProfile
- TestRun 包含多个 TestRunItem，每个对应一个 TestCase
- TestRunItem.pass = 1 表示通过，0 表示失败，null 表示未判定

## 断言类型

- `contains` / `regex`：文本匹配
- `jsonPath`：JSON 路径取值比较（equals、inList、regex、numericEquals、arrayContainsAll 等）
- `customScript`：自定义 JS 表达式
- `llmJudge`：调用另一个 LLM 做合规判定

## 变量系统

变量按优先级合并（高覆盖低）：
1. 用例 variables_json（数据库，最高优先）
2. 侧车 JSON（磁盘文件）
3. 清单 metadata.json
4. 测试集 global_variables_json（最低优先）

变量在提示词中通过 `{{var:key}}` 引用，图片通过 `{{img:alias}}` 引用。
