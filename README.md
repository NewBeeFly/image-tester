# 图片 Agent 测试平台（网页版）

在本机用浏览器批量测试「视觉大模型 + 提示词」：选择 Provider（OpenAI 兼容协议，可对接阿里云 DashScope 兼容模式、火山方舟等）、配置模型与参数、维护测试图片集与断言规则，自动统计正确率并复盘失败样例。

## 功能概览

- **Provider 档案**：Base URL、默认模型、默认请求参数 JSON、API Key 对应的**环境变量名**（页面不保存密钥明文）。新建时按所选厂商（OpenAI / 阿里云 DashScope / 火山方舟）自动带出常用默认值，可再改；**已有档案支持编辑**。
- **提示词模板**：系统 / 用户模板支持文本与多图占位符（见下节）；每条用例的 `variables_json` 存元数据。**已有模板支持编辑**。
- **测试集**：在**共用「测试集根目录」**下为每个测试集创建**独立子目录**作为 `image_root`（仅支持该模式，不再支持第三方自定义路径）。该根目录可通过**环境变量**或**项目根目录配置文件**设置（见下「测试集根目录」）；未配置时为项目内 `data/test-suites`。用例含「主图相对路径」+ 元数据 JSON。**已有测试集与单条用例支持编辑**。可选在 `image_root` 下放 **`image-tester-metadata.json`** 或与主图同名的 **侧车 `.json`**，与库内元数据自动合并（见下文「本地元数据文件」）。
- **单图检测**：不跑批量任务，即时调用模型查看输出（`POST /api/vision/preview`），规则与批量一致。
- **目录扫描导入**：对 `image_root` 下（可选子目录）递归扫描常见图片后缀，勾选后一键生成用例（自动跳过已存在路径）。
- **一键清理不一致数据**：在「测试集与用例」页可执行“清理不一致数据”，自动删除“DB 有但图片不存在”的用例，以及“图片存在但 DB 无记录”的文件，并同步清理 `metadata.json` / `image-tester-metadata.json` 对应条目，避免脏数据回流。
- **导入资源（三卡片）**：「测试集与用例」页提供三个操作卡片：**A·整文件夹导入**（上传本地文件夹，自动从 `metadata.json` / 侧车 `.json` 读变量写 DB，一键完成上传→扫描→导入）；**B·单独上传图片**（只上传图片，变量为空，之后可扫描导入或用 C 覆盖）；**C·JSON 覆盖变量**（上传 `metadata.json` 格式文件，仅更新 DB 中已有用例的变量）。卡片 A/B 的目标子目录支持从服务器已有目录**下拉选择**或手动输入。上传后目录选择器会自动刷新。
- **批量运行**：并发调用模型（默认 SQLite + 进程内队列），SSE 推送进度事件；结果落库。**只会跑数据库里已存在的用例**；本地图片 + `image-tester-metadata.json` 不会自动生成用例，须先在「测试集与用例」里**扫描导入**或**手动添加**。
- **断言引擎**：`contains` / `regex` / `jsonPath`（含 equals、inList、regex、numericEquals）/ `customScript`（受限 `vm` 表达式，超时见环境变量）/ **`llmJudge`（另选提示词模板，由大模型做语义判定，如门头名称在格式不一致时是否等价）**。
- **报告**：按运行查看通过/失败/错误数量、断言正确率（排除请求错误）、**全量平均单条耗时**（基于库内该次运行已写入 `duration_ms` 的用例，与下方列表是否「仅看未通过」或分页无关）、失败用例左图右文展示模型输出与断言明细。

## 目录结构

- [`server/`](server/)：Fastify + SQLite API，`controller` / `service` / `repository` / `model` / `provider` / `assert` 分层。
- [`web/`](web/)：React + Vite 前端，开发时代理 `/api` 到后端（**从项目根目录 `.env` 读取 `PORT`**，与 `server` 默认 8787 对齐，避免改端口后代理仍指向旧端口）。
- [`.env.example`](.env.example)：环境变量示例（复制为项目根目录 `.env`）。
- 根目录 [`package.json`](package.json)：在**根目录**执行 `npm run dev` 会用 `concurrently` 同时拉起后端与前端（在 `web` 里执行同名命令只会起前端）。
- [`scripts/deploy-init.sh`](scripts/deploy-init.sh)：新机器一键安装依赖、构建、初始化 SQLite 表与数据目录（见下「新机器部署」）。

