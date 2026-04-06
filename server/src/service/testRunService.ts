import EventEmitter from 'node:events';
import type Database from 'better-sqlite3';
import pLimit from 'p-limit';
import { evaluateAssertionConfigAsync, parseAssertionConfig } from '../assert/engine.js';
import { chatVision } from '../provider/index.js';
import * as promptsRepo from '../repository/promptsRepo.js';
import * as providersRepo from '../repository/providersRepo.js';
import * as runsRepo from '../repository/runsRepo.js';
import * as suitesRepo from '../repository/suitesRepo.js';
import type { AssertionConfig, TestRunItem } from '../model/types.js';
import { buildVisionRequestParts } from '../utils/multimodalPrompt.js';
import { resolveMergedMetadataJson } from '../utils/caseMetadataMerge.js';

export const runEventBus = new EventEmitter();
runEventBus.setMaxListeners(200);

const cancelledRuns = new Set<number>();
const activeRuns = new Set<number>();

export function cancelRun(runId: number) {
  cancelledRuns.add(runId);
}

export function subscribeRun(runId: number, handler: (payload: unknown) => void): () => void {
  const channel = `run:${runId}`;
  runEventBus.on(channel, handler);
  return () => runEventBus.off(channel, handler);
}

function emit(runId: number, payload: unknown) {
  runEventBus.emit(`run:${runId}`, payload);
}

function mergeParams(defaultJson: string, overrideJson: string | null): Record<string, unknown> {
  const a = JSON.parse(defaultJson || '{}') as Record<string, unknown>;
  const b = overrideJson ? (JSON.parse(overrideJson) as Record<string, unknown>) : {};
  return { ...a, ...b };
}

function mergeAssertionConfig(suiteDefault: string, caseOverride: string | null): AssertionConfig {
  if (caseOverride && caseOverride.trim().length > 0) {
    return parseAssertionConfig(caseOverride);
  }
  return parseAssertionConfig(suiteDefault);
}

export function startTestRun(db: Database.Database, runId: number): void {
  if (activeRuns.has(runId)) return;
  activeRuns.add(runId);
  void executeTestRun(db, runId)
    .catch((e) => {
      const msg = (e as Error).message;
      runsRepo.updateRunStatus(db, runId, {
        status: 'failed',
        finished_at: new Date().toISOString(),
        last_error: msg,
      });
      emit(runId, { type: 'error', message: msg });
    })
    .finally(() => {
      activeRuns.delete(runId);
      cancelledRuns.delete(runId);
    });
}

async function executeTestRun(db: Database.Database, runId: number) {
  const run = runsRepo.getTestRun(db, runId);
  if (!run) throw new Error('运行记录不存在');

  const suite = suitesRepo.getTestSuite(db, run.suite_id);
  if (!suite) throw new Error('测试集不存在');

  const provider = providersRepo.getProviderProfile(db, run.provider_profile_id);
  if (!provider) throw new Error('Provider 档案不存在');

  const prompt = promptsRepo.getPromptProfile(db, run.prompt_profile_id);
  if (!prompt) throw new Error('提示词配置不存在');

  runsRepo.updateRunStatus(db, runId, {
    status: 'running',
    started_at: new Date().toISOString(),
    last_error: null,
  });
  emit(runId, { type: 'status', status: 'running' });

  const items = runsRepo.listRunItemsAll(db, runId);
  const limit = pLimit(Math.max(1, run.concurrency));

  await Promise.all(
    items.map((item) =>
      limit(async () => {
        if (cancelledRuns.has(runId)) {
          runsRepo.updateRunItem(db, item.id, {
            status: 'error',
            pass: 0,
            duration_ms: 0,
            error_message: '已取消',
          });
          runsRepo.bumpRunProgress(db, runId, { error: 1 });
          emit(runId, { type: 'item_done', itemId: item.id, total: items.length });
          return;
        }
        await processRunItem(db, runId, item, suite.image_root, provider, prompt, run, () => {
          emit(runId, {
            type: 'item_done',
            itemId: item.id,
            total: items.length,
          });
        });
      }),
    ),
  );

  if (cancelledRuns.has(runId)) {
    runsRepo.updateRunStatus(db, runId, {
      status: 'cancelled',
      finished_at: new Date().toISOString(),
    });
    emit(runId, { type: 'status', status: 'cancelled' });
    return;
  }

  runsRepo.updateRunStatus(db, runId, {
    status: 'completed',
    finished_at: new Date().toISOString(),
  });
  emit(runId, { type: 'status', status: 'completed' });
}

async function processRunItem(
  db: Database.Database,
  runId: number,
  item: TestRunItem,
  imageRoot: string,
  provider: import('../model/types.js').ProviderProfile,
  prompt: import('../model/types.js').PromptProfile,
  run: import('../model/types.js').TestRun,
  onDone: () => void,
) {
  const started = Date.now();
  const testCase = suitesRepo.getTestCase(db, item.case_id);
  if (!testCase) {
    runsRepo.updateRunItem(db, item.id, {
      status: 'error',
      pass: 0,
      duration_ms: Date.now() - started,
      error_message: '用例不存在',
    });
    runsRepo.bumpRunProgress(db, runId, { error: 1 });
    onDone();
    return;
  }

  runsRepo.updateRunItem(db, item.id, { status: 'running' });

  try {
    const metadataJson = resolveMergedMetadataJson(
      imageRoot,
      testCase.relative_image_path,
      testCase.variables_json,
    );
    const { system: systemContent, user: userParts, variables } = await buildVisionRequestParts(
      prompt.system_prompt,
      prompt.user_prompt_template,
      metadataJson,
      imageRoot,
      testCase.relative_image_path,
    );

    const model = run.model_override?.trim() || provider.default_model;
    const extraParams = mergeParams(provider.default_params_json, run.params_override_json);

    const visionResult = await chatVision(provider, {
      model,
      system: systemContent,
      user: userParts,
      extraParams,
    });

    const suite = suitesRepo.getTestSuite(db, testCase.suite_id)!;
    const assertionCfg = mergeAssertionConfig(suite.default_assertions_json, testCase.assertions_override_json);
    const evalResult = await evaluateAssertionConfigAsync(visionResult.text, assertionCfg.rules, variables, {
      db,
      runProvider: provider,
      run,
    });

    runsRepo.updateRunItem(db, item.id, {
      status: 'completed',
      model_output: visionResult.text,
      raw_response_json: JSON.stringify(visionResult.raw),
      assertion_details_json: JSON.stringify(evalResult.results),
      pass: evalResult.pass ? 1 : 0,
      duration_ms: Date.now() - started,
      error_message: null,
    });

    runsRepo.bumpRunProgress(db, runId, {
      pass: evalResult.pass ? 1 : 0,
      fail: evalResult.pass ? 0 : 1,
    });
  } catch (e) {
    const msg = (e as Error).message;
    runsRepo.updateRunItem(db, item.id, {
      status: 'error',
      model_output: null,
      raw_response_json: null,
      assertion_details_json: null,
      pass: 0,
      duration_ms: Date.now() - started,
      error_message: msg,
    });
    runsRepo.bumpRunProgress(db, runId, { error: 1 });
  } finally {
    onDone();
  }
}
