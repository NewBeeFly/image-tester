# 交互式 Agent 系统设计

## 概述

为图片 Agent 测试平台新增交互式 AI Agent 能力，使用 LangGraph.js 构建 ReAct 循环 Agent，支持对话式分析报告、优化提示词。前端以浮动窗口形式提供对话界面。

## 架构

```
┌─────────────────────────────────────────────────────────┐
│                     React Frontend                       │
│  ┌──────────────────────────────────┐  ┌──────────────┐ │
│  │    现有 Tab 页面                  │  │  AI 浮窗      │ │
│  │    (Provider/提示词/测试集/       │  │  (可拖拽)     │ │
│  │     运行/报告)                    │  └──────┬───────┘ │
│  └──────────────────────────────────┘         │         │
└───────────────────────────────────────────────┼─────────┘
                                                │ SSE
┌───────────────────────────────────────────────┼─────────┐
│                 Fastify Backend                │         │
│  ┌──────────────────────────┐  ┌──────────────┴───────┐ │
│  │  现有 API 路由            │  │  Agent API 路由       │ │
│  │  /api/test-runs, ...     │  │  /api/agent/chat     │ │
│  └──────────────────────────┘  │  /api/agent/sessions │ │
│                                └──────────┬───────────┘ │
│                               ┌───────────┴───────────┐ │
│                               │   Agent Service       │ │
│                               │   (LangGraph ReAct)   │ │
│                               └─────┬────────┬────────┘ │
│                              ┌──────┴──┐ ┌───┴────────┐ │
│                              │ Tools    │ │ Skills     │ │
│                              │ (内置+API)│ │ (磁盘.md)  │ │
│                              └──────────┘ └────────────┘ │
│                                                          │
│  Agent 定义目录: server/src/agents/                       │
└──────────────────────────────────────────────────────────┘
```

### 关键决策

- **LLM 提供者**：复用现有数据库中的 Provider 档案（base_url / api_key / model）
- **Agent 框架**：LangGraph.js `createReactAgent` + `@langchain/openai` ChatOpenAI
- **Skills 机制**：渐进式加载——system prompt 只放技能目录摘要，agent 按需通过 `load_skill` 工具加载完整内容
- **数据存储**：SQLite `agent_sessions` + `agent_messages` 表

## Agent 定义系统（目录结构）

```
server/src/agents/
├── registry.ts              # Agent 注册表：扫描目录，加载 agent 定义
├── loader.ts                # 加载器：读取 system.md、扫描 skills/
├── common/                  # 全局共享层
│   └── skills/
│       └── image-tester-context/
│           └── skill.md     # 测试平台通用上下文（数据模型、API 说明等）
└── optimizer/               # 提示词优化 Agent（首个实现）
    ├── system.md            # system prompt（核心角色定义+行为指令）
    ├── config.json          # agent 配置
    └── skills/
        ├── report-analysis/
        │   └── skill.md     # 报告分析策略
        ├── report-optimization/
        │   ├── skill.md     # 报告优化完整工作流（格式化+图片传递指导）
        │   └── reference/
        │       └── examples.md
        ├── prompt-optimization/
        │   └── skill.md     # 提示词优化策略
        └── assertion-debug/
            └── skill.md     # 断言失败调试
```

### config.json 示例

```json
{
  "name": "optimizer",
  "displayName": "提示词优化助手",
  "defaultModel": null,
  "enabledSkills": ["report-analysis", "report-optimization", "prompt-optimization", "assertion-debug"],
  "globalSkills": ["image-tester-context"],
  "enabledTools": [
    "get_test_run_report",
    "get_run_items",
    "get_run_item_detail",
    "compare_runs",
    "get_prompt_profile",
    "update_prompt_profile",
    "list_test_suites",
    "list_test_runs",
    "list_prompt_profiles",
    "load_image_base64"
  ]
}
```

### 多 Agent 扩展

目录结构天然支持多 Agent：新增一个 Agent 只需在 `agents/` 下新建目录。目前只实现 `optimizer`。

## Skill 格式

每个 skill 是一个文件夹，必须有 `skill.md`（YAML frontmatter + markdown 正文）。可选 `reference/` 和 `scripts/` 子目录。

### skill.md 格式

```markdown
---
name: report-analysis
description: 分析测试运行报告，识别失败模式，总结通过率变化趋势
related_tools:
  - get_test_run_report
  - get_run_items
  - compare_runs
---

# 报告分析技能

## 使用场景
当用户询问测试运行结果、失败原因、通过率变化等问题时，加载此技能。

## 工作流程
1. 先调用 `get_test_run_report` 获取运行概览
2. 若用户关注失败用例，调用 `get_run_items(pass=false, limit=10)` 抽样
3. 分析失败模式，分类总结
4. 询问用户是否需要查看更多或深入分析某类模式

## 数据获取策略
- 失败数量 > 10 时，先抽样 10 条分析模式
- 图片数据不直接加载，只传递路径
- 按需渐进式获取，避免一次性加载全部数据
```

