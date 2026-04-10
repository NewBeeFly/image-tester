import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
} from 'react'
import { flushSync } from 'react-dom'
import './App.css'
import {
  type AppConfig,
  delJson,
  getJson,
  imageUrl,
  patchJson,
  postFormData,
  postJson,
  type PromptProfile,
  type ProviderProfile,
  type ProviderType,
  type RunItemDetail,
  type TestCase,
  type TestRun,
  type TestSuite,
} from './api'
import { PROVIDER_FORM_PRESETS } from './providerPresets'

type Tab = 'providers' | 'prompts' | 'suites' | 'preview' | 'run' | 'report'

/** 单图检测页：教学用默认系统提示 */
const PREVIEW_DEFAULT_SYSTEM = '你是图像理解助手，用中文简洁回答。'

/** 用户模板示例：展示 {{img:主图}} = 单独图片块，不是拼进汉字里 */
const PREVIEW_DEFAULT_USER = `任务说明：{{var:hint}}

下一行在真实请求里会变成一个「单独的图片块」（API 里的 image_url），模型能正确识别；不是把图片编码进这段文字里。
{{img:主图}}

请用一句话说出画面里最主要的内容。`

function metadataJsonForPath(relativePath: string): string {
  return JSON.stringify(
    {
      variables: {
        hint: '可以先直接点发送，再改这句话试试',
      },
      images: {
        主图: relativePath,
      },
    },
    null,
    2,
  )
}

function isEmptyResolvedMetadata(raw: string): boolean {
  try {
    const j = JSON.parse(raw) as { variables?: unknown; images?: unknown }
    const vars = j?.variables && typeof j.variables === 'object' ? Object.keys(j.variables as object) : []
    const imgs = j?.images && typeof j.images === 'object' ? Object.keys(j.images as object) : []
    return vars.length === 0 && imgs.length === 0
  } catch {
    return true
  }
}

/** 主图输入框：若用户粘贴了本机绝对路径，提前提示（后端按「相对 image_root」解析） */
function looksLikeAbsolutePath(p: string): boolean {
  const t = p.trim()
  if (!t) return false
  if (t.startsWith('/')) return true
  return /^[A-Za-z]:[\\/]/.test(t)
}

/** Provider 默认参数 JSON → 可编辑的多行字符串 */
function prettyJsonFromProviderDefaults(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw || '{}'), null, 2)
  } catch {
    return raw.trim() || '{}'
  }
}

const defaultAssertionExample = `{
  "rules": [
    { "type": "contains", "value": "是", "caseInsensitive": true }
  ]
}`

