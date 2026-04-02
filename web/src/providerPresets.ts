import type { ProviderType } from './api'

/** 新建 Provider 表单：按厂商给出的推荐默认值（可在输入框中再改） */
export const PROVIDER_FORM_PRESETS: Record<
  ProviderType,
  {
    suggestedName: string
    base_url: string
    api_key_env: string
    default_model: string
    default_params_json: string
    baseUrlHint?: string
  }
> = {
  openai_compatible: {
    suggestedName: 'OpenAI 官方',
    base_url: 'https://api.openai.com/v1',
    api_key_env: 'OPENAI_API_KEY',
    default_model: 'gpt-4o-mini',
    default_params_json: '{\n  "temperature": 0.2\n}',
  },
  dashscope: {
    suggestedName: '阿里云 DashScope',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    api_key_env: 'DASHSCOPE_API_KEY',
    default_model: 'qwen-vl-plus',
    default_params_json: '{\n  "temperature": 0.2\n}',
  },
  volcengine: {
    suggestedName: '火山引擎方舟',
    base_url: 'https://ark.cn-beijing.volces.com/api/v3',
    api_key_env: 'VOLCENGINE_ARK_API_KEY',
    default_model: 'doubao-seed-1-6-vision-250815',
    default_params_json: '{\n  "temperature": 0.2\n}',
    baseUrlHint:
      '地域以控制台为准：若接入点不在北京，请将 URL 中的 cn-beijing 换成控制台所示地域。',
  },
}
