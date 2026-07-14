/**
 * 构建后把 src/agents 下的非 TS 资源（config.json、*.md、skills）复制到 dist/agents。
 * tsc 只编译 .ts，不会复制这些运行时必需的静态文件。
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const srcDir = path.join(root, 'src', 'agents');
const distDir = path.join(root, 'dist', 'agents');

function copy(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copy(path.join(src, name), path.join(dest, name));
    }
  } else if (/\.(md|json)$/.test(src)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`[copy-agent-assets] ${path.relative(root, src)} -> ${path.relative(root, dest)}`);
  }
}

if (!fs.existsSync(srcDir)) {
  console.error(`[copy-agent-assets] source not found: ${srcDir}`);
  process.exit(1);
}

copy(srcDir, distDir);
console.log('[copy-agent-assets] done');
