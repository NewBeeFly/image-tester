import { Fragment, useEffect, useRef, useState } from 'react'
import type { SchemaFieldOption } from './AssertionBuilder'
import type { EditorMode } from './common'
import { prettifyJson, safeParseJson } from './common'
import { ModeTabs } from './ModeTabs'

/**
 * 测试集变量列表编辑器（可视化 + JSON 双模式）。
 *
 * 语义：测试集只声明"这个集合里会用到哪些变量名"，**不保存变量值**。
 * 每条变量由 name + type + description + 可选 enum 组成。
 * **array** 类型可配置 `enum`（字符串数组）：供用例变量编辑 / 大图标注里多选勾选，自动写入 JSON 数组。
 *
 * 存储 JSON：`{ "variables": [ { "name": "livestock", "type": "array", "enum": ["猪","牛"], "description": "…" } ] }`
 *
 * 兼容读取：
 * - 新格式 `{ variables: [...] }`：直接使用
 * - 老格式 `{ variables: { k: v } }` 或扁平 `{ k: v }`：把每个 k 当 name，v 当 description，type 默认 string；
 *   用户保存时会平滑迁移到新数组格式。
 */

export type SuiteVarStoredType = 'string' | 'boolean' | 'array'

interface VarDecl {
  id: string
  name: string
  type: SuiteVarStoredType
  description: string
  /** 仅 array 类型使用：预置枚举，英文逗号分隔编辑 */
  enumCsv: string
}

interface StoredShape {
  variables: { name: string; type?: SuiteVarStoredType; description?: string; enum?: string[] }[]
}

let idSeed = 0
function makeId(): string {
  idSeed += 1
  return `sv${idSeed}`
}

function normalizeType(raw: unknown): SuiteVarStoredType {
  const t = typeof raw === 'string' ? raw.toLowerCase().trim() : ''
  if (t === 'boolean' || t === 'array') return t
  return 'string'
}

function enumArrayToCsv(arr: unknown): string {
  if (!Array.isArray(arr)) return ''
  return arr.map((x) => String(x ?? '').trim()).filter(Boolean).join(',')
}

function csvToEnumArray(csv: string): string[] {
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function parseToRows(raw: string): VarDecl[] {
  const r = safeParseJson<Record<string, unknown>>(raw)
  if (!r.ok || !r.value || typeof r.value !== 'object' || Array.isArray(r.value)) return []
  const o = r.value as Record<string, unknown>
  if ('variables' in o && Array.isArray(o.variables)) {
    const list = o.variables as unknown[]
    const rows: VarDecl[] = []
    for (const item of list) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const rec = item as Record<string, unknown>
        const name = typeof rec.name === 'string' ? rec.name : ''
        const description = typeof rec.description === 'string' ? rec.description : ''
        const type = normalizeType(rec.type)
        const enumCsv = type === 'array' ? enumArrayToCsv(rec.enum) : ''
        rows.push({ id: makeId(), name, type, description, enumCsv })
      }
    }
    return rows
  }
  // 兼容老格式：dict 形态
  const src =
    'variables' in o && o.variables && typeof o.variables === 'object' && !Array.isArray(o.variables)
      ? (o.variables as Record<string, unknown>)
      : o
  const rows: VarDecl[] = []
  for (const [k, v] of Object.entries(src)) {
    if (v != null && typeof v !== 'object') {
      rows.push({ id: makeId(), name: k, type: 'string', description: String(v), enumCsv: '' })
    }
  }
  return rows
}

function rowsToJson(rows: VarDecl[]): string {
  const list: StoredShape['variables'] = []
  const seen = new Set<string>()
  for (const r of rows) {
    const name = r.name.trim()
    if (!name) continue
    if (seen.has(name)) continue
    seen.add(name)
    const entry: StoredShape['variables'][number] = { name, type: r.type }
    const desc = r.description.trim()
    if (desc) entry.description = desc
    if (r.type === 'array') {
      const enums = csvToEnumArray(r.enumCsv)
      if (enums.length) entry.enum = enums
    }
    list.push(entry)
  }
  if (list.length === 0) return '{}'
  return JSON.stringify({ variables: list }, null, 2)
}

