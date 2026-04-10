import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const rootDir = path.resolve(__dirname, '../..');

const DEFAULT_SUITE_PARENT_REL = 'data/test-suites';

/** 项目根目录下的 image-tester.config.json（或通过 IMAGE_TESTER_CONFIG 指定路径） */
function resolveConfigFilePath(): string {
  const raw = process.env.IMAGE_TESTER_CONFIG?.trim();
  if (raw) {
    return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  }
  return path.resolve(rootDir, 'image-tester.config.json');
}

type JsonSuiteField = { suiteParentDir?: unknown; suite_parent_dir?: unknown };

function readSuiteParentFromConfigFile(): string | null {
  const configPath = resolveConfigFilePath();
  if (!fs.existsSync(configPath)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as unknown;
  } catch (e) {
    console.warn(
      `[image-tester] 无法解析配置文件 ${configPath}：${(e as Error).message}，将忽略其中的 suiteParentDir`,
    );
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const j = parsed as JsonSuiteField;
  const raw = j.suiteParentDir ?? j.suite_parent_dir;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const s = raw.trim();
  /** 配置文件内路径相对「项目根」（与默认 data/test-suites 一致），绝对路径则原样使用 */
  return path.isAbsolute(s) ? path.normalize(s) : path.resolve(rootDir, s);
}

const suiteParentFromEnv = process.env.IMAGE_TESTER_SUITE_ROOT?.trim()
  ? path.resolve(process.cwd(), process.env.IMAGE_TESTER_SUITE_ROOT)
  : null;
const suiteParentFromFile = readSuiteParentFromConfigFile();
const testSuiteParentDirResolved =
  suiteParentFromEnv ?? suiteParentFromFile ?? path.resolve(rootDir, DEFAULT_SUITE_PARENT_REL);

export const config = {
  port: Number(process.env.PORT ?? 8787),
  /** 默认仅本机；内网其他设备访问请设置 HOST=0.0.0.0（启动时会枚举网卡） */
  host: process.env.HOST ?? '127.0.0.1',
  /**
   * 托管模式新建测试集时，图片根目录 = 本目录 + 子目录名。
   * 优先级：环境变量 IMAGE_TESTER_SUITE_ROOT > 项目根 image-tester.config.json（或 IMAGE_TESTER_CONFIG）中的 suiteParentDir > 默认项目下 data/test-suites。
   */
  testSuiteParentDir: testSuiteParentDirResolved,
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
