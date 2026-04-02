import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { parseAssertionConfig } from '../assert/engine.js';
import {
  bulkImportCasesSchema,
  resolveCaseMetadataSchema,
  createPromptProfileSchema,
  createProviderProfileSchema,
  createTestCaseSchema,
  createTestRunSchema,
  createTestSuiteSchema,
  updatePromptProfileSchema,
  updateProviderProfileSchema,
  updateTestCaseSchema,
  updateTestSuiteSchema,
  visionPreviewSchema,
} from '../model/schemas.js';
import * as promptsRepo from '../repository/promptsRepo.js';
import * as providersRepo from '../repository/providersRepo.js';
import * as runsRepo from '../repository/runsRepo.js';
import * as suitesRepo from '../repository/suitesRepo.js';
import { scanImagesUnderSuiteRoot } from '../service/scanService.js';
import { runVisionPreview } from '../service/visionPreviewService.js';
import { cancelRun, startTestRun, subscribeRun } from '../service/testRunService.js';
import { mimeFromPath } from '../utils/mime.js';
import {
  invalidateCaseMetadataManifestCache,
  resolveMergedMetadataJson,
} from '../utils/caseMetadataMerge.js';
import { resolveUnderRoot } from '../utils/pathSafe.js';
import { parseOrThrow } from '../utils/zodParse.js';

function resolveImageRootInput(raw: string): string {
  return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(process.cwd(), raw);
}

