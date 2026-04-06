import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const rootDir = path.resolve(__dirname, '../..');

export const config = {
  port: Number(process.env.PORT ?? 8787),
  /** 默认仅本机；内网其他设备访问请设置 HOST=0.0.0.0（启动时会枚举网卡） */
  host: process.env.HOST ?? '127.0.0.1',
  /**
   * 托管模式新建测试集时，图片根目录 = 本目录 + 子目录名。
   * 可设相对路径（相对进程 cwd）或绝对路径；未设置时默认项目下 data/test-suites。
   */
  testSuiteParentDir: process.env.IMAGE_TESTER_SUITE_ROOT
    ? path.resolve(process.cwd(), process.env.IMAGE_TESTER_SUITE_ROOT)
    : path.resolve(rootDir, 'data/test-suites'),
  sqlitePath: process.env.SQLITE_PATH
    ? path.resolve(process.cwd(), process.env.SQLITE_PATH)
    : path.resolve(__dirname, '../data/app.db'),
  rootDir,
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  customScriptTimeoutMs: Number(process.env.CUSTOM_SCRIPT_TIMEOUT_MS ?? 300),
  maxRegexPatternLength: Number(process.env.MAX_REGEX_PATTERN_LENGTH ?? 500),
};
