import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveUnderRoot } from '../utils/pathSafe.js';

/** 与上传、扫描一致的图片扩展名（小写，含点） */
export const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);

export function isAllowedImageFilename(name: string): boolean {
  return IMAGE_EXT.has(path.extname(name).toLowerCase());
}

export async function scanImagesUnderSuiteRoot(
  imageRoot: string,
  relativeDir = '',
  opts?: { maxFiles?: number; maxDepth?: number },
): Promise<string[]> {
  const maxFiles = opts?.maxFiles ?? 500;
  const maxDepth = opts?.maxDepth ?? 8;
  const base = resolveUnderRoot(imageRoot, relativeDir);
  const out: string[] = [];

  async function walk(dirAbs: string, rel: string, depth: number) {
    if (out.length >= maxFiles || depth > maxDepth) return;
    const entries = await fs.readdir(dirAbs, { withFileTypes: true });
    for (const ent of entries) {
      if (out.length >= maxFiles) return;
      const name = ent.name;
      if (name.startsWith('.')) continue;
      const childAbs = path.join(dirAbs, name);
      const childRel = rel ? `${rel}/${name}` : name;
      if (ent.isDirectory()) {
        await walk(childAbs, childRel, depth + 1);
      } else if (ent.isFile()) {
        const ext = path.extname(name).toLowerCase();
        if (IMAGE_EXT.has(ext)) {
          out.push(childRel.replace(/\\/g, '/'));
        }
      }
    }
  }

  await walk(base, relativeDir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''), 0);
  return out;
}
