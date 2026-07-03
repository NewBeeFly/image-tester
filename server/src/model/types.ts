export type ProviderType = 'openai_compatible' | 'dashscope' | 'volcengine';

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type RunItemStatus = 'pending' | 'running' | 'completed' | 'error';

export interface ProviderProfile {
  id: number;
  name: string;
  provider_type: ProviderType;
  base_url: string;
  api_key_env: string;
  default_model: string;
  default_params_json: string;
  created_at: string;
}

export interface PromptProfile {
  id: number;
  name: string;
  system_prompt: string;
  user_prompt_template: string;
  notes: string;
  /**
   * 期望模型返回的 JSON 字段清单（可视化 Schema）；运行时会被拼到 system_prompt
   * 末尾或 `{{schema}}` 占位符处，帮助模型稳定产出对应结构。
   */
  output_schema_json: string;
  created_at: string;
}

export interface TestSuite {
  id: number;
  name: string;
  image_root: string;
  default_assertions_json: string;
  /**
   * 测试集级全局文本变量（JSON，`{"key":"value"}`）。作为变量合并链最底层，
   * 可被用例变量 / 清单 / 侧车覆盖；断言的 `equalsSuiteVar` 从这里取期望值。
   */
  global_variables_json: string;
  /** 参考的提示词模板 ID，用于获取 output_schema 提供断言字段下拉候选 */
  ref_prompt_id: number | null;
  created_at: string;
}

export interface TestCase {
  id: number;
  suite_id: number;
  relative_image_path: string;
  variables_json: string;
  assertions_override_json: string | null;
  sort_order: number;
  created_at: string;
}

export interface TestRun {
  id: number;
  suite_id: number;
  provider_profile_id: number;
  prompt_profile_id: number;
  model_override: string | null;
  params_override_json: string | null;
  concurrency: number;
  status: RunStatus;
  total_count: number;
  pass_count: number;
  fail_count: number;
  error_count: number;
  current_index: number;
  started_at: string | null;
  finished_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface TestRunItem {
  id: number;
  run_id: number;
  case_id: number;
  status: RunItemStatus;
  model_output: string | null;
  raw_response_json: string | null;
  assertion_details_json: string | null;
  pass: number | null;
  duration_ms: number | null;
  error_message: string | null;
  created_at: string;
}

export type AssertionRule =
  | { type: 'contains'; value: string; caseInsensitive?: boolean; negate?: boolean }
  | { type: 'regex'; pattern: string; flags?: string }
  | {
      type: 'jsonPath';
      path: string;
      /** 与用例元数据 `variables` 里同名键的字符串值比较（优先级高于 `equals`） */
      equalsCaseVar?: string;
      /** 与测试集 `global_variables_json` 里同名键的字符串值比较；优先级介于 `equalsCaseVar` 之后、`equals` 之前 */
      equalsSuiteVar?: string;
      equals?: string;
      inList?: string[];
      regex?: string;
      numericEquals?: number;
      /** 路径取值为数组时：期望数组中每一项都在实际数组中出现（顺序无关，逐项 deep 比较） */
      arrayContainsAll?: unknown[];
      /** 同上，期望值来自合并后 variables 中同名键的 JSON 数组字符串 */
      arrayContainsAllCaseVar?: string;
      /** 路径取值与常量数组逐项、顺序完全一致（deep 比较） */
      arrayEqualsConst?: unknown[];
      /** 同上，期望值来自 variables 中同名键的 JSON 数组字符串 */
      arrayEqualsCaseVar?: string;
      /** 路径取值与常量数组逐项比较，忽略顺序 */
      arrayUnorderedEqualsConst?: unknown[];
      /** 同上，期望值来自 variables 中同名键的 JSON 数组字符串 */
      arrayUnorderedEqualsCaseVar?: string;
    }
  | { type: 'customScript'; expression: string }
  | {
      /** 调用纯文本大模型判定输出是否合规 */
      type: 'llmJudge';
      /** 判定用 Provider 档案 ID */
      provider_profile_id: number;
      /** 覆盖 Provider 默认模型；空/null 则使用 Provider 默认 */
      model?: string | null;
      /** 覆盖请求参数 JSON，如 {"temperature":0.1} */
      params_json?: string | null;
      /** 系统提示词；空/null 则使用默认判定员角色 */
      system_prompt?: string | null;
      /**
       * 返回值 Schema JSON（符合 `OutputSchema`），会拼接到系统提示词；
       * 空/null 则使用默认 pass/reason 结构。
       */
      output_schema_json?: string | null;
      /** 用户提示词模板，支持 {{var:xxx}} */
      user_prompt_template: string;
    };

export interface AssertionConfig {
  rules: AssertionRule[];
}

/** 可视化「返回值结构」定义（提示词模板上，用于断言字段选择与自动拼接到系统提示）。 */
export type OutputFieldType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'enum';

export interface OutputFieldSchema {
  /** 字段名（会作为模型返回 JSON 的 key） */
  name: string;
  type: OutputFieldType;
  /** 是否必填（仅作为对模型的提示，不做强校验） */
  required?: boolean;
  description?: string;
  /** type=enum 时的枚举候选值 */
  enum?: string[];
}

export interface OutputSchema {
  fields: OutputFieldSchema[];
  /**
   * 自定义提示：在自动拼接的「返回 JSON 结构要求」段落之前/之后追加一段中文，
   * 例如「只输出 JSON，不要任何解释文字」。留空时走内置默认文案。
   */
  instruction?: string;
}

/** OpenAI 兼容多模态 content 元素 */
export type VisionContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface VisionChatInput {
  model: string;
  /** system 可为纯文本或含图的多模段 */
  system: string | VisionContentPart[];
  /** user 多模段（文本与 image_url 交错） */
  user: VisionContentPart[];
  extraParams: Record<string, unknown>;
}

export interface VisionChatResult {
  text: string;
  raw: unknown;
}
