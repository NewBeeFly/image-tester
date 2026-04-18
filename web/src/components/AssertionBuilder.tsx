import type { ReactElement } from 'react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { EditorMode } from './common'
import { prettifyJson, safeParseJson } from './common'
import { ModeTabs } from './ModeTabs'

/**
 * 断言可视化编辑器。
 *
 * 断言 JSON 顶层：`{ "rules": [ ... ] }`，所有规则 AND。
 *
 * 交互设计：
 * 1) 字段列用单一下拉：「整段文本 / 各 Schema 字段 / 自定义 jsonPath」三选一；
 * 2) 操作符列根据字段类型自动过滤——例如选了 boolean 就不出现「字段数值等于」；
 * 3) 期望值列在「引用变量」模式下是 combobox，候选来自测试集变量列表（可下拉选，也可手输）。
 *
 * 变量模型简化：不再区分 @case / @suite 两套。测试集只声明变量名，
 *   运行时用的值来自用例 `variables_json`；历史存的 `equalsSuiteVar` 在读入时会被当作 `equalsCaseVar`，
 *   保存时自动写成新的形态。
 *
 * 高级规则（customScript / llmJudge）仍以只读 JSON 卡片展示 + 删除，避免覆盖表达能力。
 */

export interface SchemaFieldOption {
  name: string
  type: string
  description?: string
  enumValues?: string[]
}

export interface AssertionBuilderProps {
  value: string
  onChange: (next: string) => void
  /** 字段选择器下拉的 Schema 字段（来自当前提示词模板） */
  schemaFields?: SchemaFieldOption[]
  /**
   * 期望值「引用变量」下拉候选。
   * 应合并传入：测试集变量列表中声明的变量名 + 当前用例 variables 里已经填过的 key。
   */
  varKeys?: string[]
}

type SourceKind = 'fullText' | 'schema' | 'custom'
type ExpectedSource = 'const' | 'var'

type VisualOp =
  | 'contains'
  | 'notContains'
  | 'regex'
  | 'fieldEquals'
  | 'fieldInList'
  | 'fieldNumericEquals'
  | 'fieldRegex'
  | 'fieldExists'
  | 'fieldEmpty'

const OP_LABEL: Record<VisualOp, string> = {
  contains: '整段包含',
  notContains: '整段不包含',
  regex: '整段匹配正则',
  fieldEquals: '等于',
  fieldInList: '在列表中',
  fieldNumericEquals: '数值等于',
  fieldRegex: '匹配正则',
  fieldExists: '存在且非空',
  fieldEmpty: '为空或不存在',
}

const TEXT_OPS: VisualOp[] = ['contains', 'notContains', 'regex']
const ALL_FIELD_OPS: VisualOp[] = [
  'fieldEquals',
  'fieldInList',
  'fieldNumericEquals',
  'fieldRegex',
  'fieldExists',
  'fieldEmpty',
]

/** 根据字段来源 / 字段类型 给出允许的操作符白名单 */
function allowedOps(sourceKind: SourceKind, fieldType?: string): VisualOp[] {
  if (sourceKind === 'fullText') return TEXT_OPS
  if (sourceKind === 'custom' || !fieldType) return ALL_FIELD_OPS
  switch (fieldType) {
    case 'string':
      return ['fieldEquals', 'fieldInList', 'fieldRegex', 'fieldExists', 'fieldEmpty']
    case 'enum':
      return ['fieldEquals', 'fieldInList', 'fieldExists']
    case 'number':
      return ['fieldNumericEquals', 'fieldEquals', 'fieldExists', 'fieldEmpty']
    case 'boolean':
      return ['fieldEquals', 'fieldExists', 'fieldEmpty']
    case 'array':
      return ['fieldExists', 'fieldEmpty']
    case 'object':
      return ['fieldExists', 'fieldEmpty']
    default:
      return ALL_FIELD_OPS
  }
}

interface VisualRule {
  op: VisualOp
  sourceKind: SourceKind
  path: string
  caseInsensitive?: boolean
  expectedSource: ExpectedSource
  expectedText: string
  expectedList: string[]
  expectedNumber: number
  expectedRegex: string
}

type EditorRule =
  | { kind: 'visual'; data: VisualRule }
  | { kind: 'unknown'; raw: unknown }

function emptyVisual(): VisualRule {
  return {
    op: 'contains',
    sourceKind: 'fullText',
    path: '',
    caseInsensitive: true,
    expectedSource: 'const',
    expectedText: '',
    expectedList: [],
    expectedNumber: 0,
    expectedRegex: '',
  }
}