## 新机器部署（含初始化数据库）

在**项目根目录**执行：

```bash
npm run deploy:init
```

会做：`npm install`（`server` + `web`）、`npm run build`（两端）、`npm run init-db`（在 `server` 内：创建 SQLite 文件、执行与运行时相同的 `CREATE TABLE IF NOT EXISTS`、创建测试集父目录 `testSuiteParentDir`）。若尚无 `.env`，会从 [`.env.example`](.env.example) 复制一份。

**局域网内其它设备访问 API**：在 `.env` 中设置 `HOST=0.0.0.0`，并按示例配置 `CORS_ORIGINS`（浏览器从非本机打开前端时必须包含前端完整来源，如 `http://192.168.x.x:5173`）。前端开发服务器默认只绑本机时，其它电脑打不开页面，需在 `web` 目录使用 `npx vite --host 0.0.0.0`（或等价配置），具体说明见脚本结束时的提示。

**仅初始化数据库**（已构建过 `server`，不启动 HTTP）：

```bash
cd server && npm run init-db
```

未构建时可用开发依赖执行：

```bash
cd server && npm run init-db:dev
```

## 快速开始

1. 复制环境变量（在项目根目录）：

   ```bash
   cp .env.example .env
   ```

   按实际填写 `OPENAI_API_KEY`、`DASHSCOPE_API_KEY` 等；Provider 档案里填写对应的 `api_key_env` 名称。若修改后端端口，在 `.env` 中设置 **`PORT`**（前端开发代理会读同一变量）。

2. 安装依赖（**首次**在项目根执行一次即可）：

   ```bash
   npm install
   npm install --prefix server
   npm install --prefix web
   ```

3. **推荐：在项目根目录同时启动前后端**（必须与根目录 [`package.json`](package.json) 同级执行，**不要**在 `web` 或 `server` 里单独跑这条）：

   ```bash
   cd /path/to/image-tester   # 含 server、web 文件夹的这一层
   npm run dev
   ```

   终端里应**同时**出现带 `[server]` 与 `[web]` 前缀的日志。默认后端 `http://127.0.0.1:8787`，前端一般为 `http://127.0.0.1:5173`（若 5173 被占用，Vite 会改用 5174 等，以终端输出为准）。

   **若看起来「只有前端」**：多半是在 `web` 目录执行了 `npm run dev`（那只启动 Vite）；请回到根目录再执行上面的命令。若已在根目录仍无后端，请看 `[server]` 是否报错——例如 **`EADDRINUSE` 表示 8787 已被占用**（关掉占用进程或改 `.env` 里 `PORT` 后重启），或根目录未执行过 `npm install` / `npm install --prefix server` 导致依赖不全。

4. **或分两个终端**：

   ```bash
   cd server && npm run dev
   ```

   ```bash
   cd web && npm run dev
   ```

5. 浏览器打开前端地址，按 Tab 依次配置 Provider、提示词、测试集与用例，再在「批量运行」发起任务，在「报告与失败复盘」查看结果。

**仅预览打包结果**（`cd web && npm run build && npm run preview`）时，`vite preview` 也会按根目录 `.env` 的 `PORT` 代理 `/api`，仍需**另外启动** `server`。

## 提示词占位符与用例元数据（variables_json）

用例字段 **`variables_json`** 存 JSON，支持两种形态：

1. **新格式（推荐）**：显式分区  
   `variables`：字符串键值，供模板替换；`images`：别名 → **相对 `image_root` 的图片路径**（服务端读文件并转 base64 写入多模消息）。

   ```json
   {
     "variables": { "scene": "门店", "hint": "看价签是否清晰" },
     "images": { "ref": "标准样例/价签参考.png", "detail": "其它/局部.jpg" }
   }
   ```

2. **旧格式（兼容）**：扁平对象，全部视为 `variables`，无多图别名表；此时用户模板里**不要**写 `{{img:xxx}}`，系统会把你为该用例配置的 **主图相对路径**（`relative_image_path`）自动附在用户消息末尾（与之前行为一致）。

**模板语法**（系统提示词与用户提示词均适用）：

| 写法 | 含义 |
| --- | --- |
| `{{var:键}}` | 替换为 `variables.键` |
| `{{键}}` | 同上（遗留简写；勿与 `img:` 混淆） |
| `{{img:别名}}` | 在此处插入 `images.别名` 对应图片（多模 content 一段 `image_url`） |