### 加载机制

1. **System prompt 中只放技能目录**（简要名称 + 描述）
2. Agent 按需调用 `load_skill("skill-name")` 工具加载完整 `skill.md`
3. `reference/` 下的文件 agent 通过 `read_file` 按需读取
4. Skills 包含工具使用指导，告诉 agent 在什么场景用哪些 tools

## 工具系统

### 内置工具（所有 agent 默认可用）

| 工具名 | 描述 | 说明 |
|--------|------|------|
| `read_file` | 读取指定路径文件内容 | 支持行范围，高效读取 |
| `write_file` | 写入/覆盖文件内容 | 限定工作目录 |
| `list_directory` | 列出目录内容 | 支持递归深度 |
| `bash_execute` | 执行 shell 命令 | 其他操作的兜底，超时保护 |
| `load_skill` | 加载指定技能的详细内容 | 渐进式 skill 加载 |
| `list_skills` | 列出所有可用技能 | 返回名称+描述列表 |
| `load_image_base64` | 将图片转为 base64 | 供视觉分析时使用，内置工具但在 config.json 中声明启用 |

### API 包装工具（按需在 config.json 声明）

| 工具名 | 描述 |
|--------|------|
| `get_test_run_report` | 获取运行概览：统计、Provider、提示词、测试集 |
| `get_run_items` | 获取运行中的用例结果（支持筛选 pass/fail + limit） |
| `get_run_item_detail` | 获取单条用例的完整输出和断言详情 |
| `compare_runs` | 对比多次运行的通过率变化趋势 |
| `get_prompt_profile` | 读取提示词模板完整内容 |
| `update_prompt_profile` | 更新提示词模板（system/user/schema） |
| `list_test_suites` | 列出所有测试集 |
| `list_test_runs` | 列出最近的运行记录 |
| `list_prompt_profiles` | 列出所有提示词模板 |

### 工具返回格式

**`get_test_run_report` 返回**：
```json
{
  "run": { "id": 109, "status": "completed", "pass": 158, "fail": 99, "total": 257 },
  "prompt_profile": { "id": 15, "name": "影石展台识别", "system_prompt": "...", "user_prompt_template": "...", "output_schema_json": "..." },
  "provider": { "name": "火山引擎方舟2.0", "model": "doubao-seed-2-0-pro-260215" },
  "suite": { "id": 21, "name": "影石展台识别" },
  "pass_rate": "61.5%",
  "avg_duration_ms": 6300
}
```

**`get_run_items` 返回**（每条）：
```json
{
  "case_id": 4228,
  "image_url": "/api/test-suites/21/image?relative_path=10-1D5B7E87.jpeg",
  "image_absolute_path": "/Users/.../data/test-suites/影石展台/10-1D5B7E87.jpeg",
  "model_output": "{ \"scene_no\": \"2\", \"match_reason\": \"...\" }",
  "assertion_failures": [
    { "rule": "jsonPath", "path": "$.scene_no", "expected": "10", "actual": "2" }
  ],
  "variables": { "expected_scene": "10" }
}
```

## LangGraph ReAct 运行循环

### 核心循环

```
用户消息 ──→ Agent Node ──→ 是否有 tool_calls？
                │                │
                │ Yes            │ No
                ▼                ▼
          Tool Node        流式输出最终回复
          (执行工具)            │
                │                ▼
                └──→ Agent Node (带工具结果继续)
```

### 实现

```typescript
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";

const chatModel = new ChatOpenAI({
  model: provider.default_model,
  apiKey: process.env[provider.api_key_env],
  configuration: { baseURL: provider.base_url },
});

const agent = createReactAgent({
  llm: chatModel,
  tools: allTools,
  recursionLimit: 20, // 最大工具调用轮次
});
```

### 终结条件

| 条件 | 说明 |
|------|------|
| 模型不返回 tool_calls | 正常终结 |
| 达到 recursionLimit | 安全兜底（默认 20 轮） |
| 用户取消 | 通过 cancel API 中断 |
| tool_calls.length === 0 | 兼容部分模型特殊行为 |

### SSE 事件类型

```typescript
{ type: "thinking", content: "..." }              // 思考文本片段
{ type: "tool_call", name: "...", args: {} }       // 调用工具
{ type: "tool_result", name: "...", result: "...", truncated: boolean }
{ type: "answer", content: "..." }                 // 最终回复片段
{ type: "done", messageId: 42 }                    // 完成
{ type: "error", message: "..." }                  // 错误
```

## 信息分层传递规范

Agent 向 LLM 传递分析上下文时，必须区分参考数据和指令。

### 消息构造结构（多条独立消息）

