import fs from 'node:fs';
import path from 'node:path';

function isSafeToRemoveDir(absDir: string): boolean {
  const resolved = path.resolve(absDir);
  const parent = path.dirname(resolved);
  // 防止误删根目录或空路径这类危险目标
  if (!resolved || resolved === parent) return false;
  return true;
}

/**
 * 删除测试集目录及其所有资产（图片、metadata 清单、侧车 JSON 等）。
 * 采用 best-effort：目录不存在时静默跳过。
 */
export function cleanupSuiteAssets(imageRoot: string): void {
  if (!isSafeToRemoveDir(imageRoot)) return;
  try {
    fs.rmSync(path.resolve(imageRoot), { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}
