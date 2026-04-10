import type Database from 'better-sqlite3';
import { chatVision } from '../provider/index.js';
import * as providersRepo from '../repository/providersRepo.js';
import * as suitesRepo from '../repository/suitesRepo.js';
import { buildVisionRequestParts } from '../utils/multimodalPrompt.js';
import { resolveUnderRoot } from '../utils/pathSafe.js';

export interface VisionPreviewBody {
  suite_id: number;
  relative_image_path: string;
  metadata_json?: string;
  provider_profile_id: number;
  system_prompt?: string;
  user_prompt_template: string;
  model_override?: string | null;
  /** 有内容则解析为完整 extraParams，忽略档案默认与 params_override_json */
  params_effective_json?: string | null;
  params_override_json?: string | null;
}

function mergeParams(defaultJson: string, overrideJson: string | null): Record<string, unknown> {
  const a = JSON.parse(defaultJson || '{}') as Record<string, unknown>;
  const b = overrideJson ? (JSON.parse(overrideJson) as Record<string, unknown>) : {};
  return { ...a, ...b };
}

export async function runVisionPreview(db: Database.Database, body: VisionPreviewBody) {
  const suite = suitesRepo.getTestSuite(db, body.suite_id);
  if (!suite) {
    const err = new Error('测试集不存在');
    (err as Error & { statusCode?: number }).statusCode = 404;
    throw err;
  }
  const provider = providersRepo.getProviderProfile(db, body.provider_profile_id);
  if (!provider) {
    const err = new Error('Provider 档案不存在');
    (err as Error & { statusCode?: number }).statusCode = 404;
    throw err;
  }

  resolveUnderRoot(suite.image_root, body.relative_image_path);

  const metadataJson = body.metadata_json?.trim() || '{}';
  const systemTemplate = body.system_prompt ?? '';
  const userTemplate = body.user_prompt_template;

  const { system, user, variables } = await buildVisionRequestParts(
    systemTemplate,
    userTemplate,
    metadataJson,
    suite.image_root,
    body.relative_image_path,
  );

  const model = body.model_override?.trim() || provider.default_model;
  const eff = body.params_effective_json?.trim();
  let extraParams: Record<string, unknown>;
  if (eff) {
    try {
      extraParams = JSON.parse(eff) as Record<string, unknown>;
    } catch {
      const err = new Error('请求参数 JSON（params_effective_json）格式不正确');
      (err as Error & { statusCode?: number }).statusCode = 400;
      throw err;
    }
  } else {
    extraParams = mergeParams(provider.default_params_json, body.params_override_json ?? null);
  }

  const visionResult = await chatVision(provider, {
    model,
    system,
    user,
    extraParams,
  });

  return {
    text: visionResult.text,
    raw: visionResult.raw,
    variables_snapshot: variables,
  };
}
