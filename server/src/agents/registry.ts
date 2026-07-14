/**
 * Agent 注册表：管理已加载的 agent 定义，提供按名称查找。
 */
import { loadAgent, listAgentNames, type AgentDefinition } from './loader.js';

const agentCache = new Map<string, AgentDefinition>();

export function getAgent(name: string): AgentDefinition | null {
  if (agentCache.has(name)) return agentCache.get(name)!;
  const def = loadAgent(name);
  if (def) agentCache.set(name, def);
  return def;
}

export function getAllAgents(): AgentDefinition[] {
  const names = listAgentNames();
  return names.map((n) => getAgent(n)).filter((d): d is AgentDefinition => d !== null);
}

export function clearAgentCache(): void {
  agentCache.clear();
}
