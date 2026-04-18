import { useEffect, useId, useRef, useState } from 'react'
import type { EditorMode } from './common'
import { prettifyJson, safeParseJson } from './common'
import { ModeTabs } from './ModeTabs'

/**
 * 变量编辑器（可视化 + JSON 双模式）。
 *
 * 数据形态同时兼容：
 * - 新版分区：`{ "variables": {...}, "images": {...} }`
 * - 老版扁平：`{ "k":"v", ... }`（视作 variables；保存时会写成分区格式）
 * - 仅用例变量场景（`hideImages=true`）：只有 variables 一张表
 *
 * 设计要点：
 * - 可视化里每一行都用**稳定 id** 作为 React key，避免输入 key 时 input 被重建导致失焦。
 * - 可视化编辑时**不过滤空 key 行**，保留给用户继续补名字；序列化落到外部时才过滤。
 * - 外部 `value` 变更（而非本组件自己触发）才会重建可视化 state，避免草稿被冲掉。
 */

export interface CaseMetadataJson {
  variables?: Record<string, string>
  images?: Record<string, string>
}

interface Row {
  id: string
  k: string
  v: string
}

let idSeed = 0
function makeId(): string {
  idSeed += 1
  return `r${idSeed}`
}

interface Sections {
  variables: Row[]
  images: Row[]
}

function parseToRows(raw: string): Sections {
  const r = safeParseJson<CaseMetadataJson | Record<string, unknown>>(raw)
  if (!r.ok || !r.value || typeof r.value !== 'object' || Array.isArray(r.value)) {
    return { variables: [], images: [] }
  }
  const o = r.value as Record<string, unknown>
  const hasPartition = 'variables' in o || 'images' in o
  const vars: Row[] = []
  const imgs: Row[] = []
  if (hasPartition) {
    const v = (o.variables ?? {}) as Record<string, unknown>
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k, val] of Object.entries(v)) {
        vars.push({ id: makeId(), k, v: val == null ? '' : String(val) })
      }
    }
    const i = (o.images ?? {}) as Record<string, unknown>
    if (i && typeof i === 'object' && !Array.isArray(i)) {
      for (const [k, val] of Object.entries(i)) {
        imgs.push({ id: makeId(), k, v: val == null ? '' : String(val) })
      }
    }
  } else {
    for (const [k, val] of Object.entries(o)) {
      if (val != null && typeof val !== 'object') {
        vars.push({ id: makeId(), k, v: String(val) })
      }
    }
  }
  return { variables: vars, images: imgs }
}

function rowsToJson(variables: Row[], images: Row[]): string {
  const vObj: Record<string, string> = {}
  for (const { k, v } of variables) {
    const kk = k.trim()
    if (!kk) continue
    vObj[kk] = v
  }
  const iObj: Record<string, string> = {}
  for (const { k, v } of images) {
    const kk = k.trim()
    if (!kk) continue
    iObj[kk] = v
  }
  const payload: CaseMetadataJson = {}
  if (Object.keys(vObj).length) payload.variables = vObj
  if (Object.keys(iObj).length) payload.images = iObj
  return JSON.stringify(payload, null, 2) || '{}'
}