**用户消息里必须至少有一张图**：要么模板中出现 `{{img:…}}` 且元数据里配有路径，要么模板中**不出现**任何 `{{img:}}`，此时自动使用用例的 **主图**（`relative_image_path`）。系统提示词里也可插入 `{{img:}}`（若模型 / 网关支持 system 多模段）。

**`main` 自动别名**：用例 `images` 里若**没有** `main` 这个键，后端会把它**自动指向该用例的主图** `relative_image_path`。因此**无需**在每个用例里手写 `"images": {"main": "xxx.jpg"}`，模板里直接写 `{{img:main}}` 就能工作；只有当你确实要显式换一张图时才在该用例里手动配 `main`。新建提示词模板的默认用户模板已经带了 `{{img:main}}`。

门店招牌 + `storeName` 断言的可复制示例见 [`examples/`](examples/)（用例 `variables_json` 与测试集默认断言各一份）。

### 数据流：DB 优先，JSON 仅在导入/覆盖时使用

> **重构后的核心原则**：`variables_json` 直接存入数据库，运行/预览时**只读数据库**；JSON 文件仅在**导入**或**手动覆盖**时写入数据库，之后磁盘 JSON 不再实时参与运行链路。

**导入方式（三个操作卡片）**：

| 卡片 | 用途 |
| --- | --- |
| **A · 整文件夹导入** | 上传整个本地文件夹（图片 + JSON），后端自动从 `metadata.json` / 侧车 `.json` 解析变量并写入 DB；同时扫描并批量创建用例 |
| **B · 单独上传图片** | 只上传图片，变量为空（`{}`）；之后可在扫描区导入，或用卡片 C 补充变量 |
| **C · JSON 覆盖变量** | 上传 `metadata.json` 格式文件（`{"图片路径": {variables, images}}`），只更新 DB 中**已存在用例**的 `variables_json`，不新增用例 |

**JSON 文件格式（metadata.json / image-tester-metadata.json）**：
```json
{
  "子目录/图片.jpg": {
    "variables": { "scene": "门店", "hint": "看价签" },
    "images": { "ref": "参考图.png" }
  }
}
```
- 键为相对 `image_root` 的图片路径（正斜杠，与用例 `relative_image_path` 逐字一致）
- **侧车 JSON**：与主图同名的 `.json`（如 `a/b/c.png` 旁放 `a/b/c.json`），内容为单个用例的 `{ variables, images }` 结构；导入时优先级高于根清单

**合并优先级**（批量导入时，后者覆盖前者）：根清单（`image-tester-metadata.json` 或 `metadata.json`）→ 侧车 `.json`；合并结果整体写入数据库。

**接口**（供高级使用）：`POST /api/test-suites/:suiteId/resolve-case-metadata`，请求体 `{ "relative_image_path": "…", "variables_json": "{}" }`，返回 `{ "metadata_json": "…" }`，可用于查看导入前的磁盘合并预览。

**图片不要当纯文本拼进 prompt**：模型收到的是「一条用户消息里多段 content」——文本段 + `type: image_url` 的图片段（后端读本地图转 `data:image/...;base64,...`）。把路径或 base64 写进字符串里，多数网关不会当图片识别；应使用 `{{img:别名}}` + 元数据 `images`，或留空 `{{img:}}` 走主图自动附图。

**单图检测页**：左侧选 Provider、可直接编辑 **系统 / 用户提示词**；**请求参数 JSON** 会带入当前 Provider 档案里的默认参数（与 Provider 设置页一致），可改且**仅影响本次预览**；也可清空该框以完全使用档案默认值。`POST /api/vision/preview` 若带 **`params_effective_json`**（非空），则整段解析为扩展请求参数；否则仍按档案默认与可选的 `params_override_json` 合并。右侧**必须先选测试集**，选图下拉合并 **已入库用例** 与 **`image_root` 下磁盘扫描**。主图路径须相对 `image_root`。

## 可视化编辑：输出 Schema / 测试集变量 / 断言 / 大图标注

这一部分面向**非研发**同学，把原先只能写 JSON 的三个东西做成了图形界面，JSON 原文仍随时可切换。

### 输出 Schema（绑在「提示词模板」上）

