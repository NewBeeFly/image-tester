/**
 * 内置工具集：文件操作、bash 执行、技能加载、图片 base64 转换。
 * 所有 agent 默认可用，无需在 config.json 中声明。
 */
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import sharp from 'sharp';
import { config } from '../../config.js';

/** 安全路径检查：确保路径在项目根目录或测试集目录下 */
function safePath(p: string): string {
  const resolved = path.resolve(p);
  const root = config.rootDir;
  const suiteDir = config.testSuiteParentDir;
  if (!resolved.startsWith(root) && !resolved.startsWith(suiteDir)) {
    throw new Error(`路径 ${p} 不在允许范围内`);
  }
  return resolved;
}

// ---- 文件读取 ----
export const readFileTool = tool(
  async ({ file_path, start_line, end_line }) => {
    const abs = safePath(file_path);
    if (!fs.existsSync(abs)) return `文件不存在: ${file_path}`;
    const content = fs.readFileSync(abs, 'utf8');
    if (start_line != null || end_line != null) {
      const lines = content.split('\n');
      const start = (start_line ?? 1) - 1;
      const end = end_line ?? lines.length;
      return lines.slice(start, end).join('\n');
    }
    return content;
  },
  {
    name: 'read_file',
    description:
      '读取指定路径的文件内容。支持可选的行范围（start_line, end_line）来高效读取大文件的特定部分。',
    schema: z.object({
      file_path: z.string().describe('文件的绝对路径'),
      start_line: z.number().int().optional().describe('起始行号（1-based，可选）'),
      end_line: z.number().int().optional().describe('结束行号（1-based，可选）'),
    }),
  },
);

// ---- 文件写入 ----
export const writeFileTool = tool(
  async ({ file_path, content }) => {
    const abs = safePath(file_path);
    const dir = path.dirname(abs);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    return `已写入 ${file_path}（${content.length} 字节）`;
  },
  {
    name: 'write_file',
    description: '将内容写入指定路径的文件。如果目录不存在会自动创建。注意：会覆盖已有文件。',
    schema: z.object({
      file_path: z.string().describe('文件的绝对路径'),
      content: z.string().describe('要写入的文件内容'),
    }),
  },
);

// ---- 目录列表 ----
export const listDirectoryTool = tool(
  async ({ dir_path, recursive }) => {
    const abs = safePath(dir_path);
    if (!fs.existsSync(abs)) return `目录不存在: ${dir_path}`;

    const results: string[] = [];
    function walk(dir: string, prefix: string, depth: number) {
      if (depth > 3) return; // 最大深度 3
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          results.push(`${rel}/`);
          if (recursive) walk(path.join(dir, entry.name), rel, depth + 1);
        } else {
          results.push(rel);
        }
      }
    }
    walk(abs, '', 0);
    return results.join('\n') || '（空目录）';
  },
  {
    name: 'list_directory',
    description: '列出指定目录的内容。支持递归（最多 3 层）。返回文件和子目录的相对路径列表。',
    schema: z.object({
      dir_path: z.string().describe('目录的绝对路径'),
      recursive: z.boolean().optional().describe('是否递归列出子目录（默认 false）'),
    }),
  },
);

// ---- Bash 执行 ----
export const bashExecuteTool = tool(
  async ({ command }) => {
    return new Promise<string>((resolve) => {
      const timeout = config.customScriptTimeoutMs * 10 || 3000; // 默认 3 秒，最长 30 秒
      exec(
        command,
        { timeout: Math.min(timeout, 30000), cwd: config.rootDir },
        (error, stdout, stderr) => {
          if (error) {
            if (error.killed) return resolve(`命令超时（${timeout}ms）`);
            return resolve(`执行错误:\n${stderr || error.message}`);
          }
          resolve(stdout || '（无输出）');
        },
      );
    });
  },
  {
    name: 'bash_execute',
    description:
      '执行 shell 命令。作为其他专用工具的兜底方案使用。命令有超时保护（默认 3 秒）。适用于文件查找、文本处理、系统信息等场景。',
    schema: z.object({
      command: z.string().describe('要执行的 shell 命令'),
    }),
  },
);

/** 压缩图片为 base64 data URI：限制长边、质量，防止上下文爆炸 */
async function compressImageToBase64(file_path: string): Promise<{ base64: string; originalSize: number; compressedSize: number }> {
  const abs = safePath(file_path);
  if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${file_path}`);

  const originalBuffer = fs.readFileSync(abs);
  const originalSize = originalBuffer.length;

  // 限制长边 1024px，JPEG 质量 80%，sRGB 输出
  const compressedBuffer = await sharp(originalBuffer)
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80, progressive: true })
    .toBuffer();

  const base64 = compressedBuffer.toString('base64');
  return {
    base64: `data:image/jpeg;base64,${base64}`,
    originalSize,
    compressedSize: compressedBuffer.length,
  };
}

// ---- 图片 Base64 ----
export const loadImageBase64Tool = tool(
  async ({ file_path }) => {
    try {
      const { base64, originalSize, compressedSize } = await compressImageToBase64(file_path);
      return JSON.stringify({
        base64,
        original_size: originalSize,
        compressed_size: compressedSize,
        ratio: `${((compressedSize / originalSize) * 100).toFixed(1)}%`,
      }, null, 2);
    } catch (e) {
      return `错误: ${(e as Error).message}`;
    }
  },
  {
    name: 'load_image_base64',
    description:
      '将指定图片文件压缩后转换为 base64 data URI 格式，供视觉模型分析使用。支持 jpg/png/webp 格式。长边限制 1024px，JPEG 质量 80%。仅在需要"看"单张图片内容时使用。如需一次加载多张，请使用 load_images_base64。',
    schema: z.object({
      file_path: z.string().describe('图片文件的绝对路径'),
    }),
  },
);

// ---- 批量图片 Base64 ----
export const loadImagesBase64Tool = tool(
  async ({ file_paths }) => {
    const results: Array<{
      file_path: string;
      base64?: string;
      original_size?: number;
      compressed_size?: number;
      ratio?: string;
      error?: string;
    }> = [];
    for (const file_path of file_paths.slice(0, 5)) {
      try {
        const { base64, originalSize, compressedSize } = await compressImageToBase64(file_path);
        results.push({
          file_path,
          base64,
          original_size: originalSize,
          compressed_size: compressedSize,
          ratio: `${((compressedSize / originalSize) * 100).toFixed(1)}%`,
        });
      } catch (e) {
        results.push({ file_path, error: (e as Error).message });
      }
    }
    return JSON.stringify(results, null, 2);
  },
  {
    name: 'load_images_base64',
    description:
      '将多个图片文件批量压缩后转换为 base64 data URI 格式，供视觉模型分析使用。支持 jpg/png/webp 格式。每张长边限制 1024px，JPEG 质量 80%。一次最多 5 张，适合报告分析时一次性加载多张抽样图片。',
    schema: z.object({
      file_paths: z.array(z.string()).describe('图片文件的绝对路径列表（最多 5 张）'),
    }),
  },
);

/** 所有内置工具 */
export const builtinTools = [
  readFileTool,
  writeFileTool,
  listDirectoryTool,
  bashExecuteTool,
  loadImageBase64Tool,
  loadImagesBase64Tool,
];
