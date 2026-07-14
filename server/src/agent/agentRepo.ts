/**
 * Agent 会话仓库：会话 CRUD + 消息存储。
 */
import type Database from 'better-sqlite3';

export interface AgentSession {
  id: number;
  title: string;
  provider_profile_id: number;
  model: string | null;
  agent_name: string;
  created_at: string;
}

export interface AgentMessage {
  id: number;
  session_id: number;
  role: string; // user | assistant | tool
  content: string;
  tool_calls_json: string | null;
  tool_call_id: string | null;
  created_at: string;
}

export function listSessions(db: Database.Database, limit = 50): AgentSession[] {
  return db
    .prepare('SELECT * FROM agent_sessions ORDER BY id DESC LIMIT ?')
    .all(limit) as AgentSession[];
}

export function getSession(db: Database.Database, id: number): AgentSession | undefined {
  return db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(id) as AgentSession | undefined;
}

export function insertSession(
  db: Database.Database,
  row: { title: string; provider_profile_id: number; model?: string | null; agent_name: string },
): AgentSession {
  const info = db
    .prepare(
      `INSERT INTO agent_sessions (title, provider_profile_id, model, agent_name)
       VALUES (@title, @provider_profile_id, @model, @agent_name)`,
    )
    .run({
      title: row.title,
      provider_profile_id: row.provider_profile_id,
      model: row.model ?? null,
      agent_name: row.agent_name,
    });
  return getSession(db, Number(info.lastInsertRowid))!;
}

export function deleteSession(db: Database.Database, id: number): boolean {
  return db.prepare('DELETE FROM agent_sessions WHERE id = ?').run(id).changes > 0;
}

export function updateSessionTitle(db: Database.Database, id: number, title: string): void {
  db.prepare('UPDATE agent_sessions SET title = ? WHERE id = ?').run(title, id);
}

export function listMessages(db: Database.Database, sessionId: number): AgentMessage[] {
  return db
    .prepare('SELECT * FROM agent_messages WHERE session_id = ? ORDER BY id ASC')
    .all(sessionId) as AgentMessage[];
}

export function insertMessage(
  db: Database.Database,
  row: {
    session_id: number;
    role: string;
    content: string;
    tool_calls_json?: string | null;
    tool_call_id?: string | null;
  },
): AgentMessage {
  const info = db
    .prepare(
      `INSERT INTO agent_messages (session_id, role, content, tool_calls_json, tool_call_id)
       VALUES (@session_id, @role, @content, @tool_calls_json, @tool_call_id)`,
    )
    .run({
      session_id: row.session_id,
      role: row.role,
      content: row.content,
      tool_calls_json: row.tool_calls_json ?? null,
      tool_call_id: row.tool_call_id ?? null,
    });
  return db
    .prepare('SELECT * FROM agent_messages WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as AgentMessage;
}
