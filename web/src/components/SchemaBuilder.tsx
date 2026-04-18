import { useEffect, useMemo, useRef, useState } from 'react'
import type { EditorMode } from './common'
import { prettifyJson, safeParseJson } from './common'
import { ModeTabs } from './ModeTabs'

/**
 * 提示词模板的「返回值 Schema」可视化编辑器。
 *
 * 数据形态（与后端 `OutputSchema` 对应）：
 * ```json
 * {
 *   "instruction": "只输出 JSON，不要解释",
 *   "fields": [
 *     { "name": "storeName", "type": "string", "required": true, "description": "门店名称" },
 *     { "name": "category",  "type": "enum", "enum": ["餐饮","零售"], "required": true }
 *   ]
 * }
 * ```
 *
 * 设计要点：
 * - 可视化里每一行都用**稳定 id** 作为 React key。避免新增一个空字段后立刻被过滤掉消失。
 * - 编辑时 `doc` 里允许空 name 字段（草稿），序列化到外部时才过滤掉空 name。
 * - 提供「最终系统提示预览」选项：拼上当前系统提示词，展示运行时真正会发给模型的样子。
 */

type FieldType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'enum'

interface SchemaField {
  /** 稳定的前端 id，仅用于 React key，不会被保存 */
  id: string
  name: string
  type: FieldType
  required?: boolean
  description?: string
  enum?: string[]
}

interface SchemaDoc {
  fields: SchemaField[]
  instruction?: string
}

let idSeed = 0
function makeId() {
  idSeed += 1
  return `f${idSeed}`
}

const TYPE_OPTIONS: Array<{ id: FieldType; label: string }> = [
  { id: 'string', label: '文本 string' },
  { id: 'number', label: '数字 number' },
  { id: 'boolean', label: '布尔 boolean' },
  { id: 'enum', label: '枚举 enum' },
  { id: 'array', label: '数组 array' },
  { id: 'object', label: '对象 object' },
]

function parseDoc(raw: string): SchemaDoc {
  const r = safeParseJson<Record<string, unknown>>(raw)
  if (!r.ok || !r.value || typeof r.value !== 'object' || Array.isArray(r.value)) {
    return { fields: [] }
  }
  const o = r.value as Record<string, unknown>
  const fields: SchemaField[] = []
  if (Array.isArray(o.fields)) {
    for (const raw of o.fields as unknown[]) {
      if (!raw || typeof raw !== 'object') continue
      const f = raw as Record<string, unknown>
      const typeStr = typeof f.type === 'string' ? f.type : 'string'
      const type: FieldType = (TYPE_OPTIONS.some((t) => t.id === typeStr)
        ? typeStr
        : 'string') as FieldType
      const field: SchemaField = {
        id: makeId(),
        name: typeof f.name === 'string' ? f.name : '',
        type,
      }
      if (f.required === true) field.required = true
      if (typeof f.description === 'string') field.description = f.description
      if (type === 'enum' && Array.isArray(f.enum)) {
        field.enum = (f.enum as unknown[]).map((x) => String(x ?? ''))
      }
      fields.push(field)
    }
  }
  const instruction = typeof o.instruction === 'string' ? o.instruction : ''
  return instruction ? { fields, instruction } : { fields }
}

function docToJson(doc: SchemaDoc): string {
  const fields: Array<Record<string, unknown>> = []
  for (const f of doc.fields) {
    const name = f.name.trim()
    if (!name) continue
    const out: Record<string, unknown> = { name, type: f.type }
    if (f.required) out.required = true
    if (f.description && f.description.trim()) out.description = f.description.trim()
    if (f.type === 'enum' && f.enum && f.enum.length) {
      const items = f.enum.map((s) => s.trim()).filter(Boolean)
      if (items.length) out.enum = items
    }
    fields.push(out)
  }
  const payload: { fields: unknown[]; instruction?: string } = { fields }
  if (doc.instruction && doc.instruction.trim()) payload.instruction = doc.instruction.trim()
  return JSON.stringify(payload, null, 2)
}