function parseRules(raw: string): EditorRule[] {
  const r = safeParseJson<{ rules?: unknown[] }>(raw)
  if (!r.ok || !r.value || typeof r.value !== 'object') return []
  const rules = Array.isArray(r.value.rules) ? r.value.rules : []
  return rules.map((x) => toEditor(x))
}

function toEditor(raw: unknown): EditorRule {
  if (!raw || typeof raw !== 'object') return { kind: 'unknown', raw }
  const r = raw as Record<string, unknown>
  const type = r.type as string
  if (type === 'contains') {
    const neg = r.negate === true
    return {
      kind: 'visual',
      data: {
        ...emptyVisual(),
        op: neg ? 'notContains' : 'contains',
        sourceKind: 'fullText',
        expectedSource: 'const',
        expectedText: String(r.value ?? ''),
        caseInsensitive: r.caseInsensitive !== false,
      },
    }
  }
  if (type === 'regex') {
    return {
      kind: 'visual',
      data: {
        ...emptyVisual(),
        op: 'regex',
        sourceKind: 'fullText',
        expectedSource: 'const',
        expectedRegex: String(r.pattern ?? ''),
      },
    }
  }
  if (type === 'jsonPath') {
    const path = String(r.path ?? '$')
    const sourceKind: SourceKind =
      path.startsWith('$.') && !path.includes('[') && /^[$]\.[A-Za-z0-9_]+$/.test(path)
        ? 'schema'
        : 'custom'
    const base: VisualRule = { ...emptyVisual(), sourceKind, path }
    // 新语义：所有"引用变量"统一走 var；老数据里的 equalsSuiteVar / equalsCaseVar 都视为 var
    if (r.equalsSuiteVar != null) {
      return {
        kind: 'visual',
        data: { ...base, op: 'fieldEquals', expectedSource: 'var', expectedText: String(r.equalsSuiteVar) },
      }
    }
    if (r.equalsCaseVar != null) {
      return {
        kind: 'visual',
        data: { ...base, op: 'fieldEquals', expectedSource: 'var', expectedText: String(r.equalsCaseVar) },
      }
    }
    if (r.equals != null) {
      return {
        kind: 'visual',
        data: { ...base, op: 'fieldEquals', expectedSource: 'const', expectedText: String(r.equals) },
      }
    }
    if (Array.isArray(r.inList)) {
      return {
        kind: 'visual',
        data: {
          ...base,
          op: 'fieldInList',
          expectedSource: 'const',
          expectedList: (r.inList as unknown[]).map((x) => String(x ?? '')),
        },
      }
    }
    if (r.numericEquals != null) {
      return {
        kind: 'visual',
        data: { ...base, op: 'fieldNumericEquals', expectedSource: 'const', expectedNumber: Number(r.numericEquals) },
      }
    }
    if (r.regex != null) {
      return {
        kind: 'visual',
        data: { ...base, op: 'fieldRegex', expectedSource: 'const', expectedRegex: String(r.regex) },
      }
    }
    return { kind: 'visual', data: { ...base, op: 'fieldExists' } }
  }
  return { kind: 'unknown', raw }
}

function visualToJsonRule(v: VisualRule): Record<string, unknown> | null {
  const path = v.sourceKind === 'fullText' ? '' : v.path.trim() || '$'
  switch (v.op) {
    case 'contains':
      return { type: 'contains', value: v.expectedText, caseInsensitive: !!v.caseInsensitive }
    case 'notContains':
      return { type: 'contains', value: v.expectedText, caseInsensitive: !!v.caseInsensitive, negate: true }
    case 'regex':
      return { type: 'regex', pattern: v.expectedRegex }
    case 'fieldEquals': {
      const base: Record<string, unknown> = { type: 'jsonPath', path }
      if (v.expectedSource === 'var') base.equalsCaseVar = v.expectedText
      else base.equals = v.expectedText
      return base
    }
    case 'fieldInList':
      return { type: 'jsonPath', path, inList: v.expectedList }
    case 'fieldNumericEquals':
      return { type: 'jsonPath', path, numericEquals: v.expectedNumber }
    case 'fieldRegex':
      return { type: 'jsonPath', path, regex: v.expectedRegex }
    case 'fieldExists':
      return { type: 'jsonPath', path }
    case 'fieldEmpty':
      return {
        type: 'customScript',
        expression: `(() => { try { const v = (parsedJson && typeof parsedJson === 'object') ? (${safePathExpr(path)}) : undefined; return v === undefined || v === null || v === ''; } catch { return true; } })()`,
      }
  }
}

