import fs from 'node:fs';
import path from 'node:path';
import { isAllowedImageFilename } from './scanService.js';
import { resolveUnderRoot } from '../utils/pathSafe.js';
import { IMAGE_TESTER_MANIFEST, LEGACY_METADATA_MANIFEST } from '../utils/caseMetadataMerge.js';

export type UploadedAsset = { relative_path: string; bytes: number };
export type UploadAssetError = { filename: string; message: string };

/** 相对 image_root 的子目录前缀，禁止 .. 与空段 */
export function normalizeUploadSubdir(raw: string): string {
  const s = raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!s) return '';
  if (s.includes('..') || s.includes('\0')) {
    throw new Error('子目录不可包含 .. 或非法字符');
  }
  const segments = s.split('/').filter(Boolean);
  for (const seg of segments) {
    if (seg === '.' || seg === '..') {
      throw new Error('子目录不合法');
    }
  }
  return segments.join('/');
}

/**
 * multipart 里原始文件名可能是 `a.png` 或 `子目录/a.png`（文件夹上传 webkitRelativePath）。
 * 与 optionalSubdir 拼接：optional/子目录/a.png
 */
export function resolveUploadRelativePath(optionalSubdir: string, originalFilename: string): string {
  const sub = normalizeUploadSubdir(optionalSubdir);
  const raw = originalFilename.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!raw || raw.includes('\0')) {
    throw new Error('路径无效');
  }
  const segments = raw.split('/').filter(Boolean);
  for (const seg of segments) {
    if (seg === '..' || seg === '.') {
      throw new Error('路径包含非法段');
    }
  }
  if (!segments.length) {
    throw new Error('路径为空');
  }
  const nested = segments.join('/');
  if (sub) return `${sub}/${nested}`;
  return nested;
}

function isJsonFilename(name: string): boolean {
  return path.extname(name).toLowerCase() === '.json';
}

function tryParseObjectJson(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('JSON 内容无法解析');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON 顶层必须是对象');
  }
  return parsed as Record<string, unknown>;
}

function isManifestFilename(base: string): boolean {
  const lower = base.toLowerCase();
  return lower === IMAGE_TESTER_MANIFEST || lower === LEGACY_METADATA_MANIFEST;
}

function mergeManifestJsonIfNeeded(abs: string, base: string, incomingObj: Record<string, unknown>): Buffer {
  if (!isManifestFilename(base) || !fs.existsSync(abs)) {
    return Buffer.from(`${JSON.stringify(incomingObj, null, 2)}\n`, 'utf8');
  }
  const oldRaw = fs.readFileSync(abs, 'utf8');
  const oldObj = tryParseObjectJson(oldRaw);
  const merged = { ...oldObj, ...incomingObj };
  return Buffer.from(`${JSON.stringify(merged, null, 2)}\n`, 'utf8');
}

/**
 * 将文件写入测试集 image_root 下；支持单层或多层相对路径（文件夹上传）。
 * 图片仅允许常见后缀；JSON 须为合法 UTF-8 且可 JSON.parse。
 */
export function writeSuiteAsset(
  imageRoot: string,
  optionalSubdir: string,
  originalFilename: string,
  data: Buffer,
): UploadedAsset {
  const relative = resolveUploadRelativePath(optionalSubdir, originalFilename);
  const base = path.posix.basename(relative.replace(/\\/g, '/'));

  if (isAllowedImageFilename(base)) {
    const abs = resolveUnderRoot(imageRoot, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, data);
    return { relative_path: relative.replace(/\\/g, '/'), bytes: data.length };
  }

  if (isJsonFilename(base)) {
    const abs = resolveUnderRoot(imageRoot, relative);
    const text = data.toString('utf8');
    const incomingObj = tryParseObjectJson(text);
    const out = mergeManifestJsonIfNeeded(abs, base.toLowerCase(), incomingObj);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, out);
    return { relative_path: relative.replace(/\\/g, '/'), bytes: out.length };
  }

  throw new Error('仅支持图片（png/jpg/jpeg/webp/gif/bmp）或 .json 文件');
}