export function VariableBuilder(props: {
  value: string
  onChange: (next: string) => void
  hideImages?: boolean
  /** 可视化区的可选右上提示 */
  leftHint?: string
  /**
   * 测试集预声明的变量名列表。
   * 若提供，文本变量区的 key 输入会变成下拉可选（仍允许自由输入），
   * 并提供"按测试集变量补全"快捷按钮。
   */
  knownKeys?: string[]
}) {
  const { value, onChange, hideImages, leftHint, knownKeys } = props
  const [mode, setMode] = useState<EditorMode>('visual')
  const [visual, setVisual] = useState<Sections>(() => parseToRows(value || '{}'))
  const [rawJson, setRawJson] = useState(value || '{}')
  const [jsonError, setJsonError] = useState<string | null>(null)

  /** 最近一次"本组件主动写到外部"的 JSON；用于区分外部变动 vs 自回显 */
  const lastEmittedRef = useRef(value || '{}')

  useEffect(() => {
    const incoming = value || '{}'
    if (incoming === lastEmittedRef.current) return
    lastEmittedRef.current = incoming
    setVisual(parseToRows(incoming))
    setRawJson(incoming)
    setJsonError(null)
  }, [value])

  function emit(nextVisual: Sections) {
    const s = rowsToJson(nextVisual.variables, hideImages ? [] : nextVisual.images)
    setVisual(nextVisual)
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
    setVisual(parseToRows(t))
    lastEmittedRef.current = t
    onChange(t)
  }

  function handlePrettify() {
    const p = prettifyJson(rawJson)
    setRawJson(p)
    setJsonError(null)
    lastEmittedRef.current = p
    setVisual(parseToRows(p))
    onChange(p)
  }

  function setVariablesRows(next: Row[]) {
    emit({ variables: next, images: visual.images })
  }
  function setImagesRows(next: Row[]) {
    emit({ variables: visual.variables, images: next })
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
        <div className="vbVisual">
          <KvListEditor
            title="文本变量"
            hint={
              knownKeys && knownKeys.length
                ? '可被提示词 {{var:键}} 占位符引用；变量名可从测试集变量列表下拉选择，也可自行输入'
                : '可被提示词 {{var:键}} 占位符引用，也可作为断言"引用变量"期望值来源'
            }
            keyPlaceholder="例如：storeName"
            valuePlaceholder="例如：东南王村便利店"
            rows={visual.variables}
            onChange={setVariablesRows}
            knownKeys={knownKeys}
          />
          {!hideImages ? (
            <KvListEditor
              title="图片别名"
              hint="别名 → 相对 image_root 的路径；模板里用 {{img:别名}} 插入。留空也行：模板里的 {{img:main}} 会自动指向该用例的主图"
              keyPlaceholder="例如：ref"
              valuePlaceholder="例如：参考图/店招.png"
              rows={visual.images}
              onChange={setImagesRows}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}

function KvListEditor(props: {
  title: string
  hint?: string
  keyPlaceholder: string
  valuePlaceholder: string
  rows: Row[]
  onChange: (next: Row[]) => void
  /** 可选：预置变量名下拉候选；提供时 key 输入变 combobox */
  knownKeys?: string[]
}) {
  const { title, hint, rows, onChange, keyPlaceholder, valuePlaceholder, knownKeys } = props
  const listId = useId()
  function setAt(id: string, patch: Partial<Row>) {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }
  function remove(id: string) {
    onChange(rows.filter((r) => r.id !== id))
  }
  function add(preset?: string) {
    onChange([...rows, { id: makeId(), k: preset ?? '', v: '' }])
  }
  const usedKeys = new Set(rows.map((r) => r.k.trim()).filter(Boolean))
  const remaining = (knownKeys ?? []).filter((k) => k && !usedKeys.has(k))
  const hasKnown = Array.isArray(knownKeys) && knownKeys.length > 0
  return (
    <div className="vbSection">
      <div className="vbSectionHeader">
        <strong>{title}</strong>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn btnGhost" onClick={() => add()}>
            + 新增
          </button>
        </div>
      </div>
      {hint ? <p className="muted" style={{ margin: '4px 0 8px', fontSize: 12 }}>{hint}</p> : null}
      {hasKnown && remaining.length > 0 ? (
        <div className="vbKnownKeys">
          <span className="muted" style={{ fontSize: 12 }}>快速添加：</span>
          {remaining.map((k) => (
            <button
              key={k}
              type="button"
              className="btn btnGhost vbKnownKeyChip"
              onClick={() => add(k)}
              title={`新增变量 ${k}`}
            >
              + {k}
            </button>
          ))}
        </div>
      ) : null}
      {hasKnown ? (
        <datalist id={listId}>
          {(knownKeys ?? []).map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
      ) : null}
      {rows.length === 0 ? (
        <p className="muted" style={{ fontSize: 12 }}>（空）</p>
      ) : (
        <div className="kvList">
          {rows.map((r) => (
            <div className="kvRow" key={r.id}>
              <input
                className="kvKey"
                value={r.k}
                placeholder={keyPlaceholder}
                list={hasKnown ? listId : undefined}
                onChange={(e) => setAt(r.id, { k: e.target.value })}
              />
              <input
                className="kvVal"
                value={r.v}
                placeholder={valuePlaceholder}
                onChange={(e) => setAt(r.id, { v: e.target.value })}
              />
              <button type="button" className="btn btnGhost" onClick={() => remove(r.id)}>
                删
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