function safePathExpr(path: string): string {
  const keys = path.replace(/^\$\.?/, '').split('.').filter(Boolean)
  if (!keys.length) return 'parsedJson'
  return keys.reduce((acc, k) => `${acc}?.[${JSON.stringify(k)}]`, 'parsedJson')
}

function editorToJson(rules: EditorRule[]): string {
  const out: unknown[] = []
  for (const r of rules) {
    if (r.kind === 'visual') {
      const j = visualToJsonRule(r.data)
      if (j) out.push(j)
    } else {
      out.push(r.raw)
    }
  }
  return JSON.stringify({ rules: out }, null, 2)
}

export function AssertionBuilder(props: AssertionBuilderProps) {
  const { value, onChange, schemaFields = [], varKeys = [] } = props
  const [mode, setMode] = useState<EditorMode>('visual')
  const [rawJson, setRawJson] = useState(value || '{"rules":[]}')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const skipNextSync = useRef(false)

  useEffect(() => {
    if (skipNextSync.current) {
      skipNextSync.current = false
      return
    }
    setRawJson(value || '{"rules":[]}')
    setJsonError(null)
  }, [value])

  const rules = useMemo(() => parseRules(rawJson), [rawJson])

  function emitRules(next: EditorRule[]) {
    const s = editorToJson(next)
    skipNextSync.current = true
    setRawJson(s)
    setJsonError(null)
    onChange(s)
  }

  function updateVisual(i: number, patch: Partial<VisualRule>) {
    const next = rules.map((r, idx) =>
      idx === i && r.kind === 'visual' ? { ...r, data: { ...r.data, ...patch } } : r,
    )
    emitRules(next)
  }
  function removeRule(i: number) {
    emitRules(rules.filter((_, idx) => idx !== i))
  }
  function addVisual() {
    emitRules([...rules, { kind: 'visual', data: emptyVisual() }])
  }

  function onJsonChange(t: string) {
    setRawJson(t)
    const r = safeParseJson(t)
    if (!r.ok) {
      setJsonError(r.error)
      return
    }
    setJsonError(null)
    skipNextSync.current = true
    onChange(t)
  }

  function handlePrettify() {
    const p = prettifyJson(rawJson)
    setRawJson(p)
    setJsonError(null)
    skipNextSync.current = true
    onChange(p)
  }

  return (
    <div className="ab">
      <ModeTabs
        mode={mode}
        onChange={setMode}
        onPrettify={handlePrettify}
        jsonError={jsonError}
        leftHint="所有规则同时满足（AND）才算通过"
      />
      {mode === 'json' ? (
        <textarea
          className="modalTextarea"
          value={rawJson}
          onChange={(e) => onJsonChange(e.target.value)}
          spellCheck={false}
        />
      ) : (
        <div className="abVisual">
          {rules.length === 0 ? (
            <p className="muted" style={{ fontSize: 12 }}>
              暂无断言。点「+ 新增规则」开始，或切到「JSON 原文」粘贴历史配置。
            </p>
          ) : (
            <div className="abRules">
              <div className="abRuleRow abRuleRow--head muted">
                <div>字段</div>
                <div>操作符</div>
                <div>期望值</div>
                <div />
              </div>
              {rules.map((r, i) =>
                r.kind === 'visual' ? (
                  <VisualRuleRow
                    key={i}
                    rule={r.data}
                    schemaFields={schemaFields}
                    varKeys={varKeys}
                    onChange={(patch) => updateVisual(i, patch)}
                    onRemove={() => removeRule(i)}
                  />
                ) : (
                  <div className="abRuleRow abRuleRow--advanced" key={i}>
                    <span className="abAdvBadge">高级</span>
                    <pre className="abAdvBody">{JSON.stringify(r.raw, null, 2)}</pre>
                    <button
                      type="button"
                      className="btn btnGhost"
                      onClick={() => removeRule(i)}
                    >
                      删
                    </button>
                  </div>
                ),
              )}
            </div>
          )}

          <div className="abActions">
            <button type="button" className="btn btnGhost" onClick={addVisual}>
              + 新增规则
            </button>
            <span className="muted" style={{ fontSize: 12 }}>
              高级规则（customScript / llmJudge）请切到「JSON 原文」添加；这里可看/可删但不改。
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

/** 字段 select 的 value 约定：
 *  - `$`：整段文本（fullText）
 *  - `schema:<fieldName>`：Schema 字段（path 自动设为 `$.<fieldName>`）
 *  - `custom`：自定义 jsonPath（下方补一个 input）
 */
function fieldSelectValue(rule: VisualRule): string {
  if (rule.sourceKind === 'fullText') return '$'
  if (rule.sourceKind === 'schema') {
    const name = rule.path.replace(/^\$\./, '')
    return `schema:${name}`
  }
  return 'custom'
}

function VisualRuleRow(props: {
  rule: VisualRule
  schemaFields: SchemaFieldOption[]
  varKeys: string[]
  onChange: (patch: Partial<VisualRule>) => void
  onRemove: () => void
}) {
  const { rule, schemaFields, varKeys, onChange, onRemove } = props
  const listIdBase = useId().replace(/:/g, '_')

  /** 当前字段对应的 Schema 类型（用来过滤操作符） */
  const fieldType = useMemo(() => {
    if (rule.sourceKind !== 'schema') return undefined
    const name = rule.path.replace(/^\$\./, '')
    return schemaFields.find((f) => f.name === name)?.type
  }, [rule.sourceKind, rule.path, schemaFields])

  const ops = useMemo(() => allowedOps(rule.sourceKind, fieldType), [rule.sourceKind, fieldType])

  /** 若当前 op 不在允许集合里，自动降级 —— 例如把 boolean 字段选成"数值等于"之后切到 string，不做重置就一直卡住 */
  useEffect(() => {
    if (!ops.includes(rule.op)) {
      onChange({ op: ops[0] })
    }
    // 只在 ops 变更时检查
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ops.join('|')])

  function onFieldSelectChange(v: string) {
    if (v === '$') {
      onChange({ sourceKind: 'fullText', path: '', op: TEXT_OPS[0] })
      return
    }
    if (v.startsWith('schema:')) {
      const name = v.slice('schema:'.length)
      const type = schemaFields.find((f) => f.name === name)?.type
      const nextOps = allowedOps('schema', type)
      onChange({
        sourceKind: 'schema',
        path: `$.${name}`,
        op: nextOps.includes(rule.op) && !TEXT_OPS.includes(rule.op) ? rule.op : nextOps[0],
      })
      return
    }
    // custom
    onChange({
      sourceKind: 'custom',
      path: rule.path && rule.path.startsWith('$') ? rule.path : '$',
      op: TEXT_OPS.includes(rule.op) ? 'fieldEquals' : rule.op,
    })
  }

  return (
    <div className="abRuleRow">
      {/* 字段：单一 select +（自定义时）path 输入 */}
      <div className="abCell">
        <select
          className="abInput"
          value={fieldSelectValue(rule)}
          onChange={(e) => onFieldSelectChange(e.target.value)}
        >
          <option value="$">模型整段输出</option>
          {schemaFields.length > 0 ? (
            <optgroup label="Schema 字段">
              {schemaFields.map((f) => (
                <option key={f.name} value={`schema:${f.name}`}>
                  {f.name}（{f.type}）
                </option>
              ))}
            </optgroup>
          ) : null}
          <option value="custom">自定义 jsonPath…</option>
        </select>
        {rule.sourceKind === 'custom' ? (
          <input
            className="abInput abInput--mt"
            placeholder="例如：$.storeName"
            value={rule.path}
            onChange={(e) => onChange({ path: e.target.value })}
          />
        ) : null}
      </div>

      {/* 操作符：按字段类型过滤 */}
      <div className="abCell">
        <select
          className="abInput"
          value={rule.op}
          onChange={(e) => onChange({ op: e.target.value as VisualOp })}
        >
          {ops.map((o) => (
            <option key={o} value={o}>
              {OP_LABEL[o]}
            </option>
          ))}
        </select>
        {(rule.op === 'contains' || rule.op === 'notContains') ? (
          <label className="abCi">
            <input
              type="checkbox"
              checked={!!rule.caseInsensitive}
              onChange={(e) => onChange({ caseInsensitive: e.target.checked })}
            />
            忽略大小写
          </label>
        ) : null}
      </div>

      {/* 期望值：按操作符 + 来源渲染 */}
      <div className="abCell">
        {renderExpected(rule, {
          varKeys,
          listIdBase,
          schemaFieldType: fieldType,
          schemaFieldEnum: rule.sourceKind === 'schema'
            ? schemaFields.find((f) => `$.${f.name}` === rule.path)?.enumValues
            : undefined,
          onChange,
        })}
      </div>

      <button type="button" className="btn btnGhost abRuleRemove" onClick={onRemove}>
        删
      </button>
    </div>
  )
}

function renderExpected(
  rule: VisualRule,
  ctx: {
    varKeys: string[]
    listIdBase: string
    schemaFieldType?: string
    schemaFieldEnum?: string[]
    onChange: (patch: Partial<VisualRule>) => void
  },
): ReactElement {
  const { varKeys, listIdBase, schemaFieldType, schemaFieldEnum, onChange } = ctx
  const op = rule.op

  if (op === 'fieldExists' || op === 'fieldEmpty') {
    return <span className="abFieldFixed muted">（无需期望值）</span>
  }
  if (op === 'fieldNumericEquals') {
    return (
      <input
        type="number"
        className="abInput"
        value={rule.expectedNumber}
        onChange={(e) => onChange({ expectedNumber: Number(e.target.value) })}
      />
    )
  }
  if (op === 'regex' || op === 'fieldRegex') {
    return (
      <input
        className="abInput"
        placeholder="正则表达式，例如 ^\\s*\\{"
        value={rule.expectedRegex}
        onChange={(e) => onChange({ expectedRegex: e.target.value })}
      />
    )
  }
  if (op === 'fieldInList') {
    // 枚举字段：提示可选值
    const listId = `${listIdBase}-enum`
    return (
      <>
        <input
          className="abInput"
          list={schemaFieldEnum?.length ? listId : undefined}
          placeholder={schemaFieldEnum?.length ? '英文逗号分隔，可从下拉选' : '英文逗号分隔：餐饮,零售,其他'}
          value={rule.expectedList.join(',')}
          onChange={(e) =>
            onChange({
              expectedList: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
            })
          }
        />
        {schemaFieldEnum?.length ? (
          <datalist id={listId}>
            {schemaFieldEnum.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        ) : null}
      </>
    )
  }

  // contains / notContains / fieldEquals
  const isFieldEquals = op === 'fieldEquals'
  const kindSelect = (
    <select
      className="abInput abInput--slim"
      value={isFieldEquals ? rule.expectedSource : 'const'}
      disabled={!isFieldEquals}
      title={!isFieldEquals ? '仅「等于」支持变量来源' : ''}
      onChange={(e) => onChange({ expectedSource: e.target.value as ExpectedSource })}
    >
      <option value="const">常量</option>
      <option value="var">引用变量</option>
    </select>
  )

  // boolean 字段的 fieldEquals：直接 true / false
  if (isFieldEquals && rule.expectedSource === 'const' && schemaFieldType === 'boolean') {
    return (
      <>
        {kindSelect}
        <select
          className="abInput"
          value={rule.expectedText || 'true'}
          onChange={(e) => onChange({ expectedText: e.target.value })}
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      </>
    )
  }

  // 枚举字段的 fieldEquals：datalist 给出候选
  const enumOptions =
    isFieldEquals &&
    rule.expectedSource === 'const' &&
    schemaFieldType === 'enum' &&
    schemaFieldEnum?.length
      ? schemaFieldEnum
      : undefined
  if (enumOptions) {
    const listId = `${listIdBase}-eqenum`
    return (
      <>
        {kindSelect}
        <input
          className="abInput"
          list={listId}
          placeholder="选择或输入枚举值"
          value={rule.expectedText}
          onChange={(e) => onChange({ expectedText: e.target.value })}
        />
        <datalist id={listId}>
          {enumOptions.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      </>
    )
  }

  // var / 普通 const：combobox（input + datalist 提供候选但不强制）
  const suggestions = isFieldEquals && rule.expectedSource === 'var' ? varKeys : []
  const listId = `${listIdBase}-expected`
  const placeholder =
    isFieldEquals && rule.expectedSource === 'var'
      ? '变量名，从测试集变量列表选择或自行输入'
      : '期望文本'
  return (
    <>
      {isFieldEquals ? kindSelect : null}
      <input
        className="abInput"
        list={suggestions.length ? listId : undefined}
        placeholder={placeholder}
        value={rule.expectedText}
        onChange={(e) => onChange({ expectedText: e.target.value })}
      />
      {suggestions.length ? (
        <datalist id={listId}>
          {suggestions.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      ) : null}
    </>
  )
}