export default function App() {
  const [tab, setTab] = useState<Tab>('providers')
  const [error, setError] = useState<string | null>(null)

  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [prompts, setPrompts] = useState<PromptProfile[]>([])
  const [suites, setSuites] = useState<TestSuite[]>([])
  const [runs, setRuns] = useState<TestRun[]>([])

  const refreshRunsOnly = useCallback(async () => {
    try {
      const rr = await getJson<TestRun[]>('/api/test-runs')
      setRuns(rr)
    } catch {
      /* 列表失败时保留旧数据 */
    }
  }, [])

  const refreshAll = useCallback(async () => {
    setError(null)
    const [rp, rpr, rs, rr] = await Promise.allSettled([
      getJson<ProviderProfile[]>('/api/provider-profiles'),
      getJson<PromptProfile[]>('/api/prompt-profiles'),
      getJson<TestSuite[]>('/api/test-suites'),
      getJson<TestRun[]>('/api/test-runs'),
    ])
    if (rp.status === 'fulfilled') setProviders(rp.value)
    if (rpr.status === 'fulfilled') setPrompts(rpr.value)
    if (rs.status === 'fulfilled') setSuites(rs.value)
    if (rr.status === 'fulfilled') setRuns(rr.value)
    const failed: string[] = []
    if (rp.status === 'rejected') failed.push(`Provider 列表: ${(rp.reason as Error).message}`)
    if (rpr.status === 'rejected') failed.push(`提示词模板: ${(rpr.reason as Error).message}`)
    if (rs.status === 'rejected') failed.push(`测试集: ${(rs.reason as Error).message}`)
    if (rr.status === 'rejected') failed.push(`运行记录: ${(rr.reason as Error).message}`)
    if (failed.length === 4) {
      setError(failed[0] ?? '无法加载数据')
    } else if (failed.length > 0) {
      setError(`部分数据未加载（单图检测等仍可能可用）：${failed.join(' | ')}`)
    }
  }, [])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    if (tab === 'report') void refreshRunsOnly()
  }, [tab, refreshRunsOnly])

  return (
    <div className={`appShell${tab === 'preview' ? ' appShell--previewWide' : ''}`}>
      <header className="topBar">
        <div>
          <h1 className="title">图片 Agent 测试平台</h1>
          <p className="muted" style={{ margin: '4px 0 0', textAlign: 'left' }}>
            本机批量调用视觉大模型、配置断言并统计正确率。请先启动后端（默认端口 8787）。
          </p>
        </div>
        <button type="button" className="btn" onClick={() => void refreshAll()}>
          刷新数据
        </button>
      </header>

      <nav className="tabs" aria-label="主导航">
        {(
          [
            ['providers', 'Provider 设置'],
            ['prompts', '提示词模板'],
            ['suites', '测试集与用例'],
            ['preview', '单图检测'],
            ['run', '批量运行'],
            ['report', '报告与失败复盘'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`tab ${tab === id ? 'tabActive' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {error ? <p className="error">{error}</p> : null}

      {tab === 'providers' ? (
        <ProvidersSection
          items={providers}
          onChange={() => void refreshAll()}
          onError={setError}
        />
      ) : null}
      {tab === 'prompts' ? (
        <PromptsSection items={prompts} onChange={() => void refreshAll()} onError={setError} />
      ) : null}
      {tab === 'suites' ? (
        <SuitesSection suites={suites} onChange={() => void refreshAll()} onError={setError} />
      ) : null}
      {tab === 'preview' ? (
        <PreviewSection
          suites={suites}
          providers={providers}
          prompts={prompts}
          onError={setError}
        />
      ) : null}
      {tab === 'run' ? (
        <RunSection
          suites={suites}
          providers={providers}
          prompts={prompts}
          onStarted={() => void refreshAll()}
          onError={setError}
        />
      ) : null}
      {tab === 'report' ? (
        <ReportSection
          runs={runs}
          suites={suites}
          providers={providers}
          prompts={prompts}
          onRefreshRunsList={refreshRunsOnly}
          onError={setError}
        />
      ) : null}
    </div>
  )
}

function emptyProviderForm() {
  const p = PROVIDER_FORM_PRESETS.openai_compatible
  return {
    name: p.suggestedName,
    provider_type: 'openai_compatible' as ProviderType,
    base_url: p.base_url,
    api_key_env: p.api_key_env,
    default_model: p.default_model,
    default_params_json: p.default_params_json,
  }
}

function ProvidersSection(props: {
  items: ProviderProfile[]
  onChange: () => void
  onError: (m: string | null) => void
}) {
  const [form, setForm] = useState(emptyProviderForm)
  const [editingId, setEditingId] = useState<number | null>(null)

  function cancelEdit() {
    setEditingId(null)
    setForm(emptyProviderForm())
  }

  function startEdit(row: ProviderProfile) {
    setEditingId(row.id)
    setForm({
      name: row.name,
      provider_type: row.provider_type,
      base_url: row.base_url,
      api_key_env: row.api_key_env,
      default_model: row.default_model,
      default_params_json: row.default_params_json || '{}',
    })
  }

  async function save() {
    props.onError(null)
    try {
      const body = {
        ...form,
        default_params_json: form.default_params_json || '{}',
      }
      if (editingId != null) {
        await patchJson(`/api/provider-profiles/${editingId}`, body)
      } else {
        await postJson('/api/provider-profiles', body)
      }
      cancelEdit()
      props.onChange()
    } catch (e) {
      props.onError((e as Error).message)
    }
  }

  return (
    <div className="panel">
      <h2>{editingId != null ? `编辑 Provider 档案 #${editingId}` : '新增 Provider 档案'}</h2>
      <p className="muted">
        切换「厂商类型」会自动填入该厂商常用的 Base URL、密钥环境变量名与默认模型；仍可手动修改。
      </p>
      <div className="row row2">
        <div>
          <label>名称</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label>厂商类型（影响展示；调用均为 OpenAI 兼容协议）</label>
          <select
            value={form.provider_type}
            onChange={(e) => {
              const t = e.target.value as ProviderType
              const p = PROVIDER_FORM_PRESETS[t]
              setForm({
                name: p.suggestedName,
                provider_type: t,
                base_url: p.base_url,
                api_key_env: p.api_key_env,
                default_model: p.default_model,
                default_params_json: p.default_params_json,
              })
            }}
          >
            <option value="openai_compatible">OpenAI / 通用兼容</option>
            <option value="dashscope">阿里云 DashScope（兼容模式）</option>
            <option value="volcengine">火山引擎方舟（兼容模式）</option>
          </select>
        </div>
      </div>
      <div className="row">
        <label>Base URL</label>
        <input value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} />
        {PROVIDER_FORM_PRESETS[form.provider_type].baseUrlHint ? (
          <p className="muted" style={{ marginTop: 6, textAlign: 'left' }}>
            {PROVIDER_FORM_PRESETS[form.provider_type].baseUrlHint}
          </p>
        ) : null}
      </div>
      <div className="row row2">
        <div>
          <label>API Key 环境变量名（勿在页面填写密钥明文）</label>
          <input
            value={form.api_key_env}
            onChange={(e) => setForm({ ...form, api_key_env: e.target.value })}
          />
        </div>
        <div>
          <label>默认模型</label>
          <input
            value={form.default_model}
            onChange={(e) => setForm({ ...form, default_model: e.target.value })}
          />
        </div>
      </div>
      <div className="row">
        <label>默认参数 JSON（会合并到每次请求，可被运行页覆盖）</label>
        <textarea
          value={form.default_params_json}
          onChange={(e) => setForm({ ...form, default_params_json: e.target.value })}
        />
      </div>
      <details className="muted" style={{ textAlign: 'left', marginTop: 8 }}>
        <summary style={{ cursor: 'pointer' }}>火山方舟：thinking / response_format 怎么写？</summary>
        <p style={{ marginTop: 8 }}>
          方舟兼容 OpenAI SDK，请求体会 JSON 原样提交。可与 OpenAI 一样写{' '}
          <span className="mono">response_format</span>；<span className="mono">thinking</span> 等扩展字段写在同一层即可。需要单独维护一批扩展字段时可用{' '}
          <span className="mono">request_body_extra</span> 对象（详见根目录 README）。
        </p>
        <pre
          className="mono"
          style={{
            margin: '8px 0 0',
            padding: 12,
            background: '#0b0d12',
            borderRadius: 8,
            border: '1px solid var(--border)',
            textAlign: 'left',
            overflow: 'auto',
          }}
        >
          {`{
  "temperature": 0.2,
  "response_format": { "type": "json_object" },
  "thinking": { "type": "disabled" }
}`}
        </pre>
        <p style={{ marginTop: 8 }}>
          视觉模型示例：<span className="mono">doubao-seed-1-6-vision-250815</span>（更多见 README 表格）。
        </p>
      </details>
      <div className="actions">
        <button type="button" className="btn btnPrimary" onClick={() => void save()}>
          {editingId != null ? '保存修改' : '保存档案'}
        </button>
        {editingId != null ? (
          <button type="button" className="btn" onClick={cancelEdit}>
            取消编辑
          </button>
        ) : null}
      </div>

      <h2 style={{ marginTop: 24 }}>已有档案</h2>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>名称</th>
              <th>类型</th>
              <th>Base URL</th>
              <th>密钥变量</th>
              <th>模型</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {props.items.map((p) => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td>{p.name}</td>
                <td>{p.provider_type}</td>
                <td className="mono">{p.base_url}</td>
                <td className="mono">{p.api_key_env}</td>
                <td className="mono">{p.default_model}</td>
                <td>
                  <div className="actions" style={{ marginTop: 0 }}>
                    <button type="button" className="btn" onClick={() => startEdit(p)}>
                      编辑
                    </button>
                    <button
                      type="button"
                      className="btn btnDanger"
                      onClick={() => void delJson(`/api/provider-profiles/${p.id}`).then(props.onChange)}
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function emptyPromptForm() {
  return {
    name: '默认视觉描述',
    system_prompt: '你是严谨的图像理解助手，请用中文简洁回答。',
    user_prompt_template: '请描述图片中的主要物体，并判断是否包含文字：{{hint}}',
    notes: '',
  }
}

function PromptsSection(props: {
  items: PromptProfile[]
  onChange: () => void
  onError: (m: string | null) => void
}) {
  const [form, setForm] = useState(emptyPromptForm)
  const [editingId, setEditingId] = useState<number | null>(null)

  function cancelEdit() {
    setEditingId(null)
    setForm(emptyPromptForm())
  }

  function startEdit(row: PromptProfile) {
    setEditingId(row.id)
    setForm({
      name: row.name,
      system_prompt: row.system_prompt,
      user_prompt_template: row.user_prompt_template,
      notes: row.notes,
    })
  }

  async function save() {
    props.onError(null)
    try {
      if (editingId != null) {
        await patchJson(`/api/prompt-profiles/${editingId}`, form)
      } else {
        await postJson('/api/prompt-profiles', form)
      }
      cancelEdit()
      props.onChange()
    } catch (e) {
      props.onError((e as Error).message)
    }
  }

  return (
    <div className="panel">
      <h2>{editingId != null ? `编辑提示词模板 #${editingId}` : '新增提示词模板'}</h2>
      <p className="muted">
        模板中可使用 <span className="mono">{'{{var:键}}'}</span> 或 <span className="mono">{'{{键}}'}</span> 引用用例元数据；插入多图使用{' '}
        <span className="mono">{'{{img:别名}}'}</span>（需在元数据 <span className="mono">images</span> 里配置路径）。详见「单图检测」与 README。
      </p>
      <div className="row">
        <label>名称</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="row">
        <label>系统提示词</label>
        <textarea
          value={form.system_prompt}
          onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
        />
      </div>
      <div className="row">
        <label>用户提示词模板</label>
        <textarea
          value={form.user_prompt_template}
          onChange={(e) => setForm({ ...form, user_prompt_template: e.target.value })}
        />
      </div>
      <div className="row">
        <label>备注</label>
        <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>
      <div className="actions">
        <button type="button" className="btn btnPrimary" onClick={() => void save()}>
          {editingId != null ? '保存修改' : '保存模板'}
        </button>
        {editingId != null ? (
          <button type="button" className="btn" onClick={cancelEdit}>
            取消编辑
          </button>
        ) : null}
      </div>

      <h2 style={{ marginTop: 24 }}>已有模板</h2>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>名称</th>
              <th>用户模板摘要</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {props.items.map((p) => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td>{p.name}</td>
                <td className="mono">{p.user_prompt_template.slice(0, 80)}</td>
                <td>
                  <div className="actions" style={{ marginTop: 0 }}>
                    <button type="button" className="btn" onClick={() => startEdit(p)}>
                      编辑
                    </button>
                    <button
                      type="button"
                      className="btn btnDanger"
                      onClick={() => void delJson(`/api/prompt-profiles/${p.id}`).then(props.onChange)}
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function emptySuiteForm() {
  return {
    name: '示例测试集',
    /** 托管在「测试集根目录」下的子文件夹名 */
    managed_subdir: 'example-suite',
    default_assertions_json: defaultAssertionExample,
  }
}

function emptyCaseForm() {
  return {
    relative_image_path: 'demo/sample.png',
    variables_json: '{\n  "hint": "如有文字请指出关键词"\n}',
    assertions_override_json: '',
  }
}

function SuitesSection(props: {
  suites: TestSuite[]
  onChange: () => void
  onError: (m: string | null) => void
}) {
  const [suiteForm, setSuiteForm] = useState(emptySuiteForm)
  const [suiteEditingId, setSuiteEditingId] = useState<number | null>(null)
  const [suiteId, setSuiteId] = useState<number | null>(null)
  const [cases, setCases] = useState<TestCase[]>([])
  const [caseForm, setCaseForm] = useState(emptyCaseForm)
  const [caseEditingId, setCaseEditingId] = useState<number | null>(null)
  const [scanDir, setScanDir] = useState('')
  const [scanPaths, setScanPaths] = useState<string[]>([])
  const [selectedScan, setSelectedScan] = useState<Record<string, boolean>>({})
  const [suiteParentDir, setSuiteParentDir] = useState('')

  // 上传相关：三卡片各自的状态
  const [uploadDirOptions, setUploadDirOptions] = useState<string[]>([])
  const [folderTargetDir, setFolderTargetDir] = useState('')
  const [folderTip, setFolderTip] = useState('')
  const [imgTargetDir, setImgTargetDir] = useState('')
  const [imgTip, setImgTip] = useState('')
  const [jsonOverrideTip, setJsonOverrideTip] = useState('')

  const imgUploadRef = useRef<HTMLInputElement>(null)
  const folderUploadRef = useRef<HTMLInputElement>(null)
  const jsonOverrideRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void getJson<AppConfig>('/api/config')
      .then((c) => setSuiteParentDir(c.suite_parent_dir))
      .catch(() => setSuiteParentDir(''))
  }, [])

  const dataSuiteId = suiteEditingId ?? suiteId

  const activeSuite = useMemo(
    () => props.suites.find((s) => s.id === dataSuiteId) ?? null,
    [props.suites, dataSuiteId],
  )

  /** 加载服务器 image_root 下子目录列表 */
  const refreshDirOptions = useCallback(async (sid: number) => {
    try {
      const r = await getJson<{ dirs: string[] }>(`/api/test-suites/${sid}/list-dirs`)
      setUploadDirOptions(r.dirs)
    } catch {
      setUploadDirOptions([])
    }
  }, [])

  async function refreshCases(id: number) {
    const list = await getJson<TestCase[]>(`/api/test-suites/${id}/cases`)
    setCases(list)
  }

  useEffect(() => {
    if (dataSuiteId != null) {
      void refreshCases(dataSuiteId).catch(() => { /* ignore */ })
      void refreshDirOptions(dataSuiteId)
    } else {
      setCases([])
      setUploadDirOptions([])
    }
    setCaseEditingId(null)
    setCaseForm(emptyCaseForm())
    setFolderTip('')
    setImgTip('')
    setJsonOverrideTip('')
  }, [dataSuiteId])

  function beginNewSuite() {
    setSuiteEditingId(null)
    setSuiteId(null)
    setSuiteForm(emptySuiteForm())
    props.onError(null)
  }

  function loadSuiteIntoForm(s: TestSuite) {
    setSuiteEditingId(s.id)
    setSuiteId(s.id)
    setSuiteForm({
      name: s.name,
      managed_subdir: '',
      default_assertions_json: s.default_assertions_json,
    })
    props.onError(null)
  }

  function startEditSuite(s: TestSuite) {
    loadSuiteIntoForm(s)
  }

  async function createSuiteFromForm(): Promise<TestSuite> {
    const default_assertions_json = suiteForm.default_assertions_json || '{"rules":[]}'
    if (!suiteForm.name.trim()) {
      throw new Error('请填写测试集名称')
    }
    const managed_subdir = suiteForm.managed_subdir.trim()
    if (!managed_subdir) {
      throw new Error('请填写「子目录名」')
    }
    return postJson<TestSuite>('/api/test-suites', {
      name: suiteForm.name,
      managed_subdir,
      default_assertions_json,
    })
  }

  async function resolveSuiteIdForOperation(): Promise<number> {
    const existing = suiteEditingId ?? suiteId
    if (existing != null) return existing
    const row = await createSuiteFromForm()
    setSuiteEditingId(row.id)
    setSuiteId(row.id)
    setSuiteForm({
      name: row.name,
      managed_subdir: '',
      default_assertions_json: row.default_assertions_json,
    })
    props.onChange()
    return row.id
  }

  async function saveSuite() {
    props.onError(null)
    try {
      if (suiteEditingId != null) {
        const default_assertions_json = suiteForm.default_assertions_json || '{"rules":[]}'
        await patchJson(`/api/test-suites/${suiteEditingId}`, {
          name: suiteForm.name,
          default_assertions_json,
        })
        props.onChange()
        return
      }
      const row = await createSuiteFromForm()
      setSuiteEditingId(row.id)
      setSuiteId(row.id)
      setSuiteForm({
        name: row.name,
        managed_subdir: '',
        default_assertions_json: row.default_assertions_json,
      })
      props.onChange()
    } catch (e) {
      props.onError((e as Error).message)
    }
  }

  function cancelCaseEdit() {
    setCaseEditingId(null)
    setCaseForm(emptyCaseForm())
  }

  function startEditCase(c: TestCase) {
    setCaseEditingId(c.id)
    const rawVars = c.variables_json || '{}'
    let pretty = rawVars
    try {
      pretty = JSON.stringify(JSON.parse(rawVars) as object, null, 2)
    } catch { /* keep raw */ }
    setCaseForm({
      relative_image_path: c.relative_image_path,
      variables_json: pretty,
      assertions_override_json: c.assertions_override_json ?? '',
    })
  }

  async function saveCase() {
    if (dataSuiteId == null) {
      props.onError('请先保存测试集或选择已有测试集')
      return
    }
    props.onError(null)
    try {
      const payload = {
        relative_image_path: caseForm.relative_image_path,
        variables_json: caseForm.variables_json || '{}',
        assertions_override_json: caseForm.assertions_override_json.trim()
          ? caseForm.assertions_override_json
          : null,
      }
      if (caseEditingId != null) {
        await patchJson(`/api/test-cases/${caseEditingId}`, payload)
      } else {
        await postJson(`/api/test-suites/${dataSuiteId}/cases`, payload)
      }
      cancelCaseEdit()
      await refreshCases(dataSuiteId)
    } catch (e) {
      props.onError((e as Error).message)
    }
  }

  async function scan() {
    let targetId: number
    try {
      targetId = await resolveSuiteIdForOperation()
    } catch (e) {
      props.onError((e as Error).message)
      return
    }
    props.onError(null)
    try {
      const q = new URLSearchParams()
      if (scanDir.trim()) q.set('relative_dir', scanDir.trim())
      const res = await getJson<{ paths: string[] }>(
        `/api/test-suites/${targetId}/scan-images?${q.toString()}`,
      )
      setScanPaths(res.paths)
      const sel: Record<string, boolean> = {}
      for (const p of res.paths) sel[p] = true
      setSelectedScan(sel)
    } catch (e) {
      props.onError((e as Error).message)
    }
  }

  async function importSelected() {
    if (dataSuiteId == null) return
    const paths = scanPaths.filter((p) => selectedScan[p])
    if (!paths.length) return
    props.onError(null)
    try {
      await postJson(`/api/test-suites/${dataSuiteId}/cases/bulk-import`, { relative_paths: paths })
      await refreshCases(dataSuiteId)
      props.onChange()
    } catch (e) {
      props.onError((e as Error).message)
    }
  }

  /** 卡片A：上传整个文件夹（图片+JSON），上传后自动扫描 + 导入（变量从磁盘JSON写入DB） */
  async function uploadFolderAndImport() {
    let targetId: number
    try {
      targetId = await resolveSuiteIdForOperation()
    } catch (e) {
      props.onError((e as Error).message)
      return
    }
    const input = folderUploadRef.current
    const raw = input?.files
    if (!raw?.length) {
      props.onError('请先选择文件夹')
      return
    }
    props.onError(null)
    setFolderTip('上传中…')
    const fd = new FormData()
    fd.append('relative_dir', folderTargetDir.trim())
    let n = 0
    for (const f of Array.from(raw)) {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
      if (rel.includes('..')) continue
      const segments = rel.split(/[/\\]/).filter(Boolean)
      if (segments.some((s) => s.startsWith('.'))) continue
      if (!/\.(png|jpe?g|webp|gif|bmp|json)$/i.test(f.name.toLowerCase())) continue
      fd.append('files', f, rel)
      n++
    }
    if (n === 0) {
      props.onError('文件夹内没有可上传的图片或 .json')
      setFolderTip('')
      return
    }
    try {
      const r = await postFormData<{
        uploaded: Array<{ relative_path: string; bytes: number }>
        errors: Array<{ filename: string; message: string }>
      }>(`/api/test-suites/${targetId}/upload`, fd)
      const ok = r.uploaded.length
      const bad = (r.errors ?? []).length
      setFolderTip(`上传完成：${ok} 个成功${bad ? `，${bad} 个失败` : ''}。正在扫描并导入…`)
      if (input) input.value = ''
      // 扫描图片并全部导入，导入时后端会从磁盘JSON读变量写DB
      const scanRes = await getJson<{ paths: string[] }>(`/api/test-suites/${targetId}/scan-images`)
      if (scanRes.paths.length) {
        const importRes = await postJson<{ inserted: number; skipped: number }>(
          `/api/test-suites/${targetId}/cases/bulk-import`,
          { relative_paths: scanRes.paths },
        )
        setFolderTip(`完成：上传 ${ok} 个文件，导入 ${importRes.inserted} 条用例（跳过已存在 ${importRes.skipped} 条）`)
      } else {
        setFolderTip(`上传 ${ok} 个文件，未扫描到图片，请检查文件夹内容`)
      }
      await refreshCases(targetId)
      await refreshDirOptions(targetId)
      props.onChange()
    } catch (e) {
      props.onError((e as Error).message)
      setFolderTip('')
    }
  }

  /** 卡片B：单独上传图片并自动写入数据库（variables 为空，方便后续用卡片C覆盖变量） */
  async function uploadImages() {
    let targetId: number
    try {
      targetId = await resolveSuiteIdForOperation()
    } catch (e) {
      props.onError((e as Error).message)
      return
    }
    const input = imgUploadRef.current
    const raw = input?.files
    if (!raw?.length) {
      props.onError('请先选择要上传的图片')
      return
    }
    const list = Array.from(raw).filter((f) => /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name))
    if (!list.length) {
      props.onError('请选择常见图片（png / jpg / jpeg / webp / gif / bmp）')
      return
    }
    props.onError(null)
    setImgTip('上传中…')
    try {
      const fd = new FormData()
      fd.append('relative_dir', imgTargetDir.trim())
      for (const f of list) {
        const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
        fd.append('files', f, rel)
      }
      const r = await postFormData<{
        uploaded: Array<{ relative_path: string; bytes: number }>
        errors: Array<{ filename: string; message: string }>
      }>(`/api/test-suites/${targetId}/upload`, fd)
      const ok = r.uploaded.length
      const bad = (r.errors ?? []).length
      setImgTip(`上传完成：${ok} 张成功${bad ? `，${bad} 张失败` : ''}。正在导入到数据库…`)
      if (input) input.value = ''
      await refreshDirOptions(targetId)
      // 仅扫描刚上传的目录，避免全量扫描太慢
      const q = new URLSearchParams()
      if (imgTargetDir.trim()) q.set('relative_dir', imgTargetDir.trim())
      const scanRes = await getJson<{ paths: string[] }>(`/api/test-suites/${targetId}/scan-images?${q.toString()}`)
      if (scanRes.paths.length) {
        const importRes = await postJson<{ inserted: number; skipped: number }>(
          `/api/test-suites/${targetId}/cases/bulk-import`,
          { relative_paths: scanRes.paths },
        )
        setImgTip(`完成：上传 ${ok} 张，导入 ${importRes.inserted} 条用例（跳过已存在 ${importRes.skipped} 条）`)
      } else {
        setImgTip(`上传 ${ok} 张，扫描未发现图片，请检查目录`)
      }
      await refreshCases(targetId)
      props.onChange()
    } catch (e) {
      props.onError((e as Error).message)
      setImgTip('')
    }
  }

  /** 卡片C：用 JSON 文件覆盖已有用例的变量 */
  async function overrideFromJson() {
    if (dataSuiteId == null) {
      props.onError('请先选择测试集')
      return
    }
    const input = jsonOverrideRef.current
    const raw = input?.files
    if (!raw?.length) {
      props.onError('请先选择 JSON 文件')
      return
    }
    props.onError(null)
    setJsonOverrideTip('覆盖中…')
    try {
      const fd = new FormData()
      fd.append('file', raw[0])
      const r = await postFormData<{ updated: number; not_found: string[] }>(
        `/api/test-suites/${dataSuiteId}/cases/override-from-json`,
        fd,
      )
      let tip = `覆盖完成：更新 ${r.updated} 条用例`
      if (r.not_found.length) {
        const sample = r.not_found.slice(0, 3).join('、')
        const more = r.not_found.length > 3 ? `…等 ${r.not_found.length} 条` : ''
        tip += `\n⚠️ ${r.not_found.length} 条路径在数据库中不存在（${sample}${more}）`
        if (r.updated === 0) {
          tip += '\n\n💡 提示：卡片 C 只能更新已入库的用例。请先用下方「扫描图片 → 导入选中」把图片导入到数据库，再来覆盖变量。或直接使用卡片 A（整文件夹导入），一步完成上传+导入+写入变量。'
        }
      }
      setJsonOverrideTip(tip)
      if (input) input.value = ''
      await refreshCases(dataSuiteId)
    } catch (e) {
      props.onError((e as Error).message)
      setJsonOverrideTip('')
    }
  }

  return (
    <div className="panel">
      <h2>测试集</h2>
      <p className="muted">
        顶部选择「新建」或已有测试集；中间按顺序填写目录、（可选）上传文件；<strong>最下方「保存测试集」</strong>把名称、图片根目录与默认断言写入数据库。断言为 JSON：{' '}
        <span className="mono">{'{ "rules": [ ... ] }'}</span>。
      </p>
      {/* 顶部：测试集选择器 + 状态 badge */}
      <div className="suiteHeader">
        <div className="suiteHeaderSelect">
          <label className="suiteHeaderLabel">当前测试集</label>
          <select
            className="suiteHeaderDropdown"
            value={suiteId ?? ''}
            onChange={(e) => {
              const v = e.target.value
              if (!v) { beginNewSuite(); return }
              const s = props.suites.find((x) => x.id === Number(v))
              if (s) loadSuiteIntoForm(s)
            }}
          >
            <option value="">— 新建测试集 —</option>
            {props.suites.map((s) => (
              <option key={s.id} value={s.id}>{s.id} · {s.name}</option>
            ))}
          </select>
        </div>
        <span className={suiteEditingId != null ? 'suiteBadge suiteBadge--editing' : 'suiteBadge suiteBadge--new'}>
          {suiteEditingId != null
            ? `编辑中 #${suiteEditingId}${activeSuite ? ` · ${activeSuite.name}` : ''}`
            : '新建（未入库）'}
        </span>
      </div>

      {/* 共用根目录信息栏 */}
      <div className="suiteRootBar">
        <span className="suiteRootLabel">根目录</span>
        <span className="suiteRootPath mono">{suiteParentDir || '加载中…'}</span>
        <span
          className="suiteRootHint"
          title="可复制 image-tester.config.example.json 为 image-tester.config.json，修改 suiteParentDir 字段；或设置环境变量 IMAGE_TESTER_SUITE_ROOT"
        >
          ⓘ 如何修改？
        </span>
      </div>

      <h3 className="suiteSectionTitle">名称与目录</h3>
      <div className="row">
        <label>名称</label>
        <input value={suiteForm.name} onChange={(e) => setSuiteForm({ ...suiteForm, name: e.target.value })} />
      </div>
      {suiteEditingId != null ? (
        <div className="row">
          <label>图片根目录 image_root</label>
          <input className="mono" value={activeSuite?.image_root ?? ''} readOnly />
        </div>
      ) : (
        <div className="row">
          <label>子目录名（将创建在「测试集根目录」下）</label>
          <input
            value={suiteForm.managed_subdir}
            onChange={(e) => setSuiteForm({ ...suiteForm, managed_subdir: e.target.value })}
            placeholder="例如 storefront-2026，勿含 / 或 .."
          />
        </div>
      )}
      <div className="row">
        <label>默认断言 JSON</label>
        <textarea
          value={suiteForm.default_assertions_json}
          onChange={(e) => setSuiteForm({ ...suiteForm, default_assertions_json: e.target.value })}
        />
      </div>

      <h3 className="suiteSectionTitle">导入资源</h3>
      <p className="muted">
        三种方式将图片与变量导入到测试集。<strong>导入时会自动从 metadata.json 读取变量写入数据库</strong>，之后运行只用数据库里的值。
      </p>

      {/* 卡片A：文件夹导入 */}
      <div className="uploadCard">
        <div className="uploadCardTitle">A · 整文件夹导入（图片 + JSON 一起）</div>
        <p className="muted" style={{ marginBottom: 8 }}>
          选择本地文件夹上传，服务器会自动从 <span className="mono">metadata.json</span> / 侧车 <span className="mono">.json</span> 读取变量，一并写入数据库。
        </p>
        <div className="row row2">
          <div>
            <label>目标子目录（可选，相对 image_root）</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <select
                value={folderTargetDir}
                onChange={(e) => setFolderTargetDir(e.target.value)}
                style={{ flex: 1 }}
              >
                <option value="">根目录</option>
                {uploadDirOptions.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <input
                value={folderTargetDir}
                onChange={(e) => setFolderTargetDir(e.target.value)}
                placeholder="或手动输入"
                style={{ flex: 1 }}
              />
            </div>
          </div>
        </div>
        <div className="row row2">
          <div>
            <label>选择本地文件夹</label>
            <input
              ref={folderUploadRef}
              type="file"
              multiple
              {...({ webkitdirectory: '' } as InputHTMLAttributes<HTMLInputElement>)}
            />
          </div>
          <div className="actions" style={{ alignSelf: 'end' }}>
            <button type="button" className="btn btnPrimary" onClick={() => void uploadFolderAndImport()}>
              上传并导入
            </button>
          </div>
        </div>
        {folderTip ? (
          <pre className="muted" style={{ whiteSpace: 'pre-wrap', fontSize: 13, marginTop: 6 }}>{folderTip}</pre>
        ) : null}
      </div>

      {/* 卡片B：单独上传图片 */}
      <div className="uploadCard">
        <div className="uploadCardTitle">B · 单独上传图片</div>
        <p className="muted" style={{ marginBottom: 8 }}>
          上传图片并自动写入数据库，变量为空 <span className="mono">{'{}'}</span>。之后可用卡片 C 上传 metadata.json 覆盖变量。
        </p>
        <div className="row row2">
          <div>
            <label>目标子目录（可选）</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <select
                value={imgTargetDir}
                onChange={(e) => setImgTargetDir(e.target.value)}
                style={{ flex: 1 }}
              >
                <option value="">根目录</option>
                {uploadDirOptions.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <input
                value={imgTargetDir}
                onChange={(e) => setImgTargetDir(e.target.value)}
                placeholder="或手动输入"
                style={{ flex: 1 }}
              />
            </div>
          </div>
        </div>
        <div className="row row2">
          <div>
            <label>选择图片（可多选）</label>
            <input ref={imgUploadRef} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" />
          </div>
          <div className="actions" style={{ alignSelf: 'end' }}>
            <button type="button" className="btn btnPrimary" onClick={() => void uploadImages()}>
              上传图片
            </button>
          </div>
        </div>
        {imgTip ? (
          <pre className="muted" style={{ whiteSpace: 'pre-wrap', fontSize: 13, marginTop: 6 }}>{imgTip}</pre>
        ) : null}
      </div>

      {/* 卡片C：JSON 覆盖变量 */}
      <div className="uploadCard">
        <div className="uploadCardTitle">C · 用 JSON 覆盖已有用例变量</div>
        <p className="muted" style={{ marginBottom: 8 }}>
          选择 <span className="mono">metadata.json</span> 格式文件（<span className="mono">{"{ \"图片路径\": { variables, images } }"}</span>），将匹配到的用例变量覆盖写入数据库。<strong>只更新已存在用例，不新增。</strong><br />
          <span style={{ color: 'var(--accent)' }}>⚠️ 前提：图片必须已通过卡片 A 导入或扫描导入过，否则 DB 里没有对应用例，覆盖会显示「未匹配」。</span>
        </p>
        <div className="row row2">
          <div>
            <label>选择 JSON 文件</label>
            <input ref={jsonOverrideRef} type="file" accept=".json,application/json" />
          </div>
          <div className="actions" style={{ alignSelf: 'end' }}>
            <button type="button" className="btn btnPrimary" onClick={() => void overrideFromJson()}>
              覆盖变量
            </button>
          </div>
        </div>
        {jsonOverrideTip ? (
          <pre className="muted" style={{ whiteSpace: 'pre-wrap', fontSize: 13, marginTop: 6 }}>{jsonOverrideTip}</pre>
        ) : null}
      </div>

      <div className="suiteSaveBlock">
        <h3 className="suiteSectionTitle" style={{ marginTop: 0 }}>
          保存到数据库
        </h3>
        <p className="suiteSaveHint">
          点击后将当前表单中的<strong>名称</strong>、<strong>图片根目录 image_root</strong>、<strong>默认断言</strong>写入数据库。推荐顺序：先确认名称与目录 → 再上传（或先上传也可）→
          最后在此处保存；若只上传未保存，名称/断言仍以表单为准，修改后请再保存一次。
        </p>
        <div className="actions">
          <button type="button" className="btn btnPrimary" onClick={() => void saveSuite()}>
            {suiteEditingId != null ? '保存测试集修改' : '保存测试集'}
          </button>
          <button type="button" className="btn" onClick={beginNewSuite}>
            清空新建
          </button>
        </div>
      </div>

      <h2 style={{ marginTop: 24 }}>已有测试集</h2>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>名称</th>
              <th>image_root</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {props.suites.map((s) => (
              <tr key={s.id}>
                <td>{s.id}</td>
                <td>{s.name}</td>
                <td className="mono">{s.image_root}</td>
                <td>
                  <div className="actions" style={{ marginTop: 0 }}>
                    <button type="button" className="btn" onClick={() => startEditSuite(s)}>
                      编辑
                    </button>
                    <button
                      type="button"
                      className="btn btnDanger"
                      onClick={() =>
                        void (async () => {
                          props.onError(null)
                          try {
                            await delJson<{ ok: boolean }>(`/api/test-suites/${s.id}`)
                            if (suiteId === s.id || suiteEditingId === s.id) beginNewSuite()
                            props.onChange()
                          } catch (e) {
                            props.onError((e as Error).message)
                          }
                        })()
                      }
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: 24 }}>用例与扫描</h2>
      <p className="muted">
        当前 image_root：<span className="mono">{activeSuite?.image_root ?? '（请先保存测试集、上传，或从上方选择已有测试集）'}</span>
      </p>

      {dataSuiteId != null ? (
        <>
          <h3 className="muted">从目录扫描并导入</h3>
          <div className="row row2">
            <div>
              <label>子目录（可选，相对 image_root）</label>
              <input value={scanDir} onChange={(e) => setScanDir(e.target.value)} placeholder="例如 scenes/batch1" />
            </div>
            <div className="actions" style={{ alignSelf: 'end' }}>
              <button type="button" className="btn" onClick={() => void scan()}>
                扫描图片
              </button>
              <button type="button" className="btn btnPrimary" onClick={() => void importSelected()}>
                导入选中
              </button>
            </div>
          </div>
          {scanPaths.length ? (
            <div className="scanList">
              {scanPaths.map((p) => (
                <div key={p} className="scanRow">
                  <input
                    type="checkbox"
                    checked={Boolean(selectedScan[p])}
                    onChange={(e) => setSelectedScan({ ...selectedScan, [p]: e.target.checked })}
                  />
                  <span className="mono">{p}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">扫描结果会显示在此处（最多约 500 张）。</p>
          )}

          <h3 className="muted">手动添加单条用例</h3>
          <div className="row">
            <label>图片相对路径（相对 image_root）</label>
            <input
              value={caseForm.relative_image_path}
              onChange={(e) => setCaseForm({ ...caseForm, relative_image_path: e.target.value })}
            />
          </div>
          <div className="row">
            <label>
              变量 variables_json（直接存储于数据库；运行时使用此值）
            </label>
            <textarea
              value={caseForm.variables_json}
              onChange={(e) => setCaseForm({ ...caseForm, variables_json: e.target.value })}
            />
          </div>
          <div className="row">
            <label>用例级断言覆盖（可留空则使用测试集默认）</label>
            <textarea
              value={caseForm.assertions_override_json}
              onChange={(e) => setCaseForm({ ...caseForm, assertions_override_json: e.target.value })}
            />
          </div>
          <div className="actions">
            <button type="button" className="btn btnPrimary" onClick={() => void saveCase()}>
              {caseEditingId != null ? '保存用例修改' : '添加用例'}
            </button>
            {caseEditingId != null ? (
              <button type="button" className="btn" onClick={cancelCaseEdit}>
                取消用例编辑
              </button>
            ) : null}
          </div>

          <h3 className="muted">用例列表</h3>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>图片</th>
                  <th>variables</th>
                  <th>预览</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.id}>
                    <td>{c.id}</td>
                    <td className="mono">{c.relative_image_path}</td>
                    <td className="mono">{c.variables_json}</td>
                    <td>
                      <img
                        className="thumb"
                        alt=""
                        src={imageUrl(dataSuiteId!, c.relative_image_path)}
                        loading="lazy"
                      />
                    </td>
                    <td>
                      <div className="actions" style={{ marginTop: 0 }}>
                        <button type="button" className="btn" onClick={() => startEditCase(c)}>
                          编辑
                        </button>
                        <button
                          type="button"
                          className="btn btnDanger"
                          onClick={() =>
                            void (async () => {
                              props.onError(null)
                              try {
                                await delJson<{ ok: boolean }>(`/api/test-cases/${c.id}`)
                                await refreshCases(dataSuiteId)
                              } catch (e) {
                                props.onError((e as Error).message)
                              }
                            })()
                          }
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="muted">请从上方选择已有测试集，或填写表单后保存 / 直接上传资源，即可配置用例与扫描。</p>
      )}
    </div>
  )
}

interface VisionPreviewResponse {
  text: string
  raw: unknown
  variables_snapshot: Record<string, string>
}

function PreviewSection(props: {
  suites: TestSuite[]
  providers: ProviderProfile[]
  prompts: PromptProfile[]
  onError: (m: string | null) => void
}) {
  const [suiteId, setSuiteId] = useState<number | ''>('')
  const [cases, setCases] = useState<TestCase[]>([])
  const [relativePath, setRelativePath] = useState('')
  const [metadataJson, setMetadataJson] = useState('{\n  "variables": {},\n  "images": {}\n}')
  const [systemPrompt, setSystemPrompt] = useState(PREVIEW_DEFAULT_SYSTEM)
  const [userPrompt, setUserPrompt] = useState(PREVIEW_DEFAULT_USER)
  const [templatePickId, setTemplatePickId] = useState<number | ''>('')
  const [providerId, setProviderId] = useState<number | ''>('')
  const [modelOverride, setModelOverride] = useState('')
  /** 与 Provider 档案「默认参数 JSON」同源起点，可改；非空则整段作为本次预览的 extraParams */
  const [paramsEffective, setParamsEffective] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<VisionPreviewResponse | null>(null)
  /** 选图下拉：`c:用例id` 或 `f:encodeURIComponent(相对路径)` */
  const [imagePick, setImagePick] = useState<string>('')
  const [scannedPaths, setScannedPaths] = useState<string[]>([])
  const [leftRailCollapsed, setLeftRailCollapsed] = useState(false)
  const [rightRailCollapsed, setRightRailCollapsed] = useState(false)

  useEffect(() => {
    setImagePick('')
    if (!suiteId) {
      setCases([])
      setScannedPaths([])
      return
    }
    void getJson<TestCase[]>(`/api/test-suites/${suiteId}/cases`)
      .then(setCases)
      .catch(() => setCases([]))
    void getJson<{ paths: string[] }>(`/api/test-suites/${suiteId}/scan-images`)
      .then((r) => setScannedPaths(Array.isArray(r.paths) ? r.paths : []))
      .catch(() => setScannedPaths([]))
  }, [suiteId])

  useEffect(() => {
    if (!providerId) {
      setParamsEffective('')
      return
    }
    const p = props.providers.find((x) => x.id === providerId)
    if (!p) return
    setParamsEffective(prettyJsonFromProviderDefaults(p.default_params_json))
  }, [providerId])

  function resetParamsFromProvider() {
    if (!providerId) {
      props.onError('请先选择 Provider')
      return
    }
    const p = props.providers.find((x) => x.id === providerId)
    if (!p) return
    props.onError(null)
    setParamsEffective(prettyJsonFromProviderDefaults(p.default_params_json))
  }

  function applyMetadataForCurrentPath() {
    const p = relativePath.trim()
    if (!p) {
      props.onError('请先填写或选择主图相对路径')
      return
    }
    props.onError(null)
    setMetadataJson(metadataJsonForPath(p))
  }

  function applyTemplateById(id: number) {
    const t = props.prompts.find((x) => x.id === id)
    if (!t) return
    props.onError(null)
    setSystemPrompt(t.system_prompt ?? '')
    setUserPrompt(t.user_prompt_template)
  }

  const resolveMetadataFromSuite = useCallback(
    async (suite: number, rel: string, baseVariablesJson: string) => {
      const r = await postJson<{ metadata_json: string }>(`/api/test-suites/${suite}/resolve-case-metadata`, {
        relative_image_path: rel,
        variables_json: baseVariablesJson?.trim() ? baseVariablesJson : '{}',
      })
      if (isEmptyResolvedMetadata(r.metadata_json)) {
        setMetadataJson(metadataJsonForPath(rel))
        return
      }
      setMetadataJson(JSON.stringify(JSON.parse(r.metadata_json) as object, null, 2))
    },
    [],
  )

  async function send() {
    const missing: string[] = []
    if (!suiteId) missing.push('请在右侧选择「测试集」（用来确定图片根目录 image_root）')
    if (!providerId) missing.push('请选择 Provider')
    const pathTrim = relativePath.trim()
    if (!pathTrim) missing.push('请填写「主图相对路径」')
    if (!userPrompt.trim()) missing.push('「用户提示词」不能为空')
    if (missing.length) {
      props.onError(missing.join(' '))
      return
    }
    if (looksLikeAbsolutePath(pathTrim)) {
      const root = props.suites.find((s) => s.id === suiteId)?.image_root ?? ''
      props.onError(
        `主图路径请填「相对测试集 image_root」的路径，不要填本机绝对路径（如 /Users/...）。` +
          (root
            ? ` 当前测试集根目录为：${root}，例如图片若直接在该目录下，只填文件名即可（如 利客来门店-虚构.png）。`
            : ''),
      )
      return
    }
    const pe = paramsEffective.trim()
    if (pe) {
      try {
        JSON.parse(pe)
      } catch {
        props.onError('「请求参数 JSON」不是合法 JSON，请检查括号与引号')
        return
      }
    }
    props.onError(null)
    setLoading(true)
    setResult(null)
    try {
      const data = await postJson<VisionPreviewResponse>('/api/vision/preview', {
        suite_id: suiteId,
        relative_image_path: relativePath.trim(),
        metadata_json: metadataJson.trim() || '{}',
        provider_profile_id: providerId,
        system_prompt: systemPrompt,
        user_prompt_template: userPrompt,
        model_override: modelOverride.trim() ? modelOverride.trim() : null,
        params_effective_json: pe || null,
        params_override_json: null,
      })
      setResult(data)
    } catch (e) {
      props.onError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const previewImg =
    suiteId && relativePath.trim() && !looksLikeAbsolutePath(relativePath)
      ? imageUrl(Number(suiteId), relativePath.trim())
      : ''
  const activePreviewSuite = suiteId ? props.suites.find((s) => s.id === suiteId) : undefined
  const casePaths = new Set(cases.map((c) => c.relative_image_path))
  const scanOnlyPaths = scannedPaths.filter((p) => !casePaths.has(p))

  function onPreviewImageSelect(raw: string) {
    setImagePick(raw)
    if (!raw) return
    if (raw.startsWith('c:')) {
      const id = Number(raw.slice(2))
      const c = cases.find((x) => x.id === id)
      if (!c) return
      setRelativePath(c.relative_image_path)
      if (suiteId) {
        void resolveMetadataFromSuite(Number(suiteId), c.relative_image_path, c.variables_json || '{}')
      } else {
        setMetadataJson(c.variables_json?.trim() ? c.variables_json : metadataJsonForPath(c.relative_image_path))
      }
      props.onError(null)
      return
    }
    if (raw.startsWith('f:')) {
      let rel = ''
      try {
        rel = decodeURIComponent(raw.slice(2))
      } catch {
        return
      }
      setRelativePath(rel)
      if (suiteId) {
        void resolveMetadataFromSuite(Number(suiteId), rel, '{}')
      } else {
        setMetadataJson(metadataJsonForPath(rel))
      }
      props.onError(null)
    }
  }

  const wb = 'previewWorkbenchRoot'
  const gridClass = [
    'previewWorkbench',
    leftRailCollapsed ? 'previewWorkbench--collapseLeft' : '',
    rightRailCollapsed ? 'previewWorkbench--collapseRight' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={wb}>
      <header className="previewWorkbenchHeader">
        <div>
          <h2 className="previewWorkbenchTitle">单图检测</h2>
          <p className="previewWorkbenchSubtitle">
            左栏：模型与请求参数 · 中间：主图与模型结论 · 右栏：测试集、元数据与提示词。两侧可收起，中间区域自动变宽。
          </p>
        </div>
      </header>

      <div className={gridClass}>
        <aside className="previewRail previewRail--left" aria-label="左侧配置">
          <div className="previewRailToolbar">
            {!leftRailCollapsed ? <span className="previewRailToolbarTitle">模型与请求</span> : null}
            <button
              type="button"
              className="previewRailToggleBtn"
              onClick={() => setLeftRailCollapsed((v) => !v)}
              title={leftRailCollapsed ? '展开左侧' : '收起左侧'}
              aria-expanded={!leftRailCollapsed}
            >
              {leftRailCollapsed ? '▶' : '◀'}
            </button>
          </div>
          {leftRailCollapsed ? (
            <div className="previewRailGhost" aria-hidden>
              配置
            </div>
          ) : (
            <div className="previewRailBody">
              <div className="previewWbField">
                <label>Provider</label>
                <select
                  value={providerId}
                  onChange={(e) => setProviderId(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">请选择</option>
                  {props.providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id} · {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="previewWbField">
                <label>覆盖模型（可选）</label>
                <input
                  value={modelOverride}
                  onChange={(e) => setModelOverride(e.target.value)}
                  placeholder="留空则用档案默认"
                />
              </div>
              <div className="previewWbField">
                <label>请求参数 JSON</label>
                <p className="previewWbHint">档案默认可改，仅本次预览；留空则完全按档案。</p>
                <textarea
                  value={paramsEffective}
                  onChange={(e) => setParamsEffective(e.target.value)}
                  className="mono previewWbParams"
                  placeholder="选择 Provider 后自动填入"
                />
                <div className="previewWbActions">
                  <button type="button" className="btn btnWb" onClick={resetParamsFromProvider}>
                    重置默认
                  </button>
                </div>
              </div>
              <div className="previewWbField">
                <label>提示词模板</label>
                <select
                  value={templatePickId}
                  onChange={(e) => {
                    const v = e.target.value ? Number(e.target.value) : ''
                    setTemplatePickId(v)
                    if (v !== '') applyTemplateById(v)
                  }}
                >
                  <option value="">不载入</option>
                  {props.prompts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id} · {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </aside>

        <main className="previewMain" aria-label="主图与模型输出">
          <div className="previewStageVisual previewStageVisual--wb">
            {previewImg ? (
              <img className="previewStageImg" alt="当前主图预览" src={previewImg} />
            ) : (
              <div className="previewStagePlaceholder">
                在<strong>右侧栏</strong>选择测试集与主图路径，图片将显示在此处。
              </div>
            )}
          </div>

          <div className="previewStageToolbar">
            <button
              type="button"
              className="btn btnPrimary btnSendHero btnWbPrimary"
              disabled={loading}
              onClick={() => void send()}
            >
              {loading ? '请求中…' : '发送检测'}
            </button>
            {loading ? <span className="previewWbHint">正在调用模型…</span> : null}
          </div>

          <div className="previewStageOutput previewStageOutput--wb">
            <div className="previewStageOutputLabel">识别结论 / 模型输出</div>
            <div className="previewStageOutputBody mono">
              {result?.text ?? '发送后，模型返回内容显示在这里。'}
            </div>
            {result?.variables_snapshot && Object.keys(result.variables_snapshot).length > 0 ? (
              <div className="previewStageOutputMeta">
                <div className="previewWbHint" style={{ marginBottom: 6 }}>
                  本次 variables
                </div>
                <pre className="mono previewWbPre">
                  {JSON.stringify(result.variables_snapshot, null, 2)}
                </pre>
              </div>
            ) : null}
            {result?.raw != null ? (
              <div className="previewStageOutputMeta">
                <details className="previewWbHint">
                  <summary>原始响应 JSON</summary>
                  <pre className="mono previewWbPre">{JSON.stringify(result.raw, null, 2)}</pre>
                </details>
              </div>
            ) : null}
          </div>

          <details className="previewWbDetails">
            <summary>多模说明（可选）</summary>
            <ul className="previewWbDetailsList">
              <li>
                <span className="mono">user</span> 消息含多段：<span className="mono">text</span> +{' '}
                <span className="mono">image_url</span> + …
              </li>
              <li>
                <span className="mono">{'{{img:主图}}'}</span> 表示插入图片块，非纯文本拼接。
              </li>
              <li>若无 <span className="mono">{'{{img:}}'}</span>，主图路径会自动附在消息末尾。</li>
            </ul>
          </details>
        </main>

        <aside className="previewRail previewRail--right" aria-label="右侧配置">
          <div className="previewRailToolbar previewRailToolbar--right">
            <button
              type="button"
              className="previewRailToggleBtn"
              onClick={() => setRightRailCollapsed((v) => !v)}
              title={rightRailCollapsed ? '展开右侧' : '收起右侧'}
              aria-expanded={!rightRailCollapsed}
            >
              {rightRailCollapsed ? '◀' : '▶'}
            </button>
            {!rightRailCollapsed ? <span className="previewRailToolbarTitle">数据与提示词</span> : null}
          </div>
          {rightRailCollapsed ? (
            <div className="previewRailGhost" aria-hidden>
              数据
            </div>
          ) : (
            <div className="previewRailBody">
              <div className="previewWbField">
                <label>测试集</label>
                <select value={suiteId} onChange={(e) => setSuiteId(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">请选择</option>
                  {props.suites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id} · {s.name}
                    </option>
                  ))}
                </select>
                {activePreviewSuite ? (
                  <p className="previewWbHint">
                    <span className="mono">image_root</span>：{activePreviewSuite.image_root}
                  </p>
                ) : null}
              </div>
              <div className="previewWbField">
                <label>选图</label>
                <select value={imagePick} onChange={(e) => onPreviewImageSelect(e.target.value)}>
                  <option value="">下拉选择…</option>
                  {cases.length > 0 ? (
                    <optgroup label="已入库用例">
                      {cases.map((c) => (
                        <option key={`c-${c.id}`} value={`c:${c.id}`}>
                          #{c.id} {c.relative_image_path}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {scanOnlyPaths.length > 0 ? (
                    <optgroup label="磁盘扫描">
                      {scanOnlyPaths.map((p) => (
                        <option key={`f-${p}`} value={`f:${encodeURIComponent(p)}`}>
                          {p}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
                {suiteId && cases.length === 0 && scanOnlyPaths.length === 0 ? (
                  <p className="previewWbHint">暂无图片项，请检查目录或导入用例。</p>
                ) : null}
              </div>
              <div className="previewWbField">
                <label>主图相对路径</label>
                <input
                  value={relativePath}
                  onChange={(e) => setRelativePath(e.target.value)}
                  placeholder="例如 photos/a.jpg"
                />
              </div>
              <div className="previewWbActions">
                <button
                  type="button"
                  className="btn btnPrimary btnWbPrimary"
                  onClick={() => {
                    const p = relativePath.trim()
                    if (!p) {
                      props.onError('请先填写或选择主图相对路径')
                      return
                    }
                    if (!suiteId) {
                      applyMetadataForCurrentPath()
                      return
                    }
                    const c = cases.find((x) => x.relative_image_path === p)
                    void resolveMetadataFromSuite(Number(suiteId), p, c?.variables_json || '{}')
                  }}
                >
                  按主图生成元数据
                </button>
              </div>
              <div className="previewWbField">
                <label>元数据 JSON</label>
                <textarea value={metadataJson} onChange={(e) => setMetadataJson(e.target.value)} rows={8} className="mono" />
              </div>
              <div className="previewWbField">
                <label>系统提示词</label>
                <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={5} />
              </div>
              <div className="previewWbField">
                <label>用户提示词</label>
                <textarea value={userPrompt} onChange={(e) => setUserPrompt(e.target.value)} rows={8} />
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function RunSection(props: {
  suites: TestSuite[]
  providers: ProviderProfile[]
  prompts: PromptProfile[]
  onStarted: () => void
  onError: (m: string | null) => void
}) {
  const [suiteId, setSuiteId] = useState<number | ''>('')
  const [providerId, setProviderId] = useState<number | ''>('')
  const [promptId, setPromptId] = useState<number | ''>('')
  const [concurrency, setConcurrency] = useState(2)
  const [modelOverride, setModelOverride] = useState('')
  const [paramsOverride, setParamsOverride] = useState('')
  const [starting, setStarting] = useState(false)
  const [postCooldown, setPostCooldown] = useState(false)
  const [lastStartedRunId, setLastStartedRunId] = useState<number | null>(null)
  const startInFlightRef = useRef(false)
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current)
    }
  }, [])

  async function start() {
    if (!suiteId || !providerId || !promptId) {
      props.onError('请选择测试集、Provider 与提示词模板')
      return
    }
    if (startInFlightRef.current || postCooldown) return
    startInFlightRef.current = true
    props.onError(null)
    flushSync(() => {
      setStarting(true)
      setLastStartedRunId(null)
    })
    try {
      const run = await postJson<TestRun>('/api/test-runs', {
        suite_id: suiteId,
        provider_profile_id: providerId,
        prompt_profile_id: promptId,
        concurrency,
        model_override: modelOverride.trim() ? modelOverride.trim() : null,
        params_override_json: paramsOverride.trim() ? paramsOverride.trim() : null,
      })
      setLastStartedRunId(run.id)
      setPostCooldown(true)
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current)
      cooldownTimerRef.current = setTimeout(() => {
        setPostCooldown(false)
        cooldownTimerRef.current = null
      }, 2800)
      props.onStarted()
    } catch (e) {
      props.onError((e as Error).message)
    } finally {
      startInFlightRef.current = false
      setStarting(false)
    }
  }

  const formLocked = starting || postCooldown
  const btnDisabled = starting || postCooldown || !suiteId || !providerId || !promptId

  return (
    <div className="panel">
      <h2>发起一次批量测试</h2>
      <p className="muted">
        运行在后端异步执行；请到「报告与失败复盘」查看进度与结果。此处只跑<strong>已入库的用例</strong>（每条记录对应一条主图相对路径）；磁盘上的清单/侧车
        JSON 只参与合并元数据，<strong>不会自动变成用例</strong>。若提示没有用例，请到「测试集与用例」对该测试集执行扫描并导入选中，或手动添加。
      </p>
      <div className="row row2">
        <div>
          <label>测试集</label>
          <select
            disabled={formLocked}
            value={suiteId}
            onChange={(e) => setSuiteId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">请选择</option>
            {props.suites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id} · {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>并发数（1–32）</label>
          <input
            type="number"
            min={1}
            max={32}
            disabled={formLocked}
            value={concurrency}
            onChange={(e) => setConcurrency(Number(e.target.value))}
          />
        </div>
      </div>
      <div className="row row2">
        <div>
          <label>Provider 档案</label>
          <select
            disabled={formLocked}
            value={providerId}
            onChange={(e) => setProviderId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">请选择</option>
            {props.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} · {p.name} · {p.default_model}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>提示词模板</label>
          <select
            disabled={formLocked}
            value={promptId}
            onChange={(e) => setPromptId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">请选择</option>
            {props.prompts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} · {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        <label>覆盖模型（可留空使用 Provider 默认）</label>
        <input
          disabled={formLocked}
          value={modelOverride}
          onChange={(e) => setModelOverride(e.target.value)}
        />
      </div>
      <div className="row">
        <label>覆盖参数 JSON（会与 Provider 默认参数合并）</label>
        <textarea
          disabled={formLocked}
          value={paramsOverride}
          onChange={(e) => setParamsOverride(e.target.value)}
        />
      </div>
      <div className="actions runStartActions">
        <button
          type="button"
          className={`btn btnPrimary runStartBtn${starting ? ' runStartBtn--busy' : ''}`}
          disabled={btnDisabled}
          aria-busy={starting}
          aria-live="polite"
          onClick={() => void start()}
        >
          {starting ? (
            <>
              <span className="btnSpinner" aria-hidden />
              正在创建运行…
            </>
          ) : postCooldown ? (
            '已发起，请稍候…'
          ) : (
            '开始运行'
          )}
        </button>
      </div>
      {starting ? (
        <div className="runSubmitBanner" role="status">
          <strong>正在提交</strong>：已锁定表单与按钮，请勿连续点击；创建成功后约 3 秒内不可再次发起，避免误触重复任务。
        </div>
      ) : null}
      {lastStartedRunId != null && !starting ? (
        <p className="ok">
          运行已创建，运行 ID #{lastStartedRunId}。请到顶部「报告与失败复盘」标签页查看进度与结果。
        </p>
      ) : null}
    </div>
  )
}

function formatRunTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

function formatAvgDurationMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`
  return `${Math.round(ms)} ms`
}

function ReportSection(props: {
  runs: TestRun[]
  suites: TestSuite[]
  providers: ProviderProfile[]
  prompts: PromptProfile[]
  onRefreshRunsList?: () => void
  onError: (m: string | null) => void
}) {
  const { runs, suites, providers, prompts, onRefreshRunsList, onError } = props
  const [runId, setRunId] = useState<number | null>(null)
  const [run, setRun] = useState<TestRun | null>(null)
  const [items, setItems] = useState<RunItemDetail[]>([])
  const [onlyFail, setOnlyFail] = useState(true)
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null)

  const suiteName = useMemo(() => {
    if (!run) return ''
    const s = suites.find((x) => x.id === run.suite_id)
    return s ? `${s.id} · ${s.name}` : String(run.suite_id)
  }, [suites, run])

  const providerLabel = useMemo(() => {
    if (!run) return ''
    const p = providers.find((x) => x.id === run.provider_profile_id)
    return p ? `${p.id} · ${p.name} · ${p.default_model}` : String(run.provider_profile_id)
  }, [providers, run])

  const promptLabel = useMemo(() => {
    if (!run) return ''
    const p = prompts.find((x) => x.id === run.prompt_profile_id)
    return p ? `${p.id} · ${p.name}` : String(run.prompt_profile_id)
  }, [prompts, run])

  const loadRun = useCallback(
    async (id: number) => {
      onError(null)
      try {
        const [r, list] = await Promise.all([
          getJson<TestRun>(`/api/test-runs/${id}`),
          getJson<RunItemDetail[]>(
            `/api/test-runs/${id}/items-detail?${onlyFail ? 'pass=false&' : ''}limit=200`,
          ),
        ])
        setRun(r)
        setItems(list)
        onRefreshRunsList?.()
      } catch (e) {
        onError((e as Error).message)
      }
    },
    [onlyFail, onError, onRefreshRunsList],
  )

  useEffect(() => {
    if (runId != null) {
      void loadRun(runId)
    } else {
      setRun(null)
      setItems([])
    }
  }, [runId, loadRun])

  useEffect(() => {
    if (!previewImage) return
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setPreviewImage(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [previewImage])

  useEffect(() => {
    if (runId == null) return
    const es = new EventSource(`/api/test-runs/${runId}/events`)
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as { type?: string }
        if (data.type === 'item_done' || data.type === 'status' || data.type === 'error') {
          void loadRun(runId)
        }
      } catch {
        /* ignore */
      }
    }
    es.onerror = () => {
      es.close()
    }
    return () => es.close()
  }, [runId, loadRun])

  const rate = useMemo(() => {
    if (!run || !run.total_count) return null
    const denom = run.total_count - run.error_count
    if (denom <= 0) return null
    return ((run.pass_count / denom) * 100).toFixed(1)
  }, [run])

  return (
    <div className="panel">
      <h2>运行记录</h2>
      <div className="row row2">
        <div>
          <label>选择运行</label>
          <select value={runId ?? ''} onChange={(e) => setRunId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">请选择</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                #{r.id} · 测试集 {r.suite_id} · {r.status} · 通过 {r.pass_count}/{r.total_count}
              </option>
            ))}
          </select>
        </div>
        <div className="actions" style={{ alignSelf: 'end' }}>
          <label className="muted" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={onlyFail} onChange={(e) => setOnlyFail(e.target.checked)} />
            仅看未通过
          </label>
          <button type="button" className="btn" onClick={() => runId && void loadRun(runId)}>
            刷新本运行
          </button>
        </div>
      </div>

      {run ? (
        <div className="reportRunSummary">
          <div className="reportRunSummaryLine">
            状态：<strong>{run.status}</strong> · 测试集 {suiteName}
          </div>
          <div className="reportRunSummaryLine">
            通过 <span className="ok">{run.pass_count}</span> · 失败{' '}
            <span className="fail">{run.fail_count}</span> · 错误{' '}
            <span className="fail">{run.error_count}</span> · 合计 {run.total_count}
            {rate != null ? <span> · 断言正确率（排除错误）约 {rate}%</span> : null}
            {run.duration_stats &&
            run.duration_stats.count > 0 &&
            run.duration_stats.avg_ms != null ? (
              <span>
                {' '}
                · 平均单条耗时 {formatAvgDurationMs(run.duration_stats.avg_ms)}（本次运行共{' '}
                {run.duration_stats.count} 条已记录耗时，含通过/失败/错误）
              </span>
            ) : (
              <span className="muted"> · 平均单条耗时：暂无（尚无已完成的耗时记录）</span>
            )}
          </div>
          <div className="reportRunMetaGrid">
            <div>
              <span className="muted">运行 ID</span> #{run.id}
            </div>
            <div>
              <span className="muted">Provider</span> <span className="mono">{providerLabel}</span>
            </div>
            <div>
              <span className="muted">提示词模板</span> <span className="mono">{promptLabel}</span>
            </div>
            <div>
              <span className="muted">并发</span> {run.concurrency}
            </div>
            <div>
              <span className="muted">覆盖模型</span>{' '}
              <span className="mono">{run.model_override?.trim() || '（使用档案默认）'}</span>
            </div>
            <div>
              <span className="muted">开始 / 结束</span>{' '}
              {formatRunTime(run.started_at)} → {formatRunTime(run.finished_at)}
            </div>
            <div>
              <span className="muted">创建时间</span> {formatRunTime(run.created_at)}
            </div>
          </div>
          {run.last_error ? <div className="error">最后错误：{run.last_error}</div> : null}
        </div>
      ) : null}

      {items.length === 0 && run && run.total_count > 0 && onlyFail ? (
        <p className="muted">当前勾选「仅看未通过」，本次全部通过，列表为空。取消勾选可查看全部用例明细。</p>
      ) : null}

      {items.map((it) => {
        const verdict = verdictForItem(it)
        const brief = briefRecognitionText(
          it.model_output,
          it.error_message,
          it.status === 'error',
        )
        return (
          <div key={it.id} className="panel reportItemCard">
            <div className="reportItemTopSummary">
              <div className={`reportVerdictChip reportVerdictChip--${verdict.variant}`}>{verdict.headline}</div>
              <div className="reportBriefGrid">
                <div className="reportBriefBlock">
                  <div className="muted">简要识别</div>
                  <p className="reportBriefText">{brief}</p>
                </div>
                <div className="reportBriefBlock">
                  <div className="muted">判定结果</div>
                  <p className={`reportJudgmentHint reportJudgmentHint--${verdict.variant}`}>{verdict.passLine}</p>
                  {verdict.ruleRows.length ? (
                    <ul className="reportRuleList">
                      {verdict.ruleRows.map((r, idx) => (
                        <li key={idx} className={r.ok ? 'reportRuleOk' : 'reportRuleFail'}>
                          <span className="reportRuleMark">{r.ok ? '✓' : '✗'}</span> {r.line}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="split reportItemSplit">
              <div className="reportItemThumbCol">
                <div className="muted">用例 #{it.case_id}</div>
                <div className="mono">{it.relative_image_path}</div>
                <button
                  type="button"
                  className="reportThumbBtn"
                  onClick={() =>
                    setPreviewImage({
                      src: imageUrl(it.suite_id, it.relative_image_path),
                      alt: it.relative_image_path,
                    })
                  }
                  title="点击查看大图"
                >
                  <img
                    className="thumb reportItemThumb"
                    alt={it.relative_image_path}
                    src={imageUrl(it.suite_id, it.relative_image_path)}
                  />
                </button>
              </div>
              <div className="reportItemDetailCol">
                <div className="muted">模型输出（参与断言的文本）</div>
                <pre className="reportMonoScroll">{it.model_output ?? it.error_message ?? '—'}</pre>
                {it.assertion_details_json ? (
                  <>
                    <div className="muted" style={{ marginTop: 10 }}>
                      断言明细（JSON）
                    </div>
                    <pre className="reportMonoScroll reportMonoScrollShort">{formatAssertion(it.assertion_details_json)}</pre>
                  </>
                ) : null}
                {it.raw_response_json ? (
                  <details className="reportRawDetails">
                    <summary>原始 API 响应 JSON（完整 choices / usage 等）</summary>
                    <pre className="reportMonoScroll">{prettyJsonMaybe(it.raw_response_json)}</pre>
                  </details>
                ) : null}
                {it.duration_ms != null ? (
                  <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
                    耗时 {it.duration_ms} ms
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )
      })}

      {previewImage ? (
        <div className="reportImageOverlay" onClick={() => setPreviewImage(null)}>
          <button
            type="button"
            className="reportImageClose"
            onClick={() => setPreviewImage(null)}
            aria-label="关闭大图"
          >
            关闭
          </button>
          <img
            className="reportImageLarge"
            src={previewImage.src}
            alt={previewImage.alt}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  )
}

function formatAssertion(raw: string): string {
  try {
    const j = JSON.parse(raw) as unknown
    return JSON.stringify(j, null, 2)
  } catch {
    return raw
  }
}

function prettyJsonMaybe(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw) as unknown, null, 2)
  } catch {
    return raw
  }
}

const RULE_TYPE_LABEL: Record<string, string> = {
  contains: '包含',
  regex: '正则',
  jsonPath: 'JSONPath',
  customScript: '脚本',
}

function ruleTypeLabel(t: string | undefined): string {
  return t ? (RULE_TYPE_LABEL[t] ?? t) : '规则'
}

/** 从模型输出中提取一行可读摘要（JSON 则优先常用字段，否则截断纯文本） */
function briefRecognitionText(modelOutput: string | null, errorMessage: string | null, isError: boolean): string {
  if (isError && errorMessage?.trim()) {
    const e = errorMessage.trim().replace(/\s+/g, ' ')
    return e.length > 280 ? `${e.slice(0, 280)}…` : e
  }
  const text = modelOutput?.trim()
  if (!text) return '—'
  try {
    const j = JSON.parse(text) as unknown
    if (j && typeof j === 'object' && !Array.isArray(j)) {
      const o = j as Record<string, unknown>
      const parts: string[] = []
      const priority = [
        'storeName',
        'label',
        'isStorefront',
        'scene',
        'result',
        'summary',
        'description',
        'text',
        'content',
        'answer',
      ]
      for (const k of priority) {
        if (!(k in o) || o[k] == null) continue
        const v = o[k]
        const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
        parts.push(`${k}：${s.length > 72 ? `${s.slice(0, 72)}…` : s}`)
      }
      if (parts.length > 0) return parts.join(' · ')
      for (const [k, v] of Object.entries(o)) {
        if (parts.length >= 6) break
        if (v == null) continue
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          const s = String(v)
          parts.push(`${k}：${s.length > 56 ? `${s.slice(0, 56)}…` : s}`)
        }
      }
      if (parts.length > 0) return parts.join(' · ')
      const flat = JSON.stringify(j)
      return flat.length > 220 ? `${flat.slice(0, 220)}…` : flat
    }
  } catch {
    /* 非 JSON */
  }
  const one = text.replace(/\s+/g, ' ')
  return one.length > 240 ? `${one.slice(0, 240)}…` : one
}

interface ParsedRuleRow {
  ok: boolean
  line: string
}

function parseAssertionSummary(assertionJson: string | null): {
  passLine: string
  rows: ParsedRuleRow[]
} {
  if (!assertionJson?.trim()) {
    return { passLine: '无断言记录', rows: [] }
  }
  try {
    const arr = JSON.parse(assertionJson) as unknown
    if (!Array.isArray(arr)) {
      return { passLine: '格式异常', rows: [] }
    }
    const rows: ParsedRuleRow[] = []
    let okCount = 0
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue
      const x = item as { ok?: boolean; detail?: string; rule?: { type?: string; path?: string } }
      const ok = Boolean(x.ok)
      if (ok) okCount += 1
      const type = ruleTypeLabel(x.rule?.type)
      const jp =
        x.rule?.type === 'jsonPath' && x.rule.path
          ? `${type} \`${x.rule.path}\``
          : type
      const detail = (x.detail ?? '').trim()
      const short = detail.length > 100 ? `${detail.slice(0, 100)}…` : detail
      rows.push({ ok, line: `${jp}${short ? `：${short}` : ''}` })
    }
    const total = rows.length
    const passLine =
      total === 0 ? '无规则条目' : okCount === total ? `全部 ${total} 条通过` : `通过 ${okCount}/${total} 条`
    return { passLine, rows }
  } catch {
    return { passLine: '断言明细解析失败', rows: [] }
  }
}

function verdictForItem(it: RunItemDetail): {
  headline: string
  variant: 'ok' | 'fail' | 'err'
  passLine: string
  ruleRows: ParsedRuleRow[]
} {
  if (it.status === 'error') {
    return {
      headline: '执行失败',
      variant: 'err',
      passLine: '未完成模型调用或请求异常',
      ruleRows: [],
    }
  }
  const { passLine, rows } = parseAssertionSummary(it.assertion_details_json)
  if (it.pass === 1) {
    return { headline: '判定通过', variant: 'ok', passLine, ruleRows: rows }
  }
  return { headline: '判定未通过', variant: 'fail', passLine, ruleRows: rows }
}
