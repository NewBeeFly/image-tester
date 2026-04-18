import type { OutputFieldSchema, OutputSchema, OutputFieldType } from '../model/types.js';

const DEFAULT_INSTRUCTION =
  '请严格按下面的 JSON 结构返回一个纯 JSON 对象，不要输出任何额外文字、代码块围栏或解释。';

const FIELD_TYPES: ReadonlySet<OutputFieldType> = new Set([
  'string',
  'number',
  'boolean',
  'array',
  'object',
  'enum',
]);

/**
 * 宽容解析：容错性的 JSON 解析，允许空串/缺字段；
 * 任何非法结构都降级为空 schema，避免阻塞主流程。
 */
export function parseOutputSchema(raw: string | null | undefined): OutputSchema {
  if (!raw || !raw.trim()) return { fields: [] };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { fields: [] };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { fields: [] };
  const o = data as Record<string, unknown>;
  const fields: OutputFieldSchema[] = [];
  if (Array.isArray(o.fields)) {
    for (const raw of o.fields as unknown[]) {
      if (!raw || typeof raw !== 'object') continue;
      const f = raw as Record<string, unknown>;
      const name = typeof f.name === 'string' ? f.name.trim() : '';
      if (!name) continue;
      const typeRaw = typeof f.type === 'string' ? f.type : 'string';
      const type: OutputFieldType = FIELD_TYPES.has(typeRaw as OutputFieldType)
        ? (typeRaw as OutputFieldType)
        : 'string';
      const field: OutputFieldSchema = { name, type };
      if (f.required === true) field.required = true;
      if (typeof f.description === 'string' && f.description.trim()) {
        field.description = f.description.trim();
      }
      if (type === 'enum' && Array.isArray(f.enum)) {
        const items = (f.enum as unknown[]).map((x) => String(x ?? '')).filter((s) => s.length > 0);
        if (items.length > 0) field.enum = items;
      }
      fields.push(field);
    }
  }
  const instruction = typeof o.instruction === 'string' ? o.instruction.trim() : '';
  return instruction ? { fields, instruction } : { fields };
}

function fieldTypeLabel(field: OutputFieldSchema): string {
  if (field.type === 'enum') {
    const items = (field.enum ?? []).slice(0, 20).map((s) => JSON.stringify(s));
    return items.length ? `enum(${items.join(' | ')})` : 'enum';
  }
  return field.type;
}

function fieldSampleValue(field: OutputFieldSchema): unknown {
  switch (field.type) {
    case 'string':
      return field.description ? `<${field.description}>` : `<${field.name}>`;
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    case 'enum': {
      const first = (field.enum ?? [])[0];
      return first ?? '';
    }
  }
}

/**
 * 将结构化 Schema 渲染成给模型看的提示片段：
 * 1. 一段中文 instruction
 * 2. 字段清单（名/类型/必填/说明）
 * 3. 一个示例 JSON（便于模型照猫画虎）
 *
 * 若 `fields` 为空返回空串，由调用者决定是否跳过拼接。
 */
export function renderSchemaPrompt(schema: OutputSchema): string {
  if (!schema.fields.length) return '';
  const lines: string[] = [];
  lines.push(schema.instruction?.trim() || DEFAULT_INSTRUCTION);
  lines.push('');
  lines.push('字段清单：');
  for (const f of schema.fields) {
    const required = f.required ? '必填' : '可选';
    const desc = f.description ? ` — ${f.description}` : '';
    lines.push(`- ${f.name}: ${fieldTypeLabel(f)}（${required}）${desc}`);
  }
  const sample: Record<string, unknown> = {};
  for (const f of schema.fields) sample[f.name] = fieldSampleValue(f);
  lines.push('');
  lines.push('示例：');
  lines.push('```json');
  lines.push(JSON.stringify(sample, null, 2));
  lines.push('```');
  return lines.join('\n');
}

const SCHEMA_PLACEHOLDER = /\{\{\s*schema\s*\}\}/g;

/**
 * 在系统提示词中拼接 Schema 描述：
 * - 若模板中出现 `{{schema}}` → 就地替换（可多次），方便用户精确控制位置；
 * - 否则若模板中没出现 → 追加到末尾（空行分隔）；
 * - schema 为空时原样返回。
 */
export function applySchemaToSystemPrompt(systemPrompt: string, outputSchemaJson: string): string {
  const schema = parseOutputSchema(outputSchemaJson);
  const block = renderSchemaPrompt(schema);
  if (!block) return systemPrompt ?? '';
  const base = systemPrompt ?? '';
  if (SCHEMA_PLACEHOLDER.test(base)) {
    SCHEMA_PLACEHOLDER.lastIndex = 0;
    return base.replace(SCHEMA_PLACEHOLDER, block);
  }
  SCHEMA_PLACEHOLDER.lastIndex = 0;
  if (!base.trim()) return block;
  return `${base.trimEnd()}\n\n${block}`;
}