export function registerRoutes(app: FastifyInstance, db: Database.Database) {
  app.setErrorHandler((err, _req, reply) => {
    const e = err as Error & { statusCode?: number };
    const status = e.statusCode ?? 500;
    reply.status(status).send({ error: e.message || '服务器错误' });
  });

  app.get('/health', async () => ({ ok: true }));

  app.post('/api/vision/preview', async (req) => {
    const body = parseOrThrow(visionPreviewSchema, req.body);
    return runVisionPreview(db, body);
  });

  app.get('/api/provider-profiles', async () => providersRepo.listProviderProfiles(db));

  app.post('/api/provider-profiles', async (req) => {
    const body = parseOrThrow(createProviderProfileSchema, req.body);
    return providersRepo.insertProviderProfile(db, {
      name: body.name,
      provider_type: body.provider_type,
      base_url: body.base_url,
      api_key_env: body.api_key_env,
      default_model: body.default_model,
      default_params_json: body.default_params_json,
    });
  });

  app.patch('/api/provider-profiles/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const body = parseOrThrow(updateProviderProfileSchema, req.body);
    const updated = providersRepo.updateProviderProfile(db, id, body);
    if (!updated) {
      const err = new Error('Provider 不存在');
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }
    return updated;
  });

  app.delete('/api/provider-profiles/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const ok = providersRepo.deleteProviderProfile(db, id);
    return { ok };
  });

  app.get('/api/prompt-profiles', async () => promptsRepo.listPromptProfiles(db));

  app.post('/api/prompt-profiles', async (req) => {
    const body = parseOrThrow(createPromptProfileSchema, req.body);
    return promptsRepo.insertPromptProfile(db, body);
  });

  app.patch('/api/prompt-profiles/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const body = parseOrThrow(updatePromptProfileSchema, req.body);
    const updated = promptsRepo.updatePromptProfile(db, id, body);
    if (!updated) {
      const err = new Error('提示词配置不存在');
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }
    return updated;
  });

  app.delete('/api/prompt-profiles/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const ok = promptsRepo.deletePromptProfile(db, id);
    return { ok };
  });

  app.get('/api/test-suites', async () => suitesRepo.listTestSuites(db));

  app.post('/api/test-suites', async (req) => {
    const body = parseOrThrow(createTestSuiteSchema, req.body);
    if (body.default_assertions_json) {
      parseAssertionConfig(body.default_assertions_json);
    }
    const row = suitesRepo.insertTestSuite(db, {
      ...body,
      image_root: resolveImageRootInput(body.image_root),
    });
    invalidateCaseMetadataManifestCache();
    return row;
  });

  app.patch('/api/test-suites/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const body = parseOrThrow(updateTestSuiteSchema, req.body);
    if (body.default_assertions_json) {
      parseAssertionConfig(body.default_assertions_json);
    }
    const patch = {
      ...body,
      ...(body.image_root ? { image_root: resolveImageRootInput(body.image_root) } : {}),
    };
    const updated = suitesRepo.updateTestSuite(db, id, patch);
    if (!updated) {
      const err = new Error('测试集不存在');
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }
    invalidateCaseMetadataManifestCache();
    return updated;
  });

  app.delete('/api/test-suites/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const ok = suitesRepo.deleteTestSuite(db, id);
    if (!ok) {
      const err = new Error('测试集不存在或已删除');
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }
    invalidateCaseMetadataManifestCache();
    return { ok: true };
  });

  app.get('/api/test-suites/:suiteId/cases', async (req) => {
    const suiteId = Number((req.params as { suiteId: string }).suiteId);
    return suitesRepo.listTestCases(db, suiteId);
  });

  /** 返回当前合并规则下的生效元数据 JSON（磁盘覆盖库内）；用于编辑侧车时热刷新预览 */
  app.post('/api/test-suites/:suiteId/resolve-case-metadata', async (req) => {
    const suiteId = Number((req.params as { suiteId: string }).suiteId);
    const body = parseOrThrow(resolveCaseMetadataSchema, req.body);
    const suite = suitesRepo.getTestSuite(db, suiteId);
    if (!suite) {
      const err = new Error('测试集不存在');
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }
    resolveUnderRoot(suite.image_root, body.relative_image_path);
    const metadata_json = resolveMergedMetadataJson(
      suite.image_root,
      body.relative_image_path,
      body.variables_json?.trim() || '{}',
    );
    return { metadata_json };
  });

  app.post('/api/test-suites/:suiteId/cases', async (req) => {
    const suiteId = Number((req.params as { suiteId: string }).suiteId);
    const body = parseOrThrow(createTestCaseSchema, req.body);
    const suite = suitesRepo.getTestSuite(db, suiteId);
    if (!suite) {
      const err = new Error('测试集不存在');
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }
    resolveUnderRoot(suite.image_root, body.relative_image_path);
    if (body.assertions_override_json) {
      parseAssertionConfig(body.assertions_override_json);
    }
    return suitesRepo.insertTestCase(db, suiteId, body);
  });

  app.patch('/api/test-cases/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const body = parseOrThrow(updateTestCaseSchema, req.body);
    const cur = suitesRepo.getTestCase(db, id);
    if (!cur) {
      const err = new Error('用例不存在');
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }
    const suite = suitesRepo.getTestSuite(db, cur.suite_id)!;
    const nextPath = body.relative_image_path ?? cur.relative_image_path;
    resolveUnderRoot(suite.image_root, nextPath);
    if (body.assertions_override_json) {
      parseAssertionConfig(body.assertions_override_json);
    }
    return suitesRepo.updateTestCase(db, id, body);
  });

  app.delete('/api/test-cases/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const ok = suitesRepo.deleteTestCase(db, id);
    if (!ok) {
      const err = new Error('用例不存在或已删除');
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }
    return { ok: true };
  });

  app.get('/api/test-suites/:suiteId/scan-images', async (req) => {
    const suiteId = Number((req.params as { suiteId: string }).suiteId);
    const q = req.query as { relative_dir?: string };
    const suite = suitesRepo.getTestSuite(db, suiteId);
    if (!suite) {
      const err = new Error('测试集不存在');
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }
    const relativeDir = q.relative_dir ?? '';
    if (relativeDir) {
      resolveUnderRoot(suite.image_root, relativeDir);
    }
    try {
      const paths = await scanImagesUnderSuiteRoot(suite.image_root, relativeDir);
      return { paths };
    } catch {
      const err = new Error('扫描目录失败，请确认子目录存在且可读');
      (err as Error & { statusCode?: number }).statusCode = 400;
      throw err;
    }
  });

  app.post('/api/test-suites/:suiteId/cases/bulk-import', async (req) => {
    const suiteId = Number((req.params as { suiteId: string }).suiteId);
    const body = parseOrThrow(bulkImportCasesSchema, req.body);
    const suite = suitesRepo.getTestSuite(db, suiteId);
    if (!suite) {
      const err = new Error('测试集不存在');
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }
    for (const p of body.relative_paths) {
      resolveUnderRoot(suite.image_root, p);
    }
    const existing = new Set(suitesRepo.listTestCases(db, suiteId).map((c) => c.relative_image_path));
    const toAdd = body.relative_paths.filter((p) => !existing.has(p));
    let order = suitesRepo.listTestCases(db, suiteId).length;
    suitesRepo.bulkInsertTestCases(
      db,
      suiteId,
      toAdd.map((p) => ({ relative_image_path: p, sort_order: order++ })),
    );
    return { inserted: toAdd.length, skipped: body.relative_paths.length - toAdd.length };
  });

  app.get('/api/test-suites/:suiteId/image', async (req, reply) => {
    const suiteId = Number((req.params as { suiteId: string }).suiteId);
    const q = req.query as { relative_path?: string };
    if (!q.relative_path) {
      return reply.status(400).send({ error: '缺少 relative_path' });
    }
    const suite = suitesRepo.getTestSuite(db, suiteId);
    if (!suite) {
      return reply.status(404).send({ error: '测试集不存在' });
    }
    const abs = resolveUnderRoot(suite.image_root, q.relative_path);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return reply.status(404).send({ error: '图片不存在' });
    }
    const stream = fs.createReadStream(abs);
    reply.header('Content-Type', mimeFromPath(abs));
    return reply.send(stream);
  });

  app.post('/api/test-runs', async (req) => {
    const body = parseOrThrow(createTestRunSchema, req.body);
    const cases = suitesRepo.listTestCases(db, body.suite_id);
    if (!cases.length) {
      const err = new Error(
        '测试集中没有用例：请先到「测试集与用例」里扫描图片并「导入选中」，或手动添加用例。仅把图片和清单 JSON（image-tester-metadata.json / metadata.json）放在磁盘上不会自动写入用例表，与是否重启服务无关。',
      );
      (err as Error & { statusCode?: number }).statusCode = 400;
      throw err;
    }
    const run = runsRepo.insertTestRun(db, {
      suite_id: body.suite_id,
      provider_profile_id: body.provider_profile_id,
      prompt_profile_id: body.prompt_profile_id,
      model_override: body.model_override ?? null,
      params_override_json: body.params_override_json ?? null,
      concurrency: body.concurrency ?? 2,
      total_count: cases.length,
    });
    runsRepo.insertRunItems(
      db,
      run.id,
      cases.map((c) => c.id),
    );
    startTestRun(db, run.id);
    return runsRepo.getTestRun(db, run.id);
  });

  app.get('/api/test-runs', async () => runsRepo.listTestRuns(db, 100));

  app.get('/api/test-runs/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const run = runsRepo.getTestRun(db, id);
    if (!run) {
      const err = new Error('运行记录不存在');
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }
    return run;
  });

  app.post('/api/test-runs/:id/cancel', async (req) => {
    const id = Number((req.params as { id: string }).id);
    cancelRun(id);
    return { ok: true };
  });

  app.get('/api/test-runs/:id/items', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const q = req.query as { pass?: string; limit?: string };
    let pass: boolean | undefined;
    if (q.pass === 'true') pass = true;
    else if (q.pass === 'false') pass = false;
    const limit = q.limit ? Number(q.limit) : undefined;
    return runsRepo.listRunItems(db, id, { pass, limit });
  });

  app.get('/api/test-runs/:id/items-detail', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const q = req.query as { pass?: string; limit?: string };
    let pass: boolean | undefined;
    if (q.pass === 'true') pass = true;
    else if (q.pass === 'false') pass = false;
    const limit = q.limit ? Number(q.limit) : undefined;
    return runsRepo.listRunItemsWithCases(db, id, { pass, limit });
  });

  app.get('/api/test-runs/:id/events', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    const send = (payload: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    send({ type: 'connected', runId: id });
    const unsubscribe = subscribeRun(id, send);
    const onClose = () => {
      unsubscribe();
    };
    req.raw.on('close', onClose);
  });
}