export function SuiteVarListBuilder(props: {
  value: string
  onChange: (next: string) => void
  leftHint?: string
}) {
  const { value, onChange, leftHint } = props
  const [mode, setMode] = useState<EditorMode>('visual')
  const [rows, setRows] = useState<VarDecl[]>(() => parseToRows(value || '{}'))
  const [rawJson, setRawJson] = useState(value || '{}')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const lastEmittedRef = useRef(value || '{}')

  useEffect(() => {
    const incoming = value || '{}'
    if (incoming === lastEmittedRef.current) return
    lastEmittedRef.current = incoming
    setRows(parseToRows(incoming))
    setRawJson(incoming)
    setJsonError(null)
  }, [value])

  function emit(next: VarDecl[]) {
    const s = rowsToJson(next)
    setRows(next)
    setRawJson(s)
    setJsonError(null)
    lastEmittedRef.current = s
    onChange(s)
  }

  function onJsonChange(t: string) {
    setRawJson(t)
    const r = safeParseJson(t)
    if (!r.ok) {
      setJsonError(r.error)
      return
    }
    setJsonError(null)
    setRows(parseToRows(t))
    lastEmittedRef.current = t
    onChange(t)
  }

  function handlePrettify() {
    const p = prettifyJson(rawJson)
    setRawJson(p)
    setJsonError(null)
    lastEmittedRef.current = p
    setRows(parseToRows(p))
    onChange(p)
  }

  function setAt(id: string, patch: Partial<VarDecl>) {
    emit(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }
  function remove(id: string) {
    emit(rows.filter((r) => r.id !== id))
  }
  function add() {
    emit([...rows, { id: makeId(), name: '', type: 'string', description: '', enumCsv: '' }])
  }

  return (
    <div className="vb">
      <ModeTabs
        mode={mode}
        onChange={setMode}
        onPrettify={handlePrettify}
        jsonError={jsonError}
        leftHint={leftHint}
      />
      {mode === 'json' ? (
        <textarea
          className="modalTextarea"
          value={rawJson}
          onChange={(e) => onJsonChange(e.target.value)}
          spellCheck={false}
        />
      ) : (
        <div className="vbSection">
          <div className="vbSectionHeader">
            <strong>变量声明</strong>
            <button type="button" className="btn btnGhost" onClick={add}>
              + 新增变量
            </button>
          </div>
          <p className="muted" style={{ margin: '4px 0 8px', fontSize: 12 }}>
            这里定义「变量名 + 类型 + 说明」，不保存变量值。类型为<strong>数组</strong>时可填「预置枚举」，用例编辑 / 大图标注里会显示多选勾选，自动写入 JSON 数组；无枚举时仍可手写 JSON。
          </p>
          {rows.length === 0 ? (
            <p className="muted" style={{ fontSize: 12 }}>（还没有声明任何变量）</p>
          ) : (
            <div className="kvList">
              <div className="kvRow kvRow--head kvRow--suiteVars">
                <span className="muted" style={{ fontSize: 12 }}>变量名</span>
                <span className="muted" style={{ fontSize: 12 }}>类型</span>
                <span className="muted" style={{ fontSize: 12 }}>说明（可选）</span>
                <span />
              </div>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <div className="kvRow kvRow--suiteVars">
                    <input
                      className="kvKey"
                      value={r.name}
                      placeholder="例如：storeName"
                      onChange={(e) => setAt(r.id, { name: e.target.value })}
                    />
                    <select
                      className="abInput"
                      value={r.type}
                      onChange={(e) => {
                        const type = e.target.value as SuiteVarStoredType
                        setAt(r.id, { type, enumCsv: type === 'array' ? r.enumCsv : '' })
                      }}
                    >
                      <option value="string">字符串</option>
                      <option value="boolean">布尔值</option>
                      <option value="array">数组</option>
                    </select>
                    <input
                      className="kvVal"
                      value={r.description}
                      placeholder="例如：门店名"
                      onChange={(e) => setAt(r.id, { description: e.target.value })}
                    />
                    <button type="button" className="btn btnGhost" onClick={() => remove(r.id)}>
                      删
                    </button>
                  </div>
                  {r.type === 'array' ? (
                    <div className="suiteVarEnumRow">
                      <span className="muted" style={{ fontSize: 12 }}>
                        预置枚举（英文逗号分隔）
                      </span>
                      <input
                        className="kvVal"
                        value={r.enumCsv}
                        placeholder="例如：猪,牛,鸡"
                        onChange={(e) => setAt(r.id, { enumCsv: e.target.value })}
                      />
                    </div>
                  ) : null}
                </Fragment>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 从测试集变量声明 JSON 中解析出变量名列表（用于喂给下拉选择）。
 * 兼容新老三种形态。
 */
export function extractSuiteVarNames(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return []
  const o = data as Record<string, unknown>
  if ('variables' in o && Array.isArray(o.variables)) {
    const out: string[] = []
    for (const it of o.variables as unknown[]) {
      if (it && typeof it === 'object' && !Array.isArray(it)) {
        const name = (it as Record<string, unknown>).name
        if (typeof name === 'string' && name.trim()) out.push(name.trim())
      }
    }
    return Array.from(new Set(out))
  }
  const src =
    'variables' in o && o.variables && typeof o.variables === 'object' && !Array.isArray(o.variables)
      ? (o.variables as Record<string, unknown>)
      : o
  return Array.from(new Set(Object.keys(src).filter((k) => k.trim())))
}

/** 供断言编辑器合并字段类型：与 Schema 字段结构一致 */
export function extractSuiteVarFields(raw: string | null | undefined): SchemaFieldOption[] {
  if (!raw || !raw.trim()) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return []
  const o = data as Record<string, unknown>
  if (!('variables' in o) || !Array.isArray(o.variables)) return []
  const out: SchemaFieldOption[] = []
  const seen = new Set<string>()
  for (const it of o.variables as unknown[]) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) continue
    const rec = it as Record<string, unknown>
    const name = typeof rec.name === 'string' ? rec.name.trim() : ''
    if (!name || seen.has(name)) continue
    seen.add(name)
    const t = normalizeType(rec.type)
    const enumList =
      t === 'array' && Array.isArray(rec.enum)
        ? (rec.enum as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean)
        : undefined
    out.push({
      name,
      type: t,
      description: typeof rec.description === 'string' ? rec.description : undefined,
      enumValues: enumList?.length ? enumList : undefined,
    })
  }
  return out
}

/** 用例变量编辑：按变量名查类型与 array 预置枚举 */
export type SuiteVarValueHint = { type: SuiteVarStoredType; enum?: string[] }

export function extractSuiteVarValueHints(raw: string | null | undefined): Record<string, SuiteVarValueHint> {
  const fields = extractSuiteVarFields(raw)
  const out: Record<string, SuiteVarValueHint> = {}
  for (const f of fields) {
    const t = normalizeType(f.type)
    out[f.name] = {
      type: t,
      enum: f.enumValues?.length ? f.enumValues : undefined,
    }
  }
  return out
}
