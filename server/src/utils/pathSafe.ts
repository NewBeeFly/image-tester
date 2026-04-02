import path from 'node:path';

/**
 * 将 relative 解析为 root 下的绝对路径；禁止 `..` 跳出根目录。
 */
export function resolveUnderRoot(root: string, relative: string): string {
  const normalizedRel = relative.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalizedRel.includes('\0')) {
    throw new Error('路径包含非法字符');
  }
  const absRoot = path.resolve(root);
  const absTarget = path.resolve(absRoot, normalizedRel);
  const rootWithSep = absRoot.endsWith(path.sep) ? absRoot : `${absRoot}${path.sep}`;
  if (absTarget !== absRoot && !absTarget.startsWith(rootWithSep)) {
    throw new Error('路径不合法：不可越过图片根目录');
  }
  return absTarget;
}
