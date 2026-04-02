/**
 * 使用 {{key}} 占位符渲染模板；未提供的占位符保持原样。
 */
export function renderPromptTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) => {
    if (Object.prototype.hasOwnProperty.call(variables, key)) {
      return variables[key] ?? '';
    }
    return `{{${key}}}`;
  });
}

export function parseVariablesJson(raw: string): Record<string, string> {
  try {
    const v = JSON.parse(raw || '{}') as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = val == null ? '' : String(val);
    }
    return out;
  } catch {
    return {};
  }
}
