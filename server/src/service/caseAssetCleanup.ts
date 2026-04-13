import fs from 'node:fs';
import path from 'node:path';
import {
  IMAGE_TESTER_MANIFEST,
  LEGACY_METADATA_MANIFEST,
  sidecarRelativePathForImage,
} from '../utils/caseMetadataMerge.js';
import { resolveUnderRoot } from '../utils/pathSafe.js';

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function readJsonObjectOrNull(abs: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(abs, 'utf8');
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function deleteManifestKey(abs: string, key: string): boolean {
  const obj = readJsonObjectOrNull(abs);
  if (!obj || !(key in obj)) return false;
  delete obj[key];
  fs.writeFileSync(abs, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  return true;
}

function removeFileIfExists(abs: string): void {
  try {
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      fs.unlinkSync(abs);
    }
  } catch {
    // best-effort cleanup
  }
}

/**
 * 删除单条用例关联的磁盘资产：
 * 1) 主图文件
 * 2) 同名侧车 json
 * 3) 根清单里以完整相对路径为 key 的条目
 * 4) 图片所在子目录清单里以裸文件名为 key 的条目
 */
export function cleanupCaseAssets(imageRoot: string, relativeImagePath: string): void {
  const rel = toPosix(relativeImagePath).replace(/^\/+/, '');
  if (!rel) return;

  const absImage = resolveUnderRoot(imageRoot, rel);
  removeFileIfExists(absImage);

  const sidecarRel = sidecarRelativePathForImage(rel);
  const absSidecar = resolveUnderRoot(imageRoot, sidecarRel);
  removeFileIfExists(absSidecar);

  const basename = path.posix.basename(rel);
  const relDir = path.posix.dirname(rel);
  const rootCandidates = [
    resolveUnderRoot(imageRoot, IMAGE_TESTER_MANIFEST),
    resolveUnderRoot(imageRoot, LEGACY_METADATA_MANIFEST),
  ];
  for (const abs of rootCandidates) {
    deleteManifestKey(abs, rel);
  }

  if (relDir !== '.') {
    const dirCandidates = [
      resolveUnderRoot(imageRoot, `${relDir}/${IMAGE_TESTER_MANIFEST}`),
      resolveUnderRoot(imageRoot, `${relDir}/${LEGACY_METADATA_MANIFEST}`),
    ];
    for (const abs of dirCandidates) {
      deleteManifestKey(abs, basename);
    }
  }
}
