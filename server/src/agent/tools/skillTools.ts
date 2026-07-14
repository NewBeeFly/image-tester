/**
 * 技能工具集：list_skills 和 load_skill，需要运行时注入 agent 定义。
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { readSkillContent, type AgentDefinition, type SkillManifest } from '../../agents/loader.js';

/** 创建技能相关工具 */
export function createSkillTools(agentDef: AgentDefinition) {
  const allSkills = new Map<string, SkillManifest>();
  // 合并 agent 专属 skills + 全局 skills
  for (const [k, v] of agentDef.skills) allSkills.set(k, v);
  for (const [k, v] of agentDef.globalSkillMap) allSkills.set(k, v);

  // 只保留 config.json 中声明启用的 skills + 全局 skills
  const enabledNames = new Set([
    ...agentDef.config.enabledSkills,
    ...agentDef.config.globalSkills,
  ]);

  const listSkillsTool = tool(
    async () => {
      const result: Array<{ name: string; description: string; relatedTools: string[] }> = [];
      for (const [name, skill] of allSkills) {
        if (!enabledNames.has(name)) continue;
        result.push({
          name: skill.name,
          description: skill.description,
          relatedTools: skill.relatedTools,
        });
      }
      return JSON.stringify(result, null, 2);
    },
    {
      name: 'list_skills',
      description:
        '列出当前 agent 所有可用的技能，返回名称、描述和关联工具。用于了解有哪些技能可以加载。',
      schema: z.object({}),
    },
  );

  const loadSkillTool = tool(
    async ({ skill_name }) => {
      const skill = allSkills.get(skill_name);
      if (!skill) {
        const available = Array.from(allSkills.keys()).join(', ');
        return `技能 "${skill_name}" 不存在。可用技能: ${available}`;
      }
      return readSkillContent(skill);
    },
    {
      name: 'load_skill',
      description:
        '加载指定技能的完整内容到对话中。先用 list_skills 查看可用技能，再按需加载。加载后的内容包含详细的工作流指导和工具使用建议。',
      schema: z.object({
        skill_name: z.string().describe('要加载的技能名称'),
      }),
    },
  );

  return [listSkillsTool, loadSkillTool];
}