export function SchemaBuilder(props: {
  value: string
  onChange: (next: string) => void
  /** 可选：系统提示词，用于「最终系统提示预览」 */
  systemPrompt?: string
}) {
  const { value, onChange, systemPrompt } = props
  const [mode, setMode] = useState<EditorMode>('visual')
  const [doc, setDoc] = useState<SchemaDoc>(() => parseDoc(value || '{"fields":[]}'))
  const [rawJson, setRawJson] = useState(value || '{"fields":[]}')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [showFinalPreview, setShowFinalPreview] = useState(false)

  const lastEmittedRef = useRef(value || '{"fields":[]}')

  useEffect(() => {
    const incoming = value || '{"fields":[]}'
    if (incoming === lastEmittedRef.current) return
    lastEmittedRef.current = incoming
    setDoc(parseDoc(incoming))
    setRawJson(incoming)
    setJsonError(null)
  }, [value])

  function emit(nextDoc: SchemaDoc) {
    const s = docToJson(nextDoc)
    setDoc(nextDoc)
    setRawJson(s)
    setJsonError(null)
    lastEmittedRef.current = s
    onChange(s)
  }

  function updateField(id: string, patch: Partial<SchemaField>) {
    emit({
      ...doc,
      fields: doc.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    })
  }
  function addField() {
    emit({
      ...doc,
      fields: [...doc.fields, { id: makeId(), name: '', type: 'string' }],
    })
  }
  function removeField(id: string) {
    emit({ ...doc, fields: doc.fields.filter((f) => f.id !== id) })
  }
  function updateInstruction(v: string) {
    emit({ ...doc, instruction: v })
  }

  function onJsonChange(t: string) {
    setRawJson(t)
    const r = safeParseJson(t)
    if (!r.ok) {
      setJsonError(r.error)
      return
    }
    setJsonError(null)
    setDoc(parseDoc(t))
    lastEmittedRef.current = t
    onChange(t)
  }

  function handlePrettify() {
    const p = prettifyJson(rawJson)
    setRawJson(p)
    setJsonError(null)
    setDoc(parseDoc(p))
    lastEmittedRef.current = p
    onChange(p)
  }

  const previewBlock = useMemo(() => renderSchemaPreview(doc), [doc])
  const hasFields = doc.fields.length > 0
  const finalPreview = useMemo(
    () => applySchemaToSystemPromptPreview(systemPrompt ?? '', previewBlock),
    [systemPrompt, previewBlock],
  )

  return (
    <div className="sb">
      <ModeTabs
        mode={mode}
        onChange={setMode}
        onPrettify={handlePrettify}
        jsonError={jsonError}
        leftHint="定义模型应返回的 JSON 字段；运行时会自动拼入系统提示"
      />
      {mode === 'json' ? (
        <textarea
          className="modalTextarea"
          value={rawJson}
          onChange={(e) => onJsonChange(e.target.value)}
          spellCheck={false}
        />
      ) : (
        <div className="sbVisual">
          <div className="sbInstruction">
            <label className="muted" style={{ fontSize: 12 }}>
              附加中文说明（可选，默认会提示"请严格按下面 JSON 结构返回"）
            </label>
            <input
              className="sbInstructionInput"
              value={doc.instruction ?? ''}
              placeholder="例如：只输出 JSON，不要包裹代码块"
              onChange={(e) => updateInstruction(e.target.value)}
            />
          </div>

          <div className="sbFieldsHeader">
            <strong>字段列表</strong>
            <button type="button" className="btn btnGhost" onClick={addField}>
              + 新增字段
            </button>
          </div>
          {!hasFields ? (
            <p className="muted" style={{ fontSize: 12 }}>
              暂无字段。点「+ 新增字段」开始，例如 <code>storeName</code> / <code>category</code>。
            </p>
          ) : (
            <div className="sbFields">
              {doc.fields.map((f) => (
                <div className="sbField" key={f.id}>
                  <input
                    className="sbFieldName"
                    value={f.name}
                    placeholder="字段名，如 storeName"
                    onChange={(e) => updateField(f.id, { name: e.target.value })}
                  />
                  <select
                    className="sbFieldType"
                    value={f.type}
                    onChange={(e) =>
                      updateField(f.id, { type: e.target.value as FieldType })
                    }
                  >
                    {TYPE_OPTIONS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <label className="sbFieldReq">
                    <input
                      type="checkbox"
                      checked={!!f.required}
                      onChange={(e) => updateField(f.id, { required: e.target.checked })}
                    />
                    必填
                  </label>
                  <input
                    className="sbFieldDesc"
                    value={f.description ?? ''}
                    placeholder="描述（会出现在给模型的提示里）"
                    onChange={(e) => updateField(f.id, { description: e.target.value })}
                  />
                  {f.type === 'enum' ? (
                    <input
                      className="sbFieldEnum"
                      value={(f.enum ?? []).join(',')}
                      placeholder="枚举值，英文逗号分隔：餐饮,零售,其他"
                      onChange={(e) =>
                        updateField(f.id, {
                          enum: e.target.value.split(',').map((s) => s.trim()),
                        })
                      }
                    />
                  ) : null}
                  <button
                    type="button"
                    className="btn btnGhost"
                    onClick={() => removeField(f.id)}
                  >
                    删
                  </button>
                </div>
              ))}
            </div>
          )}

          {hasFields ? (
            <details className="sbPreview" open>
              <summary>拼到系统提示的片段（Schema 部分）</summary>
              <pre className="sbPreviewBlock">{previewBlock}</pre>
            </details>
          ) : null}

          <div className="sbPreviewToggle">
            <button
              type="button"
              className="btn btnGhost"
              onClick={() => setShowFinalPreview((v) => !v)}
              disabled={!systemPrompt && !hasFields}
              title={!systemPrompt ? '未提供系统提示词时仅预览 Schema 片段' : ''}
            >
              {showFinalPreview ? '收起最终系统提示预览' : '展开：预览最终系统提示（系统提示 + Schema 合并后）'}
            </button>
          </div>
          {showFinalPreview ? (
            <pre className="sbPreviewBlock sbPreviewBlock--final">{finalPreview}</pre>
          ) : null}
        </div>
      )}
    </div>
  )
}

/** 仅用于前端预览（与后端 `renderSchemaPrompt` 逻辑等价） */
function renderSchemaPreview(doc: SchemaDoc): string {
  const fields = doc.fields.filter((f) => f.name.trim())
  if (!fields.length) return ''
  const lines: string[] = []
  lines.push(
    doc.instruction?.trim() ||
      '请严格按下面的 JSON 结构返回一个纯 JSON 对象，不要输出任何额外文字、代码块围栏或解释。',
  )
  lines.push('')
  lines.push('字段清单：')
  for (const f of fields) {
    const required = f.required ? '必填' : '可选'
    const desc = f.description?.trim() ? ` — ${f.description.trim()}` : ''
    const typeLabel =
      f.type === 'enum' && f.enum && f.enum.filter((s) => s.trim()).length
        ? `enum(${f.enum
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => JSON.stringify(s))
            .join(' | ')})`
        : f.type
    lines.push(`- ${f.name.trim()}: ${typeLabel}（${required}）${desc}`)
  }
  lines.push('')
  lines.push('示例：')
  lines.push('```json')
  const sample: Record<string, unknown> = {}
  for (const f of fields) sample[f.name.trim()] = sampleValue(f)
  lines.push(JSON.stringify(sample, null, 2))
  lines.push('```')
  return lines.join('\n')
}

function sampleValue(f: SchemaField): unknown {
  switch (f.type) {
    case 'string':
      return f.description?.trim() ? `<${f.description.trim()}>` : `<${f.name.trim()}>`
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'array':
      return []
    case 'object':
      return {}
    case 'enum':
      return (f.enum ?? []).map((s) => s.trim()).find(Boolean) ?? ''
  }
}

/** 前端版本的 applySchemaToSystemPrompt（后端同名函数为准） */
function applySchemaToSystemPromptPreview(systemPrompt: string, schemaBlock: string): string {
  if (!schemaBlock) return systemPrompt || '（系统提示词为空；未定义 Schema，运行时原样发给模型）'
  const base = systemPrompt || ''
  const placeholder = /\{\{\s*schema\s*\}\}/g
  if (placeholder.test(base)) {
    placeholder.lastIndex = 0
    return base.replace(placeholder, schemaBlock)
  }
  if (!base.trim()) return schemaBlock
  return `${base.trimEnd()}\n\n${schemaBlock}`
}
