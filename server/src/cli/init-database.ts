/**
 * 仅初始化 SQLite 与数据目录，不启动 HTTP 服务。
 * 建表逻辑与 `openDatabase()` 一致（CREATE TABLE IF NOT EXISTS）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { openDatabase } from '../db.js';

function main() {
  fs.mkdirSync(path.dirname(config.sqlitePath), { recursive: true });
  fs.mkdirSync(config.testSuiteParentDir, { recursive: true });

  const db = openDatabase();
  try {
    const row = db.prepare('SELECT COUNT(*) AS c FROM sqlite_master WHERE type = ?').get('table') as {
      c: number;
    };
    console.log('[image-tester] 数据库:', config.sqlitePath);
    console.log('[image-tester] 测试集根目录:', config.testSuiteParentDir);
    console.log('[image-tester] 表已就绪（sqlite_master 中表数量:', row.c, '）');
  } finally {
    db.close();
  }
}

try {
  main();
} catch (e) {
  console.error('[image-tester] 初始化失败:', (e as Error).message);
  process.exit(1);
}
