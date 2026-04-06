import { z } from 'zod';

export const providerTypeSchema = z.enum(['openai_compatible', 'dashscope', 'volcengine']);

export const createProviderProfileSchema = z.object({
  name: z.string().min(1),
  provider_type: providerTypeSchema,
  base_url: z.string().url(),
  api_key_env: z.string().min(1),
  default_model: z.string().min(1),
  default_params_json: z.string().optional(),
});

export const updateProviderProfileSchema = createProviderProfileSchema.partial();

export const createPromptProfileSchema = z.object({
  name: z.string().min(1),
  system_prompt: z.string().optional(),
  user_prompt_template: z.string().min(1),
  notes: z.string().optional(),
});

export const updatePromptProfileSchema = createPromptProfileSchema.partial();

export const createTestSuiteSchema = z
  .object({
    name: z.string().min(1),
    /** 自定义图片根（绝对或相对启动目录） */
    image_root: z.string().min(1).optional(),
    /** 托管在「测试集根目录」下的子文件夹名，与 image_root 二选一 */
    managed_subdir: z.string().min(1).optional(),
    default_assertions_json: z.string().optional(),
  })
  .refine(
    (d) => Boolean(d.image_root?.trim()) || Boolean(d.managed_subdir?.trim()),
    { message: '请填写「子目录名」或「自定义 image_root」其一' },
  );

export const updateTestSuiteSchema = z.object({
  name: z.string().min(1).optional(),
  image_root: z.string().min(1).optional(),
  default_assertions_json: z.string().optional(),
});

export const createTestCaseSchema = z.object({
  relative_image_path: z.string().min(1),
  variables_json: z.string().optional(),
  assertions_override_json: z.string().nullable().optional(),
  sort_order: z.number().int().optional(),
});

export const updateTestCaseSchema = createTestCaseSchema.partial();

export const createTestRunSchema = z.object({
  suite_id: z.number().int().positive(),
  provider_profile_id: z.number().int().positive(),
  prompt_profile_id: z.number().int().positive(),
  model_override: z.string().nullable().optional(),
  params_override_json: z.string().nullable().optional(),
  concurrency: z.number().int().min(1).max(32).optional(),
});

export const bulkImportCasesSchema = z.object({
  relative_paths: z.array(z.string().min(1)).min(1),
});

/** 解析合并后的用例元数据（库内 + 清单 + 侧车），供页面热刷新展示 */
export const resolveCaseMetadataSchema = z.object({
  relative_image_path: z.string().min(1),
  variables_json: z.string().optional(),
});

export const visionPreviewSchema = z.object({
  suite_id: z.number().int().positive(),
  relative_image_path: z.string().min(1),
  metadata_json: z.string().optional(),
  provider_profile_id: z.number().int().positive(),
  /** 单图页直接提交，可不经过「提示词模板」表 */
  system_prompt: z.string().optional(),
  user_prompt_template: z.string().min(1),
  model_override: z.string().nullable().optional(),
  /** 非空时作为本次预览的完整 extraParams，不再与档案默认合并 */
  params_effective_json: z.string().nullable().optional(),
  params_override_json: z.string().nullable().optional(),
});
