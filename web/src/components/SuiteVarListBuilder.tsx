import { useEffect, useRef, useState } from 'react'
import type { EditorMode } from './common'
import { prettifyJson, safeParseJson } from './common'
import { ModeTabs } from './ModeTabs'

/**
 * 测试集变量列表编辑器（可视化 + JSON 双模式）。
 *
 * 语义：测试集只声明"这个集合里会用到哪些变量名"，**不保存变量值**。
 * 每条变量由 name（必填、建议英文）+ description（说明，可选）组成，
 * 用例编辑时会把 name 作为下拉候选。
 *
 * 存储 JSON 形态：`{ "variables": [ { "name": "storeName", "description": "门店名" } ] }`
 *
 * 兼容读取：
 * - 新格式 `{ variables: [...] }`：直接使用
 * - 老格式 `{ variables: { k: v } }` 或扁平 `{ k: v }`：把每个 k 当 name，v 当 description 展示；
 *   用户保存时会平滑迁移到新数组格式。
 */

interface VarDecl {
  id: string
  name: string
  description: string
}

interface StoredShape {
  variables: { name: string; description?: string }[]
}

let idSeed = 0
function makeId(): string {
  idSeed += 1
  return `sv${idSeed}`
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
        rows.push({ id: makeId(), name, description })
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
      rows.push({ id: makeId(), name: k, description: String(v) })
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
    const entry: StoredShape['variables'][number] = { name }
    const desc = r.description.trim()
    if (desc) entry.description = desc
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
    emit([...rows, { id: makeId(), name: '', description: '' }])
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
            这里只定义「变量名 + 说明」，不保存变量值。用例编辑时可从这里下拉选用，断言里的"引用变量"也会用到这些名字。
          </p>
          {rows.length === 0 ? (
            <p className="muted" style={{ fontSize: 12 }}>（还没有声明任何变量）</p>
          ) : (
            <div className="kvList">
              <div className="kvRow kvRow--head">
                <span className="muted" style={{ fontSize: 12 }}>变量名</span>
                <span className="muted" style={{ fontSize: 12 }}>说明（可选）</span>
                <span />
              </div>
              {rows.map((r) => (
                <div className="kvRow" key={r.id}>
                  <input
                    className="kvKey"
                    value={r.name}
                    placeholder="例如：storeName"
                    onChange={(e) => setAt(r.id, { name: e.target.value })}
                  />
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
