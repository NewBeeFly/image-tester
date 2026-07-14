/**
 * API 包装工具集：将后端 API 封装为 LangGraph tool，供 Agent 调用。
 * 工具通过闭包访问 db 实例，在运行时注入。
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import * as runsRepo from '../../repository/runsRepo.js';
import * as promptsRepo from '../../repository/promptsRepo.js';
import * as providersRepo from '../../repository/providersRepo.js';
import * as suitesRepo from '../../repository/suitesRepo.js';

import type { Summarizer } from '../summarizer.js';

/** 创建所有 API 包装工具（需要 db 实例） */
export function createApiTools(db: Database.Database, summarizer?: Summarizer) {
  // ---- 获取测试运行报告 ----
  const getTestRunReportTool = tool(
    async ({ run_id }) => {
      const run = runsRepo.getTestRun(db, run_id);
      if (!run) return JSON.stringify({ error: `运行记录 #${run_id} 不存在` });

      const suite = suitesRepo.getTestSuite(db, run.suite_id);
      const prompt = promptsRepo.getPromptProfile(db, run.prompt_profile_id);
      const provider = providersRepo.getProviderProfile(db, run.provider_profile_id);
      const durationStats = runsRepo.getRunDurationStats(db, run_id);

      const passRate =
        run.total_count > 0
          ? `${((run.pass_count / run.total_count) * 100).toFixed(1)}%`
          : 'N/A';

      return JSON.stringify(
        {
          run: {
            id: run.id,
            status: run.status,
            pass: run.pass_count,
            fail: run.fail_count,
            error: run.error_count,
            total: run.total_count,
            started_at: run.started_at,
            finished_at: run.finished_at,
          },
          prompt_profile: prompt
            ? {
                id: prompt.id,
                name: prompt.name,
                system_prompt: prompt.system_prompt,
                user_prompt_template: prompt.user_prompt_template,
                output_schema_json: prompt.output_schema_json,
              }
            : null,
          provider: provider
            ? { name: provider.name, model: run.model_override || provider.default_model }
            : null,
          suite: suite ? { id: suite.id, name: suite.name } : null,
          pass_rate: passRate,
          avg_duration_ms: durationStats.avg_ms,
        },
        null,
        2,
      );
    },
    {
      name: 'get_test_run_report',
      description:
        '获取指定运行记录的完整报告，包含：统计概览（通过/失败/错误数、通过率）、使用的提示词模板全文、Provider 信息、测试集名称。这是分析报告的第一步。',
      schema: z.object({
        run_id: z.number().int().describe('运行记录 ID'),
      }),
    },
  );

  // ---- 获取运行中的用例结果 ----
  const getRunItemsTool = tool(
    async ({ run_id, pass, limit }) => {
      const items = runsRepo.listRunItemsWithCases(db, run_id, {
        pass: pass ?? undefined,
        limit: limit ?? 20,
      });

      const result = items.map((item) => {
        let assertionFailures: unknown[] = [];
        if (item.assertion_details_json) {
          try {
            const details = JSON.parse(item.assertion_details_json);
            if (Array.isArray(details)) {
              assertionFailures = details.filter((d: { pass?: boolean }) => !d.pass);
            }
          } catch {
            /* ignore */
          }
        }

        const suite = suitesRepo.getTestSuite(db, item.suite_id);
        return {
          case_id: item.case_id,
          status: item.status,
          pass: item.pass,
          image_path: item.relative_image_path,
          image_url: suite
            ? `/api/test-suites/${suite.id}/image?relative_path=${encodeURIComponent(item.relative_image_path)}`
            : null,
          image_absolute_path: suite
            ? `${suite.image_root}/${item.relative_image_path}`
            : null,
          model_output: item.model_output?.slice(0, 2000), // 截断避免过长
          assertion_failures: assertionFailures,
          variables_json: item.variables_json,
          duration_ms: item.duration_ms,
          error_message: item.error_message,
        };
      });

      return JSON.stringify(result, null, 2);
    },
    {
      name: 'get_run_items',
      description:
        '获取运行中的用例结果列表。支持按 pass（true=仅通过/false=仅失败）筛选，支持 limit 控制数量（默认 20）。返回每条用例的：图片路径、模型输出（截断）、断言失败详情、变量。',
      schema: z.object({
        run_id: z.number().int().describe('运行记录 ID'),
        pass: z.boolean().optional().describe('筛选：true=仅通过，false=仅失败，不传=全部'),
        limit: z.number().int().optional().describe('返回数量上限（默认 20）'),
      }),
    },
  );

  // ---- 获取单条用例详情 ----
  const getRunItemDetailTool = tool(
    async ({ run_id, case_id }) => {
      const item = runsRepo.getRunItemByRunAndCase(db, run_id, case_id);
      if (!item) return JSON.stringify({ error: `运行 #${run_id} 中未找到用例 #${case_id}` });

      const testCase = suitesRepo.getTestCase(db, case_id);
      const suite = testCase ? suitesRepo.getTestSuite(db, testCase.suite_id) : null;

      return JSON.stringify(
        {
          case_id,
          image_path: testCase?.relative_image_path ?? null,
          image_absolute_path: suite && testCase
            ? `${suite.image_root}/${testCase.relative_image_path}`
            : null,
          model_output: item.model_output,
          raw_response_json: item.raw_response_json,
          assertion_details_json: item.assertion_details_json,
          pass: item.pass,
          variables_json: testCase?.variables_json,
          assertions_override_json: testCase?.assertions_override_json,
        },
        null,
        2,
      );
    },
    {
      name: 'get_run_item_detail',
      description: '获取指定运行中某条用例的完整详情（含原始响应 JSON、完整断言详情、用例变量和断言覆盖配置）。',
      schema: z.object({
        run_id: z.number().int().describe('运行记录 ID'),
        case_id: z.number().int().describe('用例 ID'),
      }),
    },
  );

  // ---- 对比多次运行 ----
  const compareRunsTool = tool(
    async ({ run_ids }) => {
      const results = run_ids.map((id) => {
        const run = runsRepo.getTestRun(db, id);
        if (!run) return { id, error: '不存在' };
        const passRate =
          run.total_count > 0
            ? `${((run.pass_count / run.total_count) * 100).toFixed(1)}%`
            : 'N/A';
        return {
          id: run.id,
          status: run.status,
          pass: run.pass_count,
          fail: run.fail_count,
          total: run.total_count,
          pass_rate: passRate,
          started_at: run.started_at,
          prompt_profile_id: run.prompt_profile_id,
        };
      });
      return JSON.stringify(results, null, 2);
    },
    {
      name: 'compare_runs',
      description: '对比多次运行的通过率变化趋势。传入多个 run_id，返回每次运行的统计数据用于趋势分析。',
      schema: z.object({
        run_ids: z.array(z.number().int()).describe('要对比的运行记录 ID 列表'),
      }),
    },
  );

  // ---- 获取提示词模板 ----
  const getPromptProfileTool = tool(
    async ({ prompt_id }) => {
      const prompt = promptsRepo.getPromptProfile(db, prompt_id);
      if (!prompt) return JSON.stringify({ error: `提示词模板 #${prompt_id} 不存在` });
      return JSON.stringify(prompt, null, 2);
    },
    {
      name: 'get_prompt_profile',
      description: '获取指定提示词模板的完整原始内容，包含 system_prompt、user_prompt_template、output_schema_json。',
      schema: z.object({
        prompt_id: z.number().int().describe('提示词模板 ID'),
      }),
    },
  );

  // ---- 更新提示词模板 ----
  const updatePromptProfileTool = tool(
    async ({ prompt_id, system_prompt, user_prompt_template, output_schema_json, notes }) => {
      // 只更新实际提供的字段，避免 undefined 覆盖数据库原值
      const patch: Partial<{
        system_prompt: string;
        user_prompt_template: string;
        output_schema_json: string;
        notes: string;
      }> = {};
      if (system_prompt !== undefined) patch.system_prompt = system_prompt;
      if (user_prompt_template !== undefined) patch.user_prompt_template = user_prompt_template;
      if (output_schema_json !== undefined) patch.output_schema_json = output_schema_json;
      if (notes !== undefined) patch.notes = notes;
      const updated = promptsRepo.updatePromptProfile(db, prompt_id, patch);
      if (!updated) return JSON.stringify({ error: `提示词模板 #${prompt_id} 不存在` });
      return JSON.stringify({ success: true, updated: { id: updated.id, name: updated.name } });
    },
    {
      name: 'update_prompt_profile',
      description:
        '更新提示词模板。可单独更新 system_prompt、user_prompt_template、output_schema_json、notes 中的任意字段。修改前请先向用户展示建议并获得确认。',
      schema: z.object({
        prompt_id: z.number().int().describe('提示词模板 ID'),
        system_prompt: z.string().optional().describe('新的系统提示词'),
        user_prompt_template: z.string().optional().describe('新的用户提示词模板'),
        output_schema_json: z.string().optional().describe('新的输出结构 Schema JSON'),
        notes: z.string().optional().describe('备注信息'),
      }),
    },
  );

  // ---- 列出测试集 ----
  const listTestSuitesTool = tool(
    async () => {
      const suites = suitesRepo.listTestSuites(db);
      return JSON.stringify(
        suites.map((s) => ({ id: s.id, name: s.name, created_at: s.created_at })),
        null,
        2,
      );
    },
    {
      name: 'list_test_suites',
      description: '列出所有测试集（id + name）。',
      schema: z.object({}),
    },
  );

  // ---- 列出运行记录 ----
  const listTestRunsTool = tool(
    async ({ limit }) => {
      const runs = runsRepo.listTestRuns(db, limit ?? 20);
      return JSON.stringify(
        runs.map((r) => ({
          id: r.id,
          suite_id: r.suite_id,
          status: r.status,
          pass: r.pass_count,
          fail: r.fail_count,
          total: r.total_count,
          prompt_profile_id: r.prompt_profile_id,
          created_at: r.created_at,
        })),
        null,
        2,
      );
    },
    {
      name: 'list_test_runs',
      description: '列出最近的运行记录。可指定数量上限（默认 20）。',
      schema: z.object({
        limit: z.number().int().optional().describe('返回数量上限'),
      }),
    },
  );

  // ---- 列出提示词模板 ----
  const listPromptProfilesTool = tool(
    async () => {
      const prompts = promptsRepo.listPromptProfiles(db);
      return JSON.stringify(
        prompts.map((p) => ({ id: p.id, name: p.name, created_at: p.created_at })),
        null,
        2,
      );
    },
    {
      name: 'list_prompt_profiles',
      description: '列出所有提示词模板（id + name）。',
      schema: z.object({}),
    },
  );

  return [
    getTestRunReportTool,
    getRunItemsTool,
    getRunItemDetailTool,
    compareRunsTool,
    getPromptProfileTool,
    updatePromptProfileTool,
    listTestSuitesTool,
    listTestRunsTool,
    listPromptProfilesTool,
  ];
}
