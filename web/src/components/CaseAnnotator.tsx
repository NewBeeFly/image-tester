import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { imageUrl, type TestCase } from '../api'
import { AssertionBuilder, type SchemaFieldOption } from './AssertionBuilder'
import { VariableBuilder } from './VariableBuilder'

/**
 * 大图标注弹窗：左大图、右可视化表单。
 *
 * 布局原则：
 * - 图片占据左侧大部分空间，背景灰黑，便于检查招牌/文字/价签等细节
 * - 右侧两块独立卡片（变量 / 断言覆盖），底部固定保存按钮
 * - 所有子编辑器都内建「可视化 / JSON 原文」切换
 *
 * 该组件只做"视图"，不直接发 API；保存回调 `onSave` 会拿到最新的两个 JSON。
 */
export function CaseAnnotator(props: {
  open: boolean
  suiteId: number
  testCase: TestCase
  schemaFields: SchemaFieldOption[]
  /** 测试集声明的变量名列表，供变量编辑下拉候选 & 断言"引用变量"候选 */
  suiteDefinedVarKeys: string[]
  onClose: () => void
  onSave: (payload: {
    relative_image_path: string
    variables_json: string
    assertions_override_json: string
  }) => Promise<void> | void
}) {
  const { open, suiteId, testCase, schemaFields, suiteDefinedVarKeys, onClose, onSave } = props
  const [relativePath, setRelativePath] = useState(testCase.relative_image_path)
  const [variablesJson, setVariablesJson] = useState(testCase.variables_json || '{}')
  const [assertionsJson, setAssertionsJson] = useState(testCase.assertions_override_json ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setRelativePath(testCase.relative_image_path)
    setVariablesJson(testCase.variables_json || '{}')
    setAssertionsJson(testCase.assertions_override_json ?? '')
    setError(null)
  }, [open, testCase.id, testCase.relative_image_path, testCase.variables_json, testCase.assertions_override_json])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await onSave({
        relative_image_path: relativePath,
        variables_json: variablesJson || '{}',
        assertions_override_json: assertionsJson,
      })
      onClose()
    } catch (e) {
      setError((e as Error).message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  // 断言"引用变量"候选：测试集声明 + 当前用例 variables 已填 key（去重）
  const caseKeys = extractCaseVarKeys(variablesJson)
  const varKeys = Array.from(new Set([...suiteDefinedVarKeys, ...caseKeys]))

  return createPortal(
    <div className="modalOverlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modalDialog modalDialog--annotator" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <h3>大图标注 · {testCase.relative_image_path}</h3>
          <button type="button" className="modalCloseBtn btn btnGhost" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="annotatorBody">
          <div className="annotatorImage">
            <img
              src={imageUrl(suiteId, testCase.relative_image_path)}
              alt={testCase.relative_image_path}
            />
          </div>
          <div className="annotatorForm">
            <label>
              <span className="muted" style={{ fontSize: 12 }}>主图相对路径</span>
              <input
                value={relativePath}
                onChange={(e) => setRelativePath(e.target.value)}
              />
            </label>

            <section className="annotatorCard">
              <h4>变量</h4>
              <VariableBuilder
                value={variablesJson}
                onChange={setVariablesJson}
                knownKeys={suiteDefinedVarKeys}
              />
            </section>

            <section className="annotatorCard">
              <h4>
                用例级断言覆盖
                <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
                  （留空则沿用测试集默认断言）
                </span>
              </h4>
              <AssertionBuilder
                value={assertionsJson || '{"rules":[]}'}
                onChange={(next) => {
                  // 用户清空/全部删除规则时，保持空串表示"沿用测试集默认"
                  const r = safeParseOrNull(next)
                  if (!r || (Array.isArray(r.rules) && r.rules.length === 0)) {
                    setAssertionsJson('')
                  } else {
                    setAssertionsJson(next)
                  }
                }}
                schemaFields={schemaFields}
                varKeys={varKeys}
              />
            </section>

            {error ? <p className="error">{error}</p> : null}
          </div>
        </div>
        <div className="modalFooter">
          <div className="actions">
            <button type="button" className="btn btnGhost" onClick={onClose} disabled={saving}>
              取消
            </button>
            <button
              type="button"
              className="btn btnPrimary"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function safeParseOrNull(raw: string): { rules?: unknown[] } | null {
  try {
    const o = JSON.parse(raw || '{}') as { rules?: unknown[] }
    return o ?? null
  } catch {
    return null
  }
}

function extractCaseVarKeys(raw: string): string[] {
  try {
    const o = JSON.parse(raw || '{}') as Record<string, unknown>
    if (!o || typeof o !== 'object' || Array.isArray(o)) return []
    if ('variables' in o && o.variables && typeof o.variables === 'object' && !Array.isArray(o.variables)) {
      return Object.keys(o.variables as object)
    }
    const keys: string[] = []
    for (const [k, v] of Object.entries(o)) {
      if (v != null && typeof v !== 'object') keys.push(k)
    }
    return keys
  } catch {
    return []
  }
}
