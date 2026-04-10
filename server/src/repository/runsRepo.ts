import type Database from 'better-sqlite3';
import type { RunItemStatus, TestRun, TestRunItem } from '../model/types.js';

export function insertTestRun(
  db: Database.Database,
  row: {
    suite_id: number;
    provider_profile_id: number;
    prompt_profile_id: number;
    model_override?: string | null;
    params_override_json?: string | null;
    concurrency: number;
    total_count: number;
  },
): TestRun {
  const info = db
    .prepare(
      `INSERT INTO test_runs (
        suite_id, provider_profile_id, prompt_profile_id,
        model_override, params_override_json, concurrency, status, total_count
      ) VALUES (
        @suite_id, @provider_profile_id, @prompt_profile_id,
        @model_override, @params_override_json, @concurrency, 'pending', @total_count
      )`,
    )
    .run({
      suite_id: row.suite_id,
      provider_profile_id: row.provider_profile_id,
      prompt_profile_id: row.prompt_profile_id,
      model_override: row.model_override ?? null,
      params_override_json: row.params_override_json ?? null,
      concurrency: row.concurrency,
      total_count: row.total_count,
    });
  return getTestRun(db, Number(info.lastInsertRowid))!;
}

export function insertRunItems(db: Database.Database, runId: number, caseIds: number[]): void {
  const stmt = db.prepare(
    `INSERT INTO test_run_items (run_id, case_id, status) VALUES (?, ?, 'pending')`,
  );
  const tx = db.transaction(() => {
    for (const caseId of caseIds) {
      stmt.run(runId, caseId);
    }
  });
  tx();
}

export function getTestRun(db: Database.Database, id: number): TestRun | undefined {
  return db.prepare('SELECT * FROM test_runs WHERE id = ?').get(id) as TestRun | undefined;
}

export function listTestRuns(db: Database.Database, limit = 50): TestRun[] {
  return db
    .prepare('SELECT * FROM test_runs ORDER BY id DESC LIMIT ?')
    .all(limit) as TestRun[];
}

export function updateRunStatus(
  db: Database.Database,
  id: number,
  patch: Partial<
    Pick<
      TestRun,
      | 'status'
      | 'pass_count'
      | 'fail_count'
      | 'error_count'
      | 'current_index'
      | 'started_at'
      | 'finished_at'
      | 'last_error'
    >
  >,
): void {
  const cur = getTestRun(db, id);
  if (!cur) return;
  const next = { ...cur, ...patch };
  db.prepare(
    `UPDATE test_runs SET
      status = @status,
      pass_count = @pass_count,
      fail_count = @fail_count,
      error_count = @error_count,
      current_index = @current_index,
      started_at = @started_at,
      finished_at = @finished_at,
      last_error = @last_error
     WHERE id = @id`,
  ).run({
    id,
    status: next.status,
    pass_count: next.pass_count,
    fail_count: next.fail_count,
    error_count: next.error_count,
    current_index: next.current_index,
    started_at: next.started_at,
    finished_at: next.finished_at,
    last_error: next.last_error,
  });
}

/**
 * 并发安全：用 SQL 自增累计 pass / fail / error，并推进 current_index。
 */
export function bumpRunProgress(
  db: Database.Database,
  id: number,
  delta: { pass?: number; fail?: number; error?: number },
): void {
  db.prepare(
    `UPDATE test_runs SET
      pass_count = pass_count + @pass,
      fail_count = fail_count + @fail,
      error_count = error_count + @err,
      current_index = current_index + 1
     WHERE id = @id`,
  ).run({
    id,
    pass: delta.pass ?? 0,
    fail: delta.fail ?? 0,
    err: delta.error ?? 0,
  });
}

export function listRunItems(
  db: Database.Database,
  runId: number,
  opts?: { pass?: boolean; limit?: number; offset?: number },
): TestRunItem[] {
  let sql = 'SELECT * FROM test_run_items WHERE run_id = ?';
  const params: unknown[] = [runId];
  if (opts?.pass === true) {
    sql += ' AND pass = 1';
  } else if (opts?.pass === false) {
    sql += ' AND (pass = 0 OR pass IS NULL)';
  }
  sql += ' ORDER BY id ASC';
  if (opts?.limit != null) {
    sql += ' LIMIT ?';
    params.push(opts.limit);
    if (opts.offset != null) {
      sql += ' OFFSET ?';
      params.push(opts.offset);
    }
  }
  return db.prepare(sql).all(...params) as TestRunItem[];
}

