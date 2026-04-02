import fs from 'node:fs/promises';
import type { VisionContentPart } from '../model/types.js';
import { mimeFromPath } from './mime.js';
import { resolveUnderRoot } from './pathSafe.js';

export type { VisionContentPart };

/** 用例元数据：文本变量 + 多图别名（相对 image_root 的路径） */
export interface CaseMetadata {
  variables: Record<string, string>;
  images: Record<string, string>;
}

/**
 * 解析 variables_json：
 * - 新格式：`{ "variables": { "k": "v" }, "images": { "main": "a.jpg" } }`
 * - 旧格式：扁平 `{ "hint": "x" }` → 全部视为 variables，images 为空
 */
export function parseCaseMetadataJson(raw: string): CaseMetadata {
  try {
    const v = JSON.parse(raw || '{}') as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      return { variables: {}, images: {} };
    }
    const o = v as Record<string, unknown>;
    if ('variables' in o || 'images' in o) {
      return {
        variables: toStringRecord(o.variables),
        images: toStringRecord(o.images),
      };
    }
    const variables: Record<string, string> = {};
    for (const [k, val] of Object.entries(o)) {
      variables[k] = val == null ? '' : String(val);
    }
    return { variables, images: {} };
  } catch {
    return { variables: {}, images: {} };
  }
}

function toStringRecord(x: unknown): Record<string, string> {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(x as Record<string, unknown>)) {
    out[k] = val == null ? '' : String(val);
  }
  return out;
}

const IMG_PH = /\{\{\s*img:([\w.-]+)\s*\}\}/g;
const VAR_EXPLICIT = /\{\{\s*var:([\w.-]+)\s*\}\}/g;
const VAR_LEGACY = /\{\{\s*([\w.-]+)\s*\}\}/g;

/**
 * 仅替换文本占位符：`{{var:key}}` 优先，其次 `{{key}}`（不与 img: 冲突）
 */
export function renderTextPlaceholders(template: string, variables: Record<string, string>): string {
  let s = template.replace(VAR_EXPLICIT, (_, key: string) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] ?? '' : `{{var:${key}}}`,
  );
  s = s.replace(VAR_LEGACY, (full, key: string) => {
    if (key.startsWith('img:')) return full;
    if (Object.prototype.hasOwnProperty.call(variables, key)) {
      return variables[key] ?? '';
    }
    return full;
  });
  return s;
}

async function loadImagePart(
  imageRoot: string,
  relativePath: string,
): Promise<VisionContentPart> {
  const abs = resolveUnderRoot(imageRoot, relativePath);
  const buf = await fs.readFile(abs);
  const b64 = buf.toString('base64');
  const mime = mimeFromPath(abs);
  const url = `data:${mime};base64,${b64}`;
  return { type: 'image_url', image_url: { url } };
}

function mergeAdjacentTextParts(parts: VisionContentPart[]): VisionContentPart[] {
  const out: VisionContentPart[] = [];
  for (const p of parts) {
    if (p.type === 'text' && out.length > 0 && out[out.length - 1]!.type === 'text') {
      const prev = out[out.length - 1] as { type: 'text'; text: string };
      prev.text += p.text;
    } else {
      out.push({ ...p });
    }
  }
  return out.filter((p) => (p.type === 'text' ? p.text.length > 0 : true));
}

/**
 * 将模板拆成 OpenAI 多模态 content 数组。
 * - `{{img:别名}}` 插入对应 metadata.images[别名] 的图片（转 data URL）
 * - 若模板中**没有**任何 `{{img:}}`，且提供 fallbackRelative，则在文本后追加一张图（兼容旧版「单图用例」）
 */
export async function templateToContentParts(
  template: string,
  meta: CaseMetadata,
  imageRoot: string,
  options?: { fallbackRelative?: string },
): Promise<VisionContentPart[]> {
  const hasPlaceholder = IMG_PH.test(template);
  IMG_PH.lastIndex = 0;

  if (!hasPlaceholder) {
    const text = renderTextPlaceholders(template, meta.variables);
    const parts: VisionContentPart[] = [];
    if (text.trim()) {
      parts.push({ type: 'text', text });
    }
    const rel = options?.fallbackRelative;
    if (rel) {
      parts.push(await loadImagePart(imageRoot, rel));
    }
    if (parts.length === 0) {
      throw new Error('提示词模板为空且未提供图片');
    }
    return parts;
  }

  const parts: VisionContentPart[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = /\{\{\s*img:([\w.-]+)\s*\}\}/g;
  while ((m = re.exec(template)) !== null) {
    const before = template.slice(last, m.index);
    if (before) {
      parts.push({ type: 'text', text: renderTextPlaceholders(before, meta.variables) });
    }
    const alias = m[1];
    const relPath = meta.images[alias];
    if (!relPath?.trim()) {
      throw new Error(`元数据 images 中缺少别名「${alias}」的路径`);
    }
    parts.push(await loadImagePart(imageRoot, relPath.trim()));
    last = m.index + m[0].length;
  }
  const tail = template.slice(last);
  if (tail) {
    parts.push({ type: 'text', text: renderTextPlaceholders(tail, meta.variables) });
  }
  return mergeAdjacentTextParts(parts);
}

/** system / user 单一角色：若只有一段纯文本则返回 string，否则返回 parts 数组 */
export function normalizeRoleContent(parts: VisionContentPart[]): string | VisionContentPart[] {
  if (parts.length === 1 && parts[0].type === 'text') {
    return parts[0].text;
  }
  return parts;
}

/** 从提示词模板 + 用例元数据组装 system/user 消息；user 中至少含一张图 */
export async function buildVisionRequestParts(
  systemTemplate: string,
  userTemplate: string,
  metadataJson: string,
  imageRoot: string,
  fallbackRelative: string,
): Promise<{
  system: string | VisionContentPart[];
  user: VisionContentPart[];
  variables: Record<string, string>;
}> {
  const meta = parseCaseMetadataJson(metadataJson);
  const systemContent = !systemTemplate.trim()
    ? ''
    : normalizeRoleContent(await templateToContentParts(systemTemplate, meta, imageRoot));
  const userParts = await templateToContentParts(userTemplate, meta, imageRoot, {
    fallbackRelative,
  });
  if (!userParts.some((p) => p.type === 'image_url')) {
    throw new Error(
      '用户提示词中未包含任何图片：请在模板中使用 {{img:别名}}（并在元数据 images 中配置路径），或保持无 {{img:}} 以自动附加本用例主图',
    );
  }
  return { system: systemContent, user: userParts, variables: meta.variables };
}
