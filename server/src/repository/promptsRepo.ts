import type Database from 'better-sqlite3';
import type { PromptProfile } from '../model/types.js';

export function listPromptProfiles(db: Database.Database): PromptProfile[] {
  return db.prepare('SELECT * FROM prompt_profiles ORDER BY id DESC').all() as PromptProfile[];
}

export function getPromptProfile(db: Database.Database, id: number): PromptProfile | undefined {
  return db.prepare('SELECT * FROM prompt_profiles WHERE id = ?').get(id) as PromptProfile | undefined;
}

export function insertPromptProfile(
  db: Database.Database,
  row: { name: string; system_prompt?: string; user_prompt_template: string; notes?: string },
): PromptProfile {
  const info = db
    .prepare(
      `INSERT INTO prompt_profiles (name, system_prompt, user_prompt_template, notes)
       VALUES (@name, @system_prompt, @user_prompt_template, @notes)`,
    )
    .run({
      name: row.name,
      system_prompt: row.system_prompt ?? '',
      user_prompt_template: row.user_prompt_template,
      notes: row.notes ?? '',
    });
  return getPromptProfile(db, Number(info.lastInsertRowid))!;
}

export function updatePromptProfile(
  db: Database.Database,
  id: number,
  patch: Partial<Pick<PromptProfile, 'name' | 'system_prompt' | 'user_prompt_template' | 'notes'>>,
): PromptProfile | undefined {
  const cur = getPromptProfile(db, id);
  if (!cur) return undefined;
  const next = { ...cur, ...patch };
  db.prepare(
    `UPDATE prompt_profiles SET
      name = @name,
      system_prompt = @system_prompt,
      user_prompt_template = @user_prompt_template,
      notes = @notes
     WHERE id = @id`,
  ).run({
    id,
    name: next.name,
    system_prompt: next.system_prompt,
    user_prompt_template: next.user_prompt_template,
    notes: next.notes,
  });
  return getPromptProfile(db, id);
}

export function deletePromptProfile(db: Database.Database, id: number): boolean {
  const info = db.prepare('DELETE FROM prompt_profiles WHERE id = ?').run(id);
  return info.changes > 0;
}

export type PromptProfileRunDependency = {
  run_count: number;
  latest_run_ids: number[];
};

export function getPromptProfileRunDependency(
  db: Database.Database,
  id: number,
): PromptProfileRunDependency {
  const row = db
    .prepare('SELECT COUNT(*) AS cnt FROM test_runs WHERE prompt_profile_id = ?')
    .get(id) as { cnt: number | bigint };
  const latest = db
    .prepare('SELECT id FROM test_runs WHERE prompt_profile_id = ? ORDER BY id DESC LIMIT 5')
    .all(id) as Array<{ id: number }>;
  return {
    run_count: Number(row.cnt ?? 0),
    latest_run_ids: latest.map((x) => x.id),
  };
}

/**
 * 强制删除提示词模板：先删关联报告（test_runs，连带 test_run_items），再删模板本身。
 */
export function forceDeletePromptProfileWithRuns(db: Database.Database, id: number): boolean {
  const delRuns = db.prepare('DELETE FROM test_runs WHERE prompt_profile_id = ?');
  const delPrompt = db.prepare('DELETE FROM prompt_profiles WHERE id = ?');
  const tx = db.transaction(() => {
    delRuns.run(id);
    return delPrompt.run(id).changes > 0;
  });
  return tx();
}
