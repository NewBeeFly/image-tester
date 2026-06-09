import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { imageUrl, type TestCase } from '../api'
import { AssertionBuilder, type SchemaFieldOption } from './AssertionBuilder'
import { VariableBuilder } from './VariableBuilder'
import type { SuiteVarValueHint } from './SuiteVarListBuilder'
import { ImageViewer, type ImageViewerHandle } from './ImageViewer'

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
  /** 测试集变量类型与 array 枚举，供变量值多选 */
  suiteVarHints: Record<string, SuiteVarValueHint>
  /** 当前测试集下全部用例的可见顺序 */
  caseList: TestCase[]
  /** testCase 在 caseList 中的下标；找不到时为 -1 */
  currentIndex: number
  /** 翻页：父级负责保存 + 切换 id */
  onRequestNavigate: (direction: -1 | 1) => Promise<void> | void
  /**
   * 把"草稿是否改动"上抛给父级（父级决定是否在翻页前自动保存）。
   * 函数引用稳定性无要求：内部仅在 [open, testCase.id] 变化时调用，
   * 父级可传每次渲染新建的箭头函数（ref-mutating 实现最合适）。
   */
  onDirtyChange?: (dirty: boolean) => void
  onClose: () => void
  onSave: (payload: {
    relative_image_path: string
    variables_json: string
    assertions_override_json: string
  }) => Promise<void> | void
}) {
  const {
    open,
    suiteId,
    testCase,
    schemaFields,
    suiteDefinedVarKeys,
    suiteVarHints,
    caseList,
    currentIndex,
    onRequestNavigate,
    onDirtyChange,
    onClose,
    onSave,
  } = props
  const [relativePath, setRelativePath] = useState(testCase.relative_image_path)
  const [variablesJson, setVariablesJson] = useState('')
  const [assertionsJson, setAssertionsJson] = useState(testCase.assertions_override_json ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ivRef = useRef<ImageViewerHandle | null>(null)
  const dirtyRef = useRef(false)
  /**
   * 打开弹窗时的 testCase 原始快照。dirty 比较的对象。
   * 注意：variables_json 比较时用 useEffect 合并前的 testCase.variables_json，
   * 因为 useEffect 后的 merged 可能引入了 suite defaults 的差异（这就是 bug 修复点）。
   */
  const originalRef = useRef<{
    relative_image_path: string
    variables_json: string
    assertions_override_json: string
  } | null>(null)

  /** 比较当前 state 与原始 testCase 快照，更新 dirty 标志 */
  function computeAndSetDirty(
    relPath: string,
    varsJson: string,
    assertsJson: string,
  ) {
    const orig = originalRef.current
    if (!orig) {
      dirtyRef.current = false
      return
    }
    const isDirty =
      relPath !== orig.relative_image_path ||
      varsJson !== orig.variables_json ||
      assertsJson !== orig.assertions_override_json
    if (dirtyRef.current !== isDirty) {
      dirtyRef.current = isDirty
      onDirtyChange?.(isDirty)
    }
  }

  // 初始化：当弹窗打开时，合并测试集默认值 + 用例已有变量
  useEffect(() => {
    if (!open) return
    // 先记原始 testCase 快照（基于原始 JSON，而不是合并后的）
    originalRef.current = {
      relative_image_path: testCase.relative_image_path,
      variables_json: testCase.variables_json || '{}',
      assertions_override_json: testCase.assertions_override_json ?? '',
    }
    setRelativePath(testCase.relative_image_path)
    setAssertionsJson(testCase.assertions_override_json ?? '')
    setError(null)
    const suiteDefaults = buildDefaultVariablesJson(suiteDefinedVarKeys, suiteVarHints)
    const merged = mergeVariablesJson(testCase.variables_json || '{}', suiteDefaults)
    setVariablesJson(merged)
    // 重置图片查看器
    ivRef.current?.resetView()
    // 关键修复：用"是否与原始 testCase 不一致"决定 dirty
    // 补齐默认值会让 merged 与原始 variables_json 不同 → dirty=true → 翻页会保存
    computeAndSetDirty(
      testCase.relative_image_path,
      merged,
      testCase.assertions_override_json ?? '',
    )
  }, [open, testCase.id])

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
      // 保存前检查：如果用例变量缺少测试集声明的变量，自动补充默认值
      const suiteDefaults = buildDefaultVariablesJson(suiteDefinedVarKeys, suiteVarHints)
      const merged = mergeVariablesJson(variablesJson, suiteDefaults)
      await onSave({
        relative_image_path: relativePath,
        variables_json: merged || '{}',
        assertions_override_json: assertionsJson,
      })
      // 保存成功：更新原始快照 = 当前 state
      originalRef.current = {
        relative_image_path: relativePath,
        variables_json: merged,
        assertions_override_json: assertionsJson,
      }
      dirtyRef.current = false
      onDirtyChange?.(false)
      onClose()
    } catch (e) {
      setError((e as Error).message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  /** 翻页：草稿未保存时先保存当前用例，成功后再通知父级切 */
  async function handleNavigate(direction: -1 | 1) {
    try {
      if (dirtyRef.current) {
        // 草稿未保存：先保存当前用例
        const suiteDefaults = buildDefaultVariablesJson(suiteDefinedVarKeys, suiteVarHints)
        const merged = mergeVariablesJson(variablesJson, suiteDefaults)
        await onSave({
          relative_image_path: relativePath,
          variables_json: merged || '{}',
          assertions_override_json: assertionsJson,
        })
        dirtyRef.current = false
        onDirtyChange?.(false)
      }
      await onRequestNavigate(direction)
    } catch (e) {
      setError((e as Error).message || '翻页失败')
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
            <ImageViewer
              ref={ivRef}
              src={imageUrl(suiteId, testCase.relative_image_path)}
              alt={testCase.relative_image_path}
              hasPrev={currentIndex > 0}
              hasNext={currentIndex >= 0 && currentIndex < caseList.length - 1}
              onPrev={() => void handleNavigate(-1)}
              onNext={() => void handleNavigate(1)}
            />
          </div>
          <div className="annotatorForm">
            <label>
              <span className="muted" style={{ fontSize: 12 }}>主图相对路径</span>
              <input
                value={relativePath}
                onChange={(e) => {
                  setRelativePath(e.target.value)
                  computeAndSetDirty(e.target.value, variablesJson, assertionsJson)
                }}
              />
            </label>

            <section className="annotatorCard">
              <h4>变量</h4>
              <VariableBuilder
                value={variablesJson}
                onChange={(v) => {
                  setVariablesJson(v)
                  computeAndSetDirty(relativePath, v, assertionsJson)
                }}
                knownKeys={suiteDefinedVarKeys}
                suiteVarHints={suiteVarHints}
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
                  const finalValue = !r || (Array.isArray(r.rules) && r.rules.length === 0) ? '' : next
                  setAssertionsJson(finalValue)
                  computeAndSetDirty(relativePath, variablesJson, finalValue)
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

/** 根据测试集变量声明，构建带默认值的 JSON */
function buildDefaultVariablesJson(
  suiteDefinedVarKeys: string[],
  suiteVarHints: Record<string, { type: string; enum?: string[] }>,
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {}
  for (const key of suiteDefinedVarKeys) {
    const hint = suiteVarHints[key]
    if (!hint) {
      defaults[key] = ''
    } else if (hint.type === 'boolean') {
      defaults[key] = 'false'
    } else if (hint.type === 'array') {
      defaults[key] = '[]'
    } else {
      defaults[key] = ''
    }
  }
  return defaults
}

/**
 * 将测试集默认值合并进用例变量 JSON。
 * 逻辑：如果用例变量中没有某个测试集声明的变量，则补充默认值；保留用例已有值。
 */
function mergeVariablesJson(caseJson: string, suiteDefaults: Record<string, unknown>): string {
  try {
    const parsed = JSON.parse(caseJson || '{}') as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return JSON.stringify(suiteDefaults)
    }

    const hasPartition = 'variables' in parsed || 'images' in parsed
    if (hasPartition) {
      const variables = (parsed.variables ?? {}) as Record<string, unknown>
      const mergedVars: Record<string, unknown> = { ...variables }
      for (const [k, v] of Object.entries(suiteDefaults)) {
        if (!(k in mergedVars) || mergedVars[k] === '') {
          mergedVars[k] = v
        }
      }
      const result = { ...parsed, variables: mergedVars }
      return JSON.stringify(result, null, 2)
    } else {
      const merged = { ...suiteDefaults }
      for (const [k, v] of Object.entries(parsed)) {
        if (v !== '' && v != null) {
          merged[k] = v
        }
      }
      return JSON.stringify({ variables: merged }, null, 2)
    }
  } catch {
    return JSON.stringify(suiteDefaults, null, 2)
  }
}
