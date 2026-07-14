import type Database from 'better-sqlite3';
import type { ProviderProfile } from '../model/types.js';

export function listProviderProfiles(db: Database.Database): ProviderProfile[] {
  return db.prepare('SELECT * FROM provider_profiles ORDER BY id DESC').all() as ProviderProfile[];
}

export function getProviderProfile(db: Database.Database, id: number): ProviderProfile | undefined {
  return db.prepare('SELECT * FROM provider_profiles WHERE id = ?').get(id) as ProviderProfile | undefined;
}

export function insertProviderProfile(
  db: Database.Database,
  row: Omit<ProviderProfile, 'id' | 'created_at' | 'default_params_json' | 'context_window' | 'streaming'> & { default_params_json?: string; context_window?: number; streaming?: number },
): ProviderProfile {
  const defaultParams = row.default_params_json ?? '{}';
  const contextWindow = row.context_window ?? 256000;
  const streaming = row.streaming ?? 1;
  const info = db
    .prepare(
      `INSERT INTO provider_profiles (name, provider_type, base_url, api_key_env, default_model, default_params_json, context_window, streaming)
       VALUES (@name, @provider_type, @base_url, @api_key_env, @default_model, @default_params_json, @context_window, @streaming)`,
    )
    .run({
      name: row.name,
      provider_type: row.provider_type,
      base_url: row.base_url,
      api_key_env: row.api_key_env,
      default_model: row.default_model,
      default_params_json: defaultParams,
      context_window: contextWindow,
      streaming,
    });
  return getProviderProfile(db, Number(info.lastInsertRowid))!;
}

export function updateProviderProfile(
  db: Database.Database,
  id: number,
  patch: Partial<
    Pick<ProviderProfile, 'name' | 'provider_type' | 'base_url' | 'api_key_env' | 'default_model' | 'default_params_json' | 'context_window' | 'streaming'>
  >,
): ProviderProfile | undefined {
  const cur = getProviderProfile(db, id);
  if (!cur) return undefined;
  const next = { ...cur, ...patch };
  db.prepare(
    `UPDATE provider_profiles SET
      name = @name,
      provider_type = @provider_type,
      base_url = @base_url,
      api_key_env = @api_key_env,
      default_model = @default_model,
      default_params_json = @default_params_json,
      context_window = @context_window,
      streaming = @streaming
     WHERE id = @id`,
  ).run({
    id,
    name: next.name,
    provider_type: next.provider_type,
    base_url: next.base_url,
    api_key_env: next.api_key_env,
    default_model: next.default_model,
    default_params_json: next.default_params_json,
    context_window: next.context_window,
    streaming: next.streaming,
  });
  return getProviderProfile(db, id);
}

export function deleteProviderProfile(db: Database.Database, id: number): boolean {
  const info = db.prepare('DELETE FROM provider_profiles WHERE id = ?').run(id);
  return info.changes > 0;
}
