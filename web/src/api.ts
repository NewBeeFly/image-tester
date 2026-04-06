const jsonHeaders = { 'Content-Type': 'application/json' };

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      const j = JSON.parse(text) as { error?: string; message?: string };
      // Fastify 404 常为 { error: "Not Found", message: "Route GET:..." }，带上 message 才好排查
      if (j.message && (j.error === 'Not Found' || res.status === 404)) msg = `${j.message}${j.error ? ` (${j.error})` : ''}`;
      else if (j.error) msg = j.error;
      else if (j.message) msg = j.message;
    } catch {
      /* ignore */
    }
    const short = (msg || res.statusText).slice(0, 500);
    if (res.status === 404) {
      throw new Error(
        `${short} — 多为后端未启动、端口不是 8787，或 server 代码过旧未包含该路由；请在 server 目录执行 npm run dev 并拉齐本仓库代码后重试。`,
      );
    }
    throw new Error(short);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function getJson<T>(path: string): Promise<T> {
  return handle<T>(await fetch(path));
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  return handle<T>(
    await fetch(path, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }),
  );
}

export async function patchJson<T>(path: string, body: unknown): Promise<T> {
  return handle<T>(
    await fetch(path, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify(body) }),
  );
}

export async function delJson<T>(path: string): Promise<T> {
  return handle<T>(await fetch(path, { method: 'DELETE' }));
}

/** multipart/form-data（不要手动设置 Content-Type，浏览器会带 boundary） */
export async function postFormData<T>(path: string, body: FormData): Promise<T> {
  return handle<T>(await fetch(path, { method: 'POST', body }));
}

export type ProviderType = 'openai_compatible' | 'dashscope' | 'volcengine';

export interface ProviderProfile {
  id: number;
  name: string;
  provider_type: ProviderType;
  base_url: string;
  api_key_env: string;
  default_model: string;
  default_params_json: string;
  created_at: string;
}

export interface PromptProfile {
  id: number;
  name: string;
  system_prompt: string;
  user_prompt_template: string;
  notes: string;
  created_at: string;
}

export interface TestSuite {
  id: number;
  name: string;
  image_root: string;
  default_assertions_json: string;
  created_at: string;
}

/** GET /api/config */
export interface AppConfig {
  suite_parent_dir: string;
}

export interface TestCase {
  id: number;
  suite_id: number;
  relative_image_path: string;
  variables_json: string;
  assertions_override_json: string | null;
  sort_order: number;
  created_at: string;
}

export interface TestRun {
  id: number;
  suite_id: number;
  provider_profile_id: number;
  prompt_profile_id: number;
  model_override: string | null;
  params_override_json: string | null;
  concurrency: number;
  status: string;
  total_count: number;
  pass_count: number;
  fail_count: number;
  error_count: number;
  current_index: number;
  started_at: string | null;
  finished_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface TestRunItem {
  id: number;
  run_id: number;
  case_id: number;
  status: string;
  model_output: string | null;
  raw_response_json: string | null;
  assertion_details_json: string | null;
  pass: number | null;
  duration_ms: number | null;
  error_message: string | null;
  created_at: string;
}

export interface RunItemDetail extends TestRunItem {
  relative_image_path: string;
  suite_id: number;
}

export function imageUrl(suiteId: number, relativePath: string): string {
  const q = new URLSearchParams({ relative_path: relativePath });
  return `/api/test-suites/${suiteId}/image?${q.toString()}`;
}
