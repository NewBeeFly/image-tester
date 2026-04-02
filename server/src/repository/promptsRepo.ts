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