```typescript
const messages = [
  // 消息1: 报告总览 + 使用的提示词
  { role: "user", content: "以下是测试运行 #109 的报告摘要：\n通过率：61.5%...\n提示词模板 #15：\nsystem_prompt: '...'\nuser_prompt_template: '...'" },

  // 消息2: 失败案例 #4228 文字部分
  { role: "user", content: "---失败案例 #4228---\n变量: expected_scene=10\n模型输出: {...}\n断言失败: $.scene_no 期望 '10' 实际 '2'" },

  // 消息3: 失败案例 #4228 图片部分
  { role: "user", content: [{ type: "image_url", image_url: { url: "data:image/jpeg;base64,..." } }] },

  // 消息4: 失败案例 #4229 文字部分
  { role: "user", content: "---失败案例 #4229---\n..." },

  // 消息5: 失败案例 #4229 图片部分
  { role: "user", content: [{ type: "image_url", image_url: { url: "data:image/jpeg;base64,..." } }] },

  // ...每个失败案例各占2条消息（text + image）

  // 最后: 分析指令
  { role: "user", content: "请根据以上报告数据和失败案例，分析主要失败模式，并提出提示词优化建议。" }
]
```

### 图片传递策略

- 图片使用 multimodal 消息格式（`image_url` + base64），不塞入纯文本
- 优先用文字数据（输出、断言、变量）分析，仅当不足时加载图片
- 每次最多加载 2 张代表性图片，避免 token 爆炸
- 图片以「参考数据」身份传递，不作为指令

## 后端 API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/agents` | 列出可用 agent |
| `GET` | `/api/agent/sessions` | 列出所有会话 |
| `POST` | `/api/agent/sessions` | 创建会话（provider_profile_id + model + agent_name） |
| `GET` | `/api/agent/sessions/:id/messages` | 获取会话历史 |
| `DELETE` | `/api/agent/sessions/:id` | 删除会话 |
| `POST` | `/api/agent/chat` | 发送消息，SSE 流式返回 |
| `POST` | `/api/agent/chat/cancel` | 取消 agent 运行 |

### 数据库表

```sql
CREATE TABLE agent_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '新对话',
  provider_profile_id INTEGER NOT NULL REFERENCES provider_profiles(id),
  model TEXT,
  agent_name TEXT NOT NULL DEFAULT 'optimizer',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE agent_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,           -- user / assistant / tool
  content TEXT NOT NULL DEFAULT '',
  tool_calls_json TEXT,         -- assistant 的 tool_calls
  tool_call_id TEXT,            -- tool 消息对应的 call id
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## 前端 AI 浮窗

### 组件结构

- `AgentFloatingButton`：右下角固定圆形按钮，点击切换浮窗显隐
- `AgentChatPanel`：主对话面板
  - 顶栏：Agent 名称、会话管理（新建/切换/删除）、最小化、关闭
  - 消息流区域：流式渲染 markdown 回复
  - 输入栏：文本输入 + 发送按钮
  - 快捷入口栏：预设指令按钮

### 交互特性

| 特性 | 实现 |
|------|------|
| 悬浮触发 | 右下角固定按钮 |
| 位置模式 | ① 右侧挂载（默认）② 浮动可拖拽 |
| 工具过程卡片 | tool_call/tool_result 显示为可折叠卡片 |
| 图片预览 | 工具返回中的 image_url 渲染为可点击缩略图 |
| 操作按钮 | Agent 建议修改提示词时，回复中嵌入"应用修改"按钮 |
| 会话管理 | 顶栏切换/新建会话，历史持久化 |
| 流式渲染 | SSE 实时渲染，支持 markdown |

### 快捷入口（预设指令）

- "分析最近一次运行"
- "对比最近两次运行"
- "优化当前提示词"

点击后自动填充到输入框并发送。

### 新增前端依赖

- `react-markdown`：渲染 agent 回复中的 markdown

## 新增后端依赖

```json
{
  "@langchain/langgraph": "^0.x",
  "@langchain/openai": "^0.x",
  "@langchain/core": "^0.x"
}
```

## 实现优先级

### Phase 1：框架搭建（先完成）
1. 后端：agent 目录结构 + loader + registry
2. 后端：内置工具（read_file, write_file, list_directory, bash_execute, load_skill, list_skills）
3. 后端：API 包装工具（get_test_run_report, get_run_items 等）
4. 后端：LangGraph agent service + SSE 路由
5. 前端：浮窗组件 + 对话界面 + SSE 渲染
6. 首个 agent（optimizer）的 system.md + skills

### Phase 2：完善体验（后续迭代）
- 图片内联预览
- 提示词修改的 diff 对比
- 多 agent 支持
- LangGraph checkpointing 持久化
- 会话搜索

## 预留待办

- [ ] Skills 中 `scripts/` 目录的执行支持
- [ ] LangGraph checkpointing 集成（会话状态持久化）
- [ ] Agent 间通信（多 agent 协作）
- [ ] 前端图片内联预览优化
- [ ] 提示词修改 diff 对比视图
- [ ] Agent 运行日志/审计
- [ ] 技能热加载（不重启服务更新 skill）
