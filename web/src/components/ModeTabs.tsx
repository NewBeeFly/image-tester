import type { EditorMode } from './common'

/**
 * 顶部两个 tab：「可视化 / JSON 原文」。
 * 同时显示一个可选的「美化 JSON」按钮（只有切到 json 模式时显示）。
 */
export function ModeTabs(props: {
  mode: EditorMode
  onChange: (m: EditorMode) => void
  /** 当处于 json 模式时显示美化按钮 */
  onPrettify?: () => void
  jsonError?: string | null
  leftHint?: string
}) {
  const { mode, onChange, onPrettify, jsonError, leftHint } = props
  return (
    <div className="modeTabs">
      <div className="modeTabsLeft">
        <button
          type="button"
          className={`modeTabBtn ${mode === 'visual' ? 'modeTabBtnActive' : ''}`}
          onClick={() => onChange('visual')}
        >
          可视化
        </button>
        <button
          type="button"
          className={`modeTabBtn ${mode === 'json' ? 'modeTabBtnActive' : ''}`}
          onClick={() => onChange('json')}
        >
          JSON 原文
        </button>
        {leftHint ? <span className="muted" style={{ fontSize: 12 }}>{leftHint}</span> : null}
      </div>
      <div className="modeTabsRight">
        {mode === 'json' && onPrettify ? (
          <button type="button" className="btn btnGhost" onClick={onPrettify}>
            美化 JSON
          </button>
        ) : null}
        {jsonError ? <span className="error" style={{ fontSize: 12 }}>{jsonError}</span> : null}
      </div>
    </div>
  )
}