在「提示词模板」编辑页新增 **`output_schema_json`** 字段与 `SchemaBuilder` 可视化编辑器：

- 用字段列表定义你希望模型返回的 JSON 结构：字段名 / 类型（string, number, integer, boolean, array, object）/ 是否必填 / 描述 / 可选的 `enum`（枚举值列表）。
- 保存后，**运行批量任务** 与 **单图预览** 都会自动把这份 Schema 渲染成一段「请按下列 JSON 结构返回」的指令拼接到系统提示词里：
  - 系统提示词里出现 **`{{schema}}`** 占位符 → 替换为生成的说明；
  - 没有占位符 → 自动追加到系统提示词末尾。
- 为空 Schema 不会注入任何文本。
- 这些字段名（`$.storeName`、`$.ok` 等）会同步出现在断言编辑器里，可直接选，不必再手写 JSONPath。

### 测试集变量列表（绑在「测试集」上）

在「测试集」编辑页用 **`SuiteVarListBuilder`** 可视化编辑。字段含义只有两个：

- `name`：变量名（英文键，建议用驼峰），会作为用例变量的下拉候选和断言里「引用变量」的候选；
- `description`：说明文字（可选，仅给看的人参考），**不参与运行**。

JSON 形态：`{"variables":[{"name":"storeName","description":"门店名"}, ...]}`。

运行时变量合并链（从低优先级到高，**后者覆盖前者**）：

用例编辑 / 大图标注中的变量编辑器会用这里声明的变量名提供**下拉候选**与**「快速添加」一键按钮**；用户仍可手写新 key。

运行时变量的合并顺序（从低到高）：

1. 用例 `variables_json`（数据库里直接存的那份）
2. `image_root` 根清单 `image-tester-metadata.json` / `metadata.json`（如仍在用）
3. 子目录同名清单
4. 与主图同名的 **侧车 JSON**

> 注：测试集变量列表自身**不再贡献变量值**（只是声明）。历史老数据里若 `global_variables_json` 以 `{k:v}` 形式存了值，仍会作为最底层 fallback 读到；新的声明格式 `{variables:[...]}` 不写值。

### 可视化断言（测试集默认 / 用例级覆盖）

`AssertionBuilder` 把 `{ rules: [...] }` 渲染成可视化规则列表：

- **字段来源**：整段输出文本（`contains`/`regex`）、Schema 字段（自动生成 `$.xxx`）、手写 JSONPath。
- **操作符**：按字段类型自动过滤（例如 boolean 不出现「字段数值等于」）。
- **期望值来源**：`常量` / `引用变量`。「引用变量」= 在当前用例合并后的 `variables` 里按名取值；候选由测试集变量列表 + 当前用例已填变量 合并得到，可从下拉选也可手输。
- 老版 `equalsSuiteVar` 在读入时会被当作 `equalsCaseVar` 展示并保存；后端对老 `equalsSuiteVar` 字段仍做 fallback，保证历史规则不中断。
- `customScript` 和 `llmJudge` 是**高级规则**，在可视化列表里以只读 JSON 卡片展示，可删除；编辑请切到「JSON 原文」标签页。

测试集编辑页顶部可选「参考提示词模板」，选中后 `AssertionBuilder` 的字段下拉会用该模板的 Schema 字段（方便共享同一断言但不同提示词）。

### 大图标注模式

在「测试集与用例」页的用例列表里，每行新增 **「大图标注」** 按钮，打开的宽对话框里：

- 左侧大图（黑灰背景，便于看招牌 / 价签 / 文字细节）；
- 右侧两张卡片，分别是 `VariableBuilder`（该用例变量）与 `AssertionBuilder`（该用例断言覆盖）；
- 两个编辑器都内建「可视化 / JSON 原文」切换，顶栏有「格式化 JSON」按钮；
- 保存会 `PATCH /api/test-cases/:id`，覆盖该用例的 `variables_json` 与 `assertions_override_json`（清空断言列表则回落到测试集默认）。

适合「对着图反复调变量 / 断言」的场景。按 Esc 或点遮罩可关闭。

## 测试集根目录（共用托管目录）

托管模式新建测试集时，子目录会创建在「共用测试集根目录」下。优先级从高到低：

