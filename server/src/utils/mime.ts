import path from 'node:path';

const map: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
};

export function mimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return map[ext] ?? 'application/octet-stream';
}
