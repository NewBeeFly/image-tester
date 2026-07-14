/**
 * 工具集入口：组合内置工具 + API 工具 + 技能工具。
 */
import type Database from 'better-sqlite3';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { builtinTools } from './builtin.js';
import { createApiTools } from './apiTools.js';
import { createSkillTools } from './skillTools.js';
import type { AgentDefinition } from '../../agents/loader.js';

import type { Summarizer } from '../summarizer.js';

/** 为指定 agent 创建完整的工具集 */
export function createAllTools(
  db: Database.Database,
  agentDef: AgentDefinition,
  summarizer?: Summarizer,
): StructuredToolInterface[] {
  const apiTools = createApiTools(db, summarizer);
  const skillTools = createSkillTools(agentDef);

  // API 工具按 config.json 中的 enabledTools 过滤
  const enabledApiToolNames = new Set(agentDef.config.enabledTools);
  const filteredApiTools = apiTools.filter((t) => enabledApiToolNames.has(t.name));

  return [...builtinTools, ...skillTools, ...filteredApiTools];
}
