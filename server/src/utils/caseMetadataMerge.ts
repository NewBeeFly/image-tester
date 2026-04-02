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

/** 按 image_root 分桶；mtime+size 任一变化即重读清单，便于编辑磁盘 JSON 后热更新 */
const manifestCacheByRoot = new Map<string, ManifestCacheEntry>();

/** 测试集 image_root 变更时可调用；不传参则清空全部缓存 */
export function invalidateCaseMetadataManifestCache(imageRoot?: string): void {
  if (!imageRoot) {
    manifestCacheByRoot.clear();
    return;
  }
  manifestCacheByRoot.delete(path.resolve(imageRoot));
}

function resolveManifestFile(absRoot: string): { abs: string; st: fs.Stats } | null {
  const primary = path.join(absRoot, IMAGE_TESTER_MANIFEST);
  try {
    const st = fs.statSync(primary);
    if (st.isFile()) return { abs: primary, st };
  } catch {
    /* 无主清单 */
  }
  const legacy = path.join(absRoot, LEGACY_METADATA_MANIFEST);
  try {
    const st = fs.statSync(legacy);
    if (st.isFile()) return { abs: legacy, st };
  } catch {
    /* 无备选 */
  }
  return null;
}

function manifestMapForRoot(imageRoot: string): Map<string, CaseMetadata> {
  const absRoot = path.resolve(imageRoot);
  const resolved = resolveManifestFile(absRoot);
  if (!resolved) {
    manifestCacheByRoot.delete(absRoot);
    return new Map();
  }
  const { abs, st } = resolved;
  const cached = manifestCacheByRoot.get(absRoot);
  if (
    cached &&
    cached.sourceAbs === abs &&
    cached.mtimeMs === st.mtimeMs &&
    cached.size === st.size
  ) {
    return cached.map;
  }
  const map = parseManifestFile(abs);
  manifestCacheByRoot.set(absRoot, { mtimeMs: st.mtimeMs, size: st.size, sourceAbs: abs, map });
  return map;
}

/**
 * 合并元数据（用于请求与断言里的 caseVars）——**磁盘 JSON 优先**：
 * 1. 数据库 / 单图页 `variables_json`（或预览 `metadata_json`）作**基底**（可填 `{}`，变量全由文件提供）
 * 2. `image_root/image-tester-metadata.json`（若不存在则尝试同目录下的 `metadata.json`）中该主图**相对路径**键对应的条目**覆盖**同名键
 * 3. 与主图同名的侧车 `.json`**再覆盖**（侧车 > 清单 > 库/表单）
 *
 * 侧车每次请求现读；清单在 `mtime` 或 `size` 变化时自动重读，编辑保存后下一轮请求即生效。
 */
export function resolveMergedCaseMetadata(
  imageRoot: string,
  relativeImagePath: string,
  dbOrUiVariablesJson: string,
): CaseMetadata {
  const rel = posix(relativeImagePath).replace(/^\/+/, '');

  let merged = parseCaseMetadataJson(dbOrUiVariablesJson);

  const fromManifest = manifestMapForRoot(imageRoot).get(rel);
  if (fromManifest) {
    merged = mergeMeta(merged, fromManifest);
  }

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