1. **`IMAGE_TESTER_SUITE_ROOT`**（环境变量）：相对**当前进程工作目录**，或绝对路径。
2. **配置文件**：项目根目录 [`image-tester.config.json`](image-tester.config.example.json)（可复制示例重命名并修改），字段 **`suiteParentDir`**（或 `suite_parent_dir`）。其中相对路径相对于**项目根目录**（与内置默认 `data/test-suites` 一致）。
3. **默认**：`<项目根>/data/test-suites`。

可通过环境变量 **`IMAGE_TESTER_CONFIG`** 指定其它 JSON 路径（绝对路径，或相对当前工作目录），仍使用同一字段名。

## 环境变量说明

| 变量 | 说明 |
| --- | --- |
| `OPENAI_API_KEY` / `DASHSCOPE_API_KEY` / `VOLCENGINE_ARK_API_KEY` | 与 Provider 档案中的 `api_key_env` 对应，由后端从环境读取。 |
| `IMAGE_TESTER_SUITE_ROOT` | 可选。覆盖配置文件与默认值，见上「测试集根目录」。 |
| `IMAGE_TESTER_CONFIG` | 可选。自定义 `image-tester.config.json` 的路径；未设置时读取项目根下该文件名。 |
| `PORT` | 后端端口，默认 `8787`。 |
| `HOST` | 监听地址，默认 `127.0.0.1`。需要局域网内其他机器访问时设为 `0.0.0.0`。 |
| `SQLITE_PATH` | SQLite 文件路径，默认 `server/data/app.db`（相对 `server` 工作目录时可调整）。 |
| `CORS_ORIGINS` | 逗号分隔的前端源，默认包含本机 Vite 地址。 |
| `CUSTOM_SCRIPT_TIMEOUT_MS` | 自定义断言表达式在 `vm` 中的超时，默认 `300`。 |
| `MAX_REGEX_PATTERN_LENGTH` | 正则类断言的最大 pattern 长度，默认 `500`。 |

## 断言 JSON 格式

顶层结构固定为 `{ "rules": [ ... ] }`，多条规则为 **AND**（全部满足才算通过）。

示例：

```json
{
  "rules": [
    { "type": "contains", "value": "猫", "caseInsensitive": true },
    { "type": "regex", "pattern": "^\\s*\\{", "flags": "" },
    {
      "type": "jsonPath",
      "path": "$.label",
      "equals": "cat"
    },
    {
      "type": "jsonPath",
      "path": "$.storeName",
      "equalsCaseVar": "storeName"
    },
    {
      "type": "jsonPath",
      "path": "$.storeName",
      "equalsSuiteVar": "defaultStoreName"
    },
    {
      "type": "customScript",
      "expression": "outputText.length > 10 && (!parsedJson || parsedJson.ok === true)"
    },
    {
      "type": "llmJudge",
      "judge_prompt_profile_id": 2,
      "judge_provider_profile_id": 1,
      "judge_model_override": null,
      "judge_params_override_json": null
    }
  ]
}
```

**customScript**：填写一个 **JavaScript 表达式**（不是语句块），可使用 `outputText`（模型文本）、`parsedJson`（若能解析为 JSON）、`caseVars`（对象）。在 Node `vm` 沙箱中运行，仅适合本机工具场景；仍建议控制谁可访问该服务。

**llmJudge**（仅**批量运行**执行；**单图预览**不会跑该规则）：在视觉模型输出后，再按你指定的**另一条提示词模板**调用**纯文本** Chat（无图片）。模板中可使用 `{{var:modelOutput}}` / `{{var:lastRecognition}}`（与本次视觉识别全文相同）以及 `{{var:键}}`（与主任务一致，来自**合并后的** variables 元数据，如 `storeName`）。可指定 `judge_prompt_profile_id` 必填；`judge_provider_profile_id` 可选（默认与当前运行同一 Provider）；`judge_model_override`、`judge_params_override_json` 可选。判定模型回复优先解析 JSON 的 `pass` 字段，否则解析首行 `PASS`/`FAIL` 等。示例提示词与断言片段见 [`examples/llm-judge-prompt-template.md`](examples/llm-judge-prompt-template.md)、[`examples/assertion-llm-judge-storefront.json`](examples/assertion-llm-judge-storefront.json)。

