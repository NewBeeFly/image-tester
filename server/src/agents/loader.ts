/**
 * Agent 定义加载器：从磁盘读取 agent 目录结构，解析 system.md、config.json、skills。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = __dirname;

export interface SkillManifest {
  name: string;
  description: string;
  relatedTools: string[];
  /** skill.md 的完整内容（frontmatter + body） */
  fullPath: string;
}

export interface AgentConfig {
  name: string;
  displayName: string;
  defaultModel: string | null;
  enabledSkills: string[];
  globalSkills: string[];
  enabledTools: string[];
}

export interface AgentDefinition {
  config: AgentConfig;
  systemPrompt: string;
  /** agent 专属 skills */
  skills: Map<string, SkillManifest>;
  /** 全局 skills（从 common/ 加载） */
  globalSkillMap: Map<string, SkillManifest>;
}

/** 解析 YAML frontmatter（简易实现，不引入额外依赖） */
function parseFrontmatter(content: string): { meta: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const yamlStr = match[1];
  const body = match[2];
  const meta: Record<string, unknown> = {};

  // 简易 YAML 解析：支持 name: value 和 list 项（- item）
  let currentKey = '';
  for (const line of yamlStr.split('\n')) {
    const kvMatch = line.match(/^(\w+):\s*(.*)$/);
    if (kvMatch) {
      const [, key, val] = kvMatch;
      currentKey = key;
      if (val.trim()) {
        meta[key] = val.trim();
      } else {
        meta[key] = [];
      }
    } else if (line.match(/^\s+-\s+(.+)$/) && currentKey && Array.isArray(meta[currentKey])) {
      const val = line.match(/^\s+-\s+(.+)$/)?.[1]?.trim();
      if (val) (meta[currentKey] as string[]).push(val);
    }
  }

  return { meta, body };
}

/** 加载单个 skill 目录 */
function loadSkill(skillDir: string): SkillManifest | null {
  const skillMdPath = path.join(skillDir, 'skill.md');
  if (!fs.existsSync(skillMdPath)) return null;

  const content = fs.readFileSync(skillMdPath, 'utf8');
  const { meta } = parseFrontmatter(content);

  return {
    name: (meta.name as string) || path.basename(skillDir),
    description: (meta.description as string) || '',
    relatedTools: Array.isArray(meta.related_tools) ? (meta.related_tools as string[]) : [],
    fullPath: skillMdPath,
  };
}

/** 扫描目录下所有 skill 子目录 */
function loadSkillsFromDir(dir: string): Map<string, SkillManifest> {
  const skills = new Map<string, SkillManifest>();
  if (!fs.existsSync(dir)) return skills;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skill = loadSkill(path.join(dir, entry.name));
    if (skill) skills.set(skill.name, skill);
  }
  return skills;
}

/** 加载全局 skills（common/skills/） */
export function loadGlobalSkills(): Map<string, SkillManifest> {
  return loadSkillsFromDir(path.join(AGENTS_DIR, 'common', 'skills'));
}

/** 加载指定 agent 定义 */
export function loadAgent(agentName: string): AgentDefinition | null {
  const agentDir = path.join(AGENTS_DIR, agentName);
  if (!fs.existsSync(agentDir)) return null;

  // 读取 config.json
  const configPath = path.join(agentDir, 'config.json');
  if (!fs.existsSync(configPath)) return null;
  const config: AgentConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  // 读取 system.md
  const systemMdPath = path.join(agentDir, 'system.md');
  const systemPrompt = fs.existsSync(systemMdPath)
    ? fs.readFileSync(systemMdPath, 'utf8')
    : '';

  // 加载 agent skills
  const skills = loadSkillsFromDir(path.join(agentDir, 'skills'));

  // 加载全局 skills
  const globalSkillMap = loadGlobalSkills();

  return { config, systemPrompt, skills, globalSkillMap };
}

/** 读取 skill.md 的完整内容 */
export function readSkillContent(skill: SkillManifest): string {
  return fs.readFileSync(skill.fullPath, 'utf8');
}

/** 列出 agents/ 目录下所有 agent 名称 */
export function listAgentNames(): string[] {
  const names: string[] = [];
  if (!fs.existsSync(AGENTS_DIR)) return names;

  const entries = fs.readdirSync(AGENTS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'common') continue;
    const configPath = path.join(AGENTS_DIR, entry.name, 'config.json');
    if (fs.existsSync(configPath)) names.push(entry.name);
  }
  return names;
}
