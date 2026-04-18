/**
 * 「可视化 ↔ JSON 原文」相关的共享类型与工具。
 *
 * 设计原则：
 * - 每个可视化编辑器的唯一事实源（source of truth）是一份 JSON 字符串。
 *   外部父组件只需要拿到合法的 JSON 即可保存落库，不关心内部用什么 UI。
 * - 切到 JSON 原文时允许任意文本；切回可视化时若 JSON 非法，仍允许编辑
 *   但会显示错误提示，避免用户改坏后不可恢复。
 */

export type EditorMode = 'visual' | 'json'

/** 从文本解析 JSON，失败返回 `{ error, raw }` 便于上层显示红字 */
export function safeParseJson<T = unknown>(raw: string): { ok: true; value: T } | { ok: false; error: string } {
  const t = (raw ?? '').trim()
  if (!t) return { ok: true, value: {} as T }
  try {
    return { ok: true, value: JSON.parse(t) as T }
  } catch (e) {
    return { ok: false, error: (e as Error).message || 'JSON 解析失败' }
  }
}

export function prettifyJson(raw: string): string {
  const r = safeParseJson(raw)
  if (!r.ok) return raw
  try {
    return JSON.stringify(r.value, null, 2)
  } catch {
    return raw
  }
}

/** 测试集全局变量（与用例 variables 合并规则相同的扁平键值对） */
export type SuiteVariables = Record<string, string>

export function parseSuiteVariables(raw: string): SuiteVariables {
  const r = safeParseJson<Record<string, unknown>>(raw)
  if (!r.ok || !r.value || typeof r.value !== 'object' || Array.isArray(r.value)) return {}
  const out: SuiteVariables = {}
  for (const [k, v] of Object.entries(r.value)) {
    if (v == null) continue
    if (typeof v === 'object') continue
    out[k] = String(v)
  }
  return out
}