export function getRunItemByRunAndCase(
  db: Database.Database,
  runId: number,
  caseId: number,
): TestRunItem | undefined {
  return db
    .prepare('SELECT * FROM test_run_items WHERE run_id = ? AND case_id = ?')
    .get(runId, caseId) as TestRunItem | undefined;
}

export function updateRunItem(
  db: Database.Database,
  id: number,
  patch: Partial<
    Pick<
      TestRunItem,
      | 'status'
      | 'model_output'
      | 'raw_response_json'
      | 'assertion_details_json'
      | 'pass'
      | 'duration_ms'
      | 'error_message'
    >
  >,
): void {
  const cur = db.prepare('SELECT * FROM test_run_items WHERE id = ?').get(id) as TestRunItem | undefined;
  if (!cur) return;
  const next = { ...cur, ...patch };
  db.prepare(
    `UPDATE test_run_items SET
      status = @status,
      model_output = @model_output,
      raw_response_json = @raw_response_json,
      assertion_details_json = @assertion_details_json,
      pass = @pass,
      duration_ms = @duration_ms,
      error_message = @error_message
     WHERE id = @id`,
  ).run({
    id,
    status: next.status,
    model_output: next.model_output,
    raw_response_json: next.raw_response_json,
    assertion_details_json: next.assertion_details_json,
    pass: next.pass,
    duration_ms: next.duration_ms,
    error_message: next.error_message,
  });
}

export function listRunItemsWithCases(
  db: Database.Database,
  runId: number,
  opts?: { pass?: boolean; limit?: number },
): Array<TestRunItem & { relative_image_path: string; suite_id: number }> {
  let sql = `
    SELECT i.*, c.relative_image_path, c.suite_id
    FROM test_run_items i
    JOIN test_cases c ON c.id = i.case_id
    WHERE i.run_id = ?
  `;
  const params: unknown[] = [runId];
  if (opts?.pass === true) {
    sql += ' AND i.pass = 1';
  } else if (opts?.pass === false) {
    sql += ' AND (i.pass = 0 OR i.pass IS NULL)';
  }
  sql += ' ORDER BY i.id ASC';
  if (opts?.limit != null) {
    sql += ' LIMIT ?';
    params.push(opts.limit);
  }
  return db.prepare(sql).all(...params) as Array<
    TestRunItem & { relative_image_path: string; suite_id: number }
  >;
}

export function updateRunItemStatus(db: Database.Database, id: number, status: RunItemStatus): void {
  db.prepare('UPDATE test_run_items SET status = ? WHERE id = ?').run(status, id);
}

export function getRunItemsPending(db: Database.Database, runId: number): TestRunItem[] {
  return db
    .prepare(
      `SELECT * FROM test_run_items WHERE run_id = ? AND status = 'pending' ORDER BY id ASC`,
    )
    .all(runId) as TestRunItem[];
}

export function listRunItemsAll(db: Database.Database, runId: number): TestRunItem[] {
  return db
    .prepare(`SELECT * FROM test_run_items WHERE run_id = ? ORDER BY id ASC`)
    .all(runId) as TestRunItem[];
}

export interface RunDurationStats {
  avg_ms: number | null;
  count: number;
}

/** 本次运行全部用例中有 duration_ms 的记录（pending/running 通常为 null，不计入）。 */
export function getRunDurationStats(db: Database.Database, runId: number): RunDurationStats {
  const row = db
    .prepare(
      `SELECT AVG(duration_ms) AS avg_ms, COUNT(*) AS cnt
       FROM test_run_items
       WHERE run_id = ? AND duration_ms IS NOT NULL`,
    )
    .get(runId) as { avg_ms: number | null; cnt: number | bigint | null };
  const cnt = Number(row.cnt ?? 0);
  if (!cnt || row.avg_ms == null) {
    return { avg_ms: null, count: 0 };
  }
  return { avg_ms: Number(row.avg_ms), count: cnt };
}
