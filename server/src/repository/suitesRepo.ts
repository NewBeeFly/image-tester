import type Database from 'better-sqlite3';
import type { TestCase, TestSuite } from '../model/types.js';

export function listTestSuites(db: Database.Database): TestSuite[] {
  return db.prepare('SELECT * FROM test_suites ORDER BY id DESC').all() as TestSuite[];
}

export function getTestSuite(db: Database.Database, id: number): TestSuite | undefined {
  return db.prepare('SELECT * FROM test_suites WHERE id = ?').get(id) as TestSuite | undefined;
}

export function insertTestSuite(
  db: Database.Database,
  row: {
    name: string;
    image_root: string;
    default_assertions_json?: string;
    global_variables_json?: string;
  },
): TestSuite {
  const info = db
    .prepare(
      `INSERT INTO test_suites (name, image_root, default_assertions_json, global_variables_json)
       VALUES (@name, @image_root, @default_assertions_json, @global_variables_json)`,
    )
    .run({
      name: row.name,
      image_root: row.image_root,
      default_assertions_json: row.default_assertions_json ?? '{"rules":[]}',
      global_variables_json: row.global_variables_json ?? '{}',
    });
  return getTestSuite(db, Number(info.lastInsertRowid))!;
}

export function updateTestSuite(
  db: Database.Database,
  id: number,
  patch: Partial<
    Pick<
      TestSuite,
      'name' | 'image_root' | 'default_assertions_json' | 'global_variables_json'
    >
  >,
): TestSuite | undefined {
  const cur = getTestSuite(db, id);
  if (!cur) return undefined;
  const next = { ...cur, ...patch };
  db.prepare(
    `UPDATE test_suites SET
      name = @name,
      image_root = @image_root,
      default_assertions_json = @default_assertions_json,
      global_variables_json = @global_variables_json
     WHERE id = @id`,
  ).run({
    id,
    name: next.name,
    image_root: next.image_root,
    default_assertions_json: next.default_assertions_json,
    global_variables_json: next.global_variables_json ?? '{}',
  });
  return getTestSuite(db, id);
}

/**
 * 删除测试集。须先删该集下的 `test_runs`（会级联删掉 `test_run_items`），再删 `test_cases`，
 * 最后删 `test_suites`；否则 `test_runs.suite_id` 外键会阻止删除。
 */
export function deleteTestSuite(db: Database.Database, id: number): boolean {
  const delRuns = db.prepare('DELETE FROM test_runs WHERE suite_id = ?');
  const delCases = db.prepare('DELETE FROM test_cases WHERE suite_id = ?');
  const delSuite = db.prepare('DELETE FROM test_suites WHERE id = ?');
  const tx = db.transaction(() => {
    delRuns.run(id);
    delCases.run(id);
    return delSuite.run(id).changes > 0;
  });
  return tx();
}

export function listTestCases(db: Database.Database, suiteId: number): TestCase[] {
  return db
    .prepare('SELECT * FROM test_cases WHERE suite_id = ? ORDER BY sort_order ASC, id ASC')
    .all(suiteId) as TestCase[];
}

export function getTestCase(db: Database.Database, id: number): TestCase | undefined {
  return db.prepare('SELECT * FROM test_cases WHERE id = ?').get(id) as TestCase | undefined;
}

export function insertTestCase(
  db: Database.Database,
  suiteId: number,
  row: {
    relative_image_path: string;
    variables_json?: string;
    assertions_override_json?: string | null;
    sort_order?: number;
  },
): TestCase {
  const info = db
    .prepare(
      `INSERT INTO test_cases (suite_id, relative_image_path, variables_json, assertions_override_json, sort_order)
       VALUES (@suite_id, @relative_image_path, @variables_json, @assertions_override_json, @sort_order)`,
    )
    .run({
      suite_id: suiteId,
      relative_image_path: row.relative_image_path,
      variables_json: row.variables_json ?? '{}',
      assertions_override_json: row.assertions_override_json ?? null,
      sort_order: row.sort_order ?? 0,
    });
  return getTestCase(db, Number(info.lastInsertRowid))!;
}

export function updateTestCase(
  db: Database.Database,
  id: number,
  patch: Partial<Pick<TestCase, 'relative_image_path' | 'variables_json' | 'assertions_override_json' | 'sort_order'>>,
): TestCase | undefined {
  const cur = getTestCase(db, id);
  if (!cur) return undefined;
  const next = { ...cur, ...patch };
  db.prepare(
    `UPDATE test_cases SET
      relative_image_path = @relative_image_path,
      variables_json = @variables_json,
      assertions_override_json = @assertions_override_json,
      sort_order = @sort_order
     WHERE id = @id`,
  ).run({
    id,
    relative_image_path: next.relative_image_path,
    variables_json: next.variables_json,
    assertions_override_json: next.assertions_override_json,
    sort_order: next.sort_order,
  });
  return getTestCase(db, id);
}

/**
 * 删除用例。须先删 `test_run_items` 中引用该 case 的行，否则在开启外键或存在历史运行记录时
 * `DELETE FROM test_cases` 会失败或表现为「删不掉」。
 */
export function deleteTestCase(db: Database.Database, id: number): boolean {
  const delItems = db.prepare('DELETE FROM test_run_items WHERE case_id = ?');
  const delCase = db.prepare('DELETE FROM test_cases WHERE id = ?');
  const tx = db.transaction(() => {
    delItems.run(id);
    return delCase.run(id).changes > 0;
  });
  return tx();
}

export function bulkInsertTestCases(
  db: Database.Database,
  suiteId: number,
  rows: Array<{
    relative_image_path: string;
    variables_json?: string;
    assertions_override_json?: string | null;
    sort_order?: number;
  }>,
): void {
  const insert = db.prepare(
    `INSERT INTO test_cases (suite_id, relative_image_path, variables_json, assertions_override_json, sort_order)
     VALUES (@suite_id, @relative_image_path, @variables_json, @assertions_override_json, @sort_order)`,
  );
  const tx = db.transaction(() => {
    for (const row of rows) {
      insert.run({
        suite_id: suiteId,
        relative_image_path: row.relative_image_path,
        variables_json: row.variables_json ?? '{}',
        assertions_override_json: row.assertions_override_json ?? null,
        sort_order: row.sort_order ?? 0,
      });
    }
  });
  tx();
}
