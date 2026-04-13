import fs from 'node:fs';
import type Database from 'better-sqlite3';
import type { TestSuite } from '../model/types.js';
import * as suitesRepo from '../repository/suitesRepo.js';
import { cleanupCaseAssets } from './caseAssetCleanup.js';
import { scanImagesUnderSuiteRoot } from './scanService.js';
import { resolveUnderRoot } from '../utils/pathSafe.js';

export type SuiteConsistencyCleanupResult = {
  removed_db_cases: number;
  removed_files: number;
  removed_metadata_entries: number;
  kept_db_cases: number;
  kept_files: number;
};

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * 清理测试集内数据库与文件系统不一致的数据：
 * 1) DB 有但图片文件不存在：删除 DB 用例，并清理对应 metadata 条目
 * 2) 文件存在但 DB 无用例：删除图片文件，并清理对应 metadata 条目
 */
export async function cleanupSuiteConsistency(
  db: Database.Database,
  suite: TestSuite,
): Promise<SuiteConsistencyCleanupResult> {
  const cases = suitesRepo.listTestCases(db, suite.id);
  let scannedFiles: string[] = [];
  try {
    scannedFiles = await scanImagesUnderSuiteRoot(suite.image_root, '', {
      maxFiles: 200000,
      maxDepth: 20,
    });
  } catch (e) {
    // 目录不存在时按空目录处理；其它错误继续抛出
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw e;
    }
  }

  const fileSet = new Set(scannedFiles.map((p) => toPosix(p)));
  const casePathSet = new Set(cases.map((c) => toPosix(c.relative_image_path)));

  let removedDbCases = 0;
  let removedFiles = 0;
  let removedMetadataEntries = 0;

  // A. DB 存在但图片文件不存在
  for (const c of cases) {
    const rel = toPosix(c.relative_image_path);
    if (fileSet.has(rel)) continue;
    const ok = suitesRepo.deleteTestCase(db, c.id);
    if (ok) removedDbCases += 1;
    // 即使图片不存在，也要清理清单与侧车
    cleanupCaseAssets(suite.image_root, rel);
    removedMetadataEntries += 1;
  }

  // B. 图片文件存在但 DB 不存在
  for (const rel of fileSet) {
    if (casePathSet.has(rel)) continue;
    // 先确认仍是文件再删除
    const abs = resolveUnderRoot(suite.image_root, rel);
    if (fs.existsSync(abs)) {
      cleanupCaseAssets(suite.image_root, rel);
      removedFiles += 1;
      removedMetadataEntries += 1;
    }
  }

  const keptDbCases = suitesRepo.listTestCases(db, suite.id).length;
  let keptFiles = 0;
  try {
    keptFiles = (
      await scanImagesUnderSuiteRoot(suite.image_root, '', {
        maxFiles: 200000,
        maxDepth: 20,
      })
    ).length;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw e;
    }
  }

  return {
    removed_db_cases: removedDbCases,
    removed_files: removedFiles,
    removed_metadata_entries: removedMetadataEntries,
    kept_db_cases: keptDbCases,
    kept_files: keptFiles,
  };
}
