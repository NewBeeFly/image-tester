import fs from 'node:fs';
import path from 'node:path';
import { parseCaseMetadataJson, type CaseMetadata } from './multimodalPrompt.js';
import { resolveUnderRoot } from './pathSafe.js';

/** 放在 image_root 根目录的「多图路径 → 元数据」清单文件名（优先使用） */
export const IMAGE_TESTER_MANIFEST = 'image-tester-metadata.json';

/** 与上面二选一：若根目录仅有此文件也会被当作清单读取（便于沿用习惯命名） */
export const LEGACY_METADATA_MANIFEST = 'metadata.json';

function posix(p: string): string {
  return p.replace(/\\/g, '/');
}

function mergeMeta(a: CaseMetadata, b: CaseMetadata): CaseMetadata {
  return {
    variables: { ...a.variables, ...b.variables },
    images: { ...a.images, ...b.images },
  };
}

/**
 * 与 `relativeImagePath` 同目录、同主文件名、扩展名为 `.json` 的侧车路径（posix）。
 * 例：`photos/a.png` → `photos/a.json`
 */
export function sidecarRelativePathForImage(relativeImagePath: string): string {
  const p = posix(relativeImagePath).replace(/^\/+/, '');
  const dir = path.posix.dirname(p);
  const base = path.posix.basename(p);
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const file = `${stem}.json`;
  return dir === '.' ? file : `${dir}/${file}`;
}

function readUtf8Safe(abs: string): string | null {
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

function parseManifestFile(absManifest: string): Map<string, CaseMetadata> {
  const raw = readUtf8Safe(absManifest);
  const m = new Map<string, CaseMetadata>();
  if (!raw?.trim()) return m;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return m;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return m;
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    const key = posix(String(k)).replace(/^\/+/, '');
    if (!key || key.includes('\0')) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      m.set(key, parseCaseMetadataJson(JSON.stringify(v)));
    }
  }
  return m;
}

type ManifestCacheEntry = {
  mtimeMs: number;
  size: number;
  sourceAbs: string;
  map: Map<string, CaseMetadata>;
};

/**
 * 按目录绝对路径分桶的清单缓存：
 * - key 为 imageRoot 绝对路径 → 根清单（key 为完整相对路径）
 * - key 为 "absDir" → 子目录清单（key 为裸文件名）
 */
const manifestCacheByDir = new Map<string, ManifestCacheEntry>();

/** 测试集 image_root 变更时可调用；不传参则清空全部缓存 */
export function invalidateCaseMetadataManifestCache(imageRoot?: string): void {
  if (!imageRoot) {
    manifestCacheByDir.clear();
    return;
  }
  const absRoot = path.resolve(imageRoot);
  // 清除所有以 absRoot 开头的目录缓存
  for (const k of manifestCacheByDir.keys()) {
    if (k === absRoot || k.startsWith(absRoot + path.sep)) {
      manifestCacheByDir.delete(k);
    }
  }
}

function resolveManifestInDir(absDir: string): { abs: string; st: fs.Stats } | null {
  const primary = path.join(absDir, IMAGE_TESTER_MANIFEST);
  try {
    const st = fs.statSync(primary);
    if (st.isFile()) return { abs: primary, st };
  } catch {
    /* 无主清单 */
  }
  const legacy = path.join(absDir, LEGACY_METADATA_MANIFEST);
  try {
    const st = fs.statSync(legacy);
    if (st.isFile()) return { abs: legacy, st };
  } catch {
    /* 无备选 */
  }
  return null;
}

function manifestMapForDir(absDir: string): Map<string, CaseMetadata> {
  const resolved = resolveManifestInDir(absDir);
  if (!resolved) {
    manifestCacheByDir.delete(absDir);
    return new Map();
  }
  const { abs, st } = resolved;
  const cached = manifestCacheByDir.get(absDir);
  if (
    cached &&
    cached.sourceAbs === abs &&
    cached.mtimeMs === st.mtimeMs &&
    cached.size === st.size
  ) {
    return cached.map;
  }
  const map = parseManifestFile(abs);
  manifestCacheByDir.set(absDir, { mtimeMs: st.mtimeMs, size: st.size, sourceAbs: abs, map });
  return map;
}

/**
 * 合并元数据（用于导入写库与断言里的 caseVars）：
 * 1. 数据库里的 `variables_json` 作**基底**
 * 2. `image_root/` 根清单（key 为完整相对路径，如 `subdir/image.jpg`）**覆盖**同名键
 * 3. 图片所在子目录的清单（key 为裸文件名，如 `image.jpg`）**再覆盖**
 *    ——这样整文件夹上传后，子目录里的 metadata.json 也能被解析到
 * 4. 与主图同名的侧车 `.json`**最高优先**（sidecar > 子目录清单 > 根清单 > 库值）
 */
export function resolveMergedCaseMetadata(
  imageRoot: string,
  relativeImagePath: string,
  dbOrUiVariablesJson: string,
): CaseMetadata {
  const rel = posix(relativeImagePath).replace(/^\/+/, '');
  const absRoot = path.resolve(imageRoot);

  let merged = parseCaseMetadataJson(dbOrUiVariablesJson);

  // 1. 根清单：用完整相对路径匹配
  const rootManifest = manifestMapForDir(absRoot);
  const fromRoot = rootManifest.get(rel);
  if (fromRoot) {
    merged = mergeMeta(merged, fromRoot);
  }

  // 2. 子目录清单：用裸文件名匹配（便于整文件夹上传后自动读取）
  const relDir = path.posix.dirname(rel);
  if (relDir !== '.') {
    const absSubDir = path.join(absRoot, relDir);
    const subManifest = manifestMapForDir(absSubDir);
    const basename = path.posix.basename(rel);
    const fromSub = subManifest.get(basename);
    if (fromSub) {
      merged = mergeMeta(merged, fromSub);
    }
  }

  // 3. 侧车 JSON（最高优先级）
  const sideRel = sidecarRelativePathForImage(rel);
  try {
    const sideAbs = resolveUnderRoot(imageRoot, sideRel);
    const sideRaw = readUtf8Safe(sideAbs);
    if (sideRaw?.trim()) {
      merged = mergeMeta(merged, parseCaseMetadataJson(sideRaw));
    }
  } catch {
    /* 侧车路径非法则跳过 */
  }

  return merged;
}

export function resolveMergedMetadataJson(
  imageRoot: string,
  relativeImagePath: string,
  dbOrUiVariablesJson: string,
): string {
  return JSON.stringify(resolveMergedCaseMetadata(imageRoot, relativeImagePath, dbOrUiVariablesJson));
}