**jsonPath**：使用 [JSONPath Plus](https://github.com/JSONPath-Plus/JSONPath-Plus) 语法。

- **`equals`**：与固定字符串比较（`String(取值) === equals`）。
- **`equalsCaseVar`**：与当前用例 **合并后的 `variables`（用例 `variables_json` + 清单 + 侧车 JSON 合并结果）** 中同名键的值比较（均为字符串化后比较）。例如模型输出 `{"storeName":"东南王村…"}`，期望来自侧车或清单里的 `storeName`，可写 `"path": "$.storeName", "equalsCaseVar": "storeName"`。若同时写 `equalsCaseVar` 与 `equals`，**优先使用 `equalsCaseVar`**。
- **`equalsSuiteVar`**（已废弃语义，保留向后兼容）：历史上比较的是测试集 `global_variables_json` 里的值；新结构（`{variables:[...]}`）不再贡献值，此时引擎会 fallback 到当前用例合并后的 `variables[key]`，等价于 `equalsCaseVar`。优先级仍为 `equalsSuiteVar` > `equalsCaseVar` > `equals`。

**模型原始响应与断言用的文本**：接口完整 JSON（含 `choices`、`usage` 等）存在运行结果的 **`raw_response_json`**。参与断言、并写入 **`model_output`** 的字符串是 **`choices[0].message.content` 原文**（即助手最终回复；若为 JSON 字符串可直接被 `jsonPath` 解析）。带深度思考时，`reasoning_content` **不会**再拼进 `model_output`，避免前面一大段推理导致无法 `JSON.parse`；推理内容仍在原始响应的 `message` 里可查。

## 对接阿里云 / 火山等

只要厂商提供 **OpenAI 兼容的 Chat Completions + 视觉消息格式**，即可使用 `openai_compatible` 或对应展示类型，并把 **Base URL** 配成官方文档中的兼容端点，**图片由后端读本地文件转 Base64** 填入 `image_url`（与 OpenAI 一致）。

请在各云控制台创建密钥后，把密钥写入 `.env`，并在 Provider 档案中把 `api_key_env` 设为该变量名。

### 火山引擎方舟（豆包）与 OpenAI 参数

火山方舟在 **对话(Chat) API** 上提供与 OpenAI Chat Completions 兼容的接入方式，官方说明见：

- [对话(Chat) API](https://www.volcengine.com/docs/82379/1494384?lang=zh)
- [兼容 OpenAI SDK](https://www.volcengine.com/docs/82379/1330626?lang=zh)

**`response_format`**：与 OpenAI 一致时，可直接写在 Provider「默认参数 JSON」或运行页的「覆盖参数」里（例如 `json_object` / `json_schema` 等），会进入请求体顶层。

**`thinking`**（深度思考开关等）：属于方舟在兼容端点上扩展的顶层字段，与 OpenAI 官方字段名可能不同，但同样通过 **JSON 请求体** 传递。本仓库使用的 OpenAI Node SDK 对请求体使用 `JSON.stringify`，**未在 TypeScript 类型里声明的顶层字段仍会原样发送**（例如 `thinking`）。因此你只要在参数 JSON 里与文档一致地写即可（文档可能是字符串枚举或对象形式，以当前控制台/文档为准）。

若需把一批扩展字段与常规参数分开维护，可在参数 JSON 里使用 **`request_body_extra`** 对象：会与顶层参数做浅合并，**最后**仍强制使用本服务组装的 `model` 与 `messages`（避免误覆盖多模态消息）。

示例（视觉 + JSON 输出 + 思考开关，具体取值以官方文档为准）：

```json
{
  "temperature": 0.2,
  "response_format": { "type": "json_object" },
  "thinking": { "type": "disabled" },
  "request_body_extra": {}
}
```

**豆包 / 方舟常用模型名（含视觉，按产品线枚举，具体以控制台为准）**：

| 系列 | 示例模型 ID（可直接作默认模型名） |
| --- | --- |
| Seed 2.0 | `doubao-seed-2-0-pro-260215`、`doubao-seed-2-0-lite-260215`、`doubao-seed-2-0-mini-260215`、`doubao-seed-2-0-code-preview-260215` |
| Seed 1.8 | `doubao-seed-1-8-251228` |
| GLM | `glm-4-7-251222` |
| Seed 1.6 及更早 | `doubao-seed-1-6-vision-250815`（**显式多模态视觉**）、`doubao-seed-1-6-lite-251015`、`doubao-seed-1-6-250615`、`doubao-seed-1-6-251015`、`doubao-seed-1-6-flash-250828`、`doubao-seed-1-6-flash-250715`、`doubao-seed-1-6-flash-250615`、`doubao-seed-code-preview-251028` |

Base URL 一般为控制台给出的 **OpenAI 兼容** 地址（如 `.../api/v3` 形式，以你账号开通为准）。

## 故障排查

- **`Route POST:/api/vision/preview not found`**：本仓库的 `server` 已注册该路由。出现 404 说明 **请求没有打到本项目的后端进程**（例如 `8787` 被其它程序占用、只开了前端、或后端用了非默认 `PORT` 但前端代理仍指向 8787）。处理：**结束占用端口的进程**；在根目录 `.env` 里设好 **`PORT`** 后，用 `server` 目录 `npm run dev` 启动，并确认日志里有 `API 已启动` 与 `POST /api/vision/preview` 提示；前端请用根目录 `npm run dev` 或确保 `web` 能读到同一 `.env` 中的 `PORT`（Vite 已从项目根加载）。可用下面命令自检（**端口换成你的 `PORT`**；应返回 **400** 及校验错误 JSON，而不是 404）：
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:8787/api/vision/preview \
    -H "Content-Type: application/json" -d '{}'
  ```

- **删除用例无反应 / 列表仍在**：历史批量运行会在 `test_run_items` 里引用该 `case_id`。当前版本会在删除用例时**一并删除**这些运行明细行（否则在外键开启时无法删除用例），并同步清理该用例的**主图文件、同名侧车 `.json`、根/子目录清单 `metadata.json`（含 `image-tester-metadata.json`）中的对应条目**，避免后续扫描或 JSON 覆盖把已删图片“加回来”。删除成功后页面会刷新列表；若失败，顶部会显示接口返回的错误信息。**请重启后端**以加载最新 `server` 代码。已存在的 SQLite 库文件不会自动改表结构；新库建表时 `test_run_items.case_id` 带 `ON DELETE CASCADE`，逻辑删除仍由服务端显式先删子表保证兼容旧库。
- **删除测试集无反应**：该集下的 **`test_runs`（批量运行记录）** 会引用 `suite_id`，外键开启时不能直接删测试集。当前版本会按顺序删除：运行记录（连带运行明细）→ 用例 → 测试集，并同步删除该测试集 `image_root` 目录下的图片与 JSON 资产（含 `metadata.json` / `image-tester-metadata.json` / 侧车 `.json`）。**删除测试集会删掉该集下所有历史运行记录与目录文件**，请确认后再操作。失败时顶部会显示错误；删除成功后请**重启后端**或确保已部署最新 `server`。

## 已知限制与改进方向

- 自定义脚本断言使用 Node 内置 `vm`，非强隔离沙箱；请勿在公网暴露无鉴权的实例。
- 高并发写 SQLite 时如遇锁等待，可适当降低并发或后续替换为 PostgreSQL 等。
- 若某厂商非 OpenAI 兼容协议，需要在 `server/src/provider` 增加独立 Adapter（当前代码已集中走 OpenAI 兼容实现）。

## 反思与后续可做

- 快速开始已写明：`npm run dev` 须在**项目根目录**执行才会前后端一起起；在 `web` 下只会起 Vite，并补充 `[server]`/`[web]` 日志与端口占用等自检说明。
- 元数据已支持 **`image_root` 下 `image-tester-metadata.json` + 与主图同名的侧车 `.json`**：**磁盘键值覆盖库内**，侧车每次现读、清单按 `mtime+size` 失效缓存；测试集页编辑用例时提供 **生效元数据预览（约 3 秒刷新）** 与 `POST /api/test-suites/:suiteId/resolve-case-metadata` 接口。
- 单图检测已改为「左侧直编提示词 + 右侧主图与元数据」，降低上手成本；若仍觉得占位符难记，可再加「一键插入 `{{img:main}}`」等快捷按钮。
- 增加运行级「停止」后，将进行中请求与队列行为定义得更清晰（当前取消主要影响尚未开始的用例）。
- 导出 CSV / 两次运行 diff 回归。
- 真正的进程级隔离沙箱（如 `isolated-vm`）替换 `customScript` 实现。
- `llmJudge` 每条用例会多一次文本 Chat 调用，耗时与费用随规则增加；仅批量运行执行，单图预览不跑该规则。
