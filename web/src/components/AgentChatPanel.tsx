import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getJson, postJson, delJson, type ProviderProfile } from '../api'

// ---- Types ----
interface AgentInfo {
  name: string
  displayName: string
  skills: string[]
}

interface AgentSession {
  id: number
  title: string
  provider_profile_id: number
  model: string | null
  agent_name: string
  created_at: string
}

interface AgentMessage {
  id: number
  session_id: number
  role: 'user' | 'assistant' | 'tool'
  content: string
  tool_calls_json: string | null
  tool_call_id: string | null
}

interface SSEEvent {
  type: 'answer_delta' | 'tool_call' | 'tool_result' | 'context_stats' | 'ping' | 'done' | 'error'
  content?: string
  name?: string
  args?: Record<string, unknown>
  result?: string
  truncated?: boolean
  messageId?: number
  fullContent?: string
  message?: string
  total_tokens?: number
  message_count?: number
  system_prompt_tokens?: number
  history_tokens?: number
  limit?: number
}

interface ToolEvent {
  type: 'call' | 'result'
  name: string
  args?: Record<string, unknown>
  result?: string
  truncated?: boolean
}

// ---- Quick prompts ----
const QUICK_PROMPTS = [
  { label: '📊 分析最近运行', text: '请分析最近一次测试运行的结果，找出主要失败模式并给出优化建议。' },
  { label: '🔄 对比上次运行', text: '请对比最近两次运行的通过率变化，分析改进或退步的原因。' },
  { label: '✏️ 优化提示词', text: '请帮我优化当前使用的提示词模板，基于最近运行的失败数据。' },
]

// ---- Component ----
export function AgentChatPanel(props: {
  providers: ProviderProfile[]
  onClose: () => void
}) {
  const { providers, onClose } = props
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null)
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([])
  const [contextStats, setContextStats] = useState<{ total_tokens: number; message_count: number; limit?: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showTools, setShowTools] = useState(false)
  const [showSessionList, setShowSessionList] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createAgent, setCreateAgent] = useState('optimizer')
  const [createProvider, setCreateProvider] = useState<number>(providers[0]?.id ?? 0)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [lastEventAt, setLastEventAt] = useState<number | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ---- Load sessions ----
  const loadSessions = useCallback(async () => {
    try {
      const data = await getJson<AgentSession[]>('/api/agent/sessions')
      setSessions(data)
    } catch {
      /* ignore */
    }
  }, [])

  // ---- Load agents ----
  const loadAgents = useCallback(async () => {
    try {
      const data = await getJson<AgentInfo[]>('/api/agents')
      setAgents(data)
      if (data.length > 0 && !createAgent) {
        setCreateAgent(data[0].name)
      }
    } catch {
      /* ignore */
    }
  }, [createAgent])

  useEffect(() => { loadSessions(); loadAgents() }, [loadSessions, loadAgents])

  // ---- Load messages ----
  const loadMessages = useCallback(async (sessionId: number) => {
    try {
      const data = await getJson<AgentMessage[]>(`/api/agent/sessions/${sessionId}/messages`)
      setMessages(data)
    } catch {
      /* ignore */
    }
  }, [])

  // ---- Create session ----
  const createSession = async () => {
    if (!providers.length) {
      setError('请先在 Provider 设置中创建一个 Provider 档案')
      return
    }
    if (!agents.length) {
      setError('没有可用的 Agent')
      return
    }
    try {
      const session = await postJson<AgentSession>('/api/agent/sessions', {
        provider_profile_id: createProvider,
        agent_name: createAgent,
      })
      setSessions((prev) => [session, ...prev])
      setActiveSessionId(session.id)
      setMessages([])
      setShowSessionList(false)
      setShowCreateModal(false)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // ---- Select session ----
  const selectSession = (id: number) => {
    setActiveSessionId(id)
    loadMessages(id)
    setShowSessionList(false)
  }

  // ---- Send message ----
  const sendMessage = async (text?: string) => {
    const msg = (text ?? input).trim()
    if (!msg || loading) return
    if (!activeSessionId) {
      setError('请先创建或选择一个对话')
      return
    }

    setInput('')
    setError(null)
    setLoading(true)
    setStreamingText('')
    setToolEvents([])
    setElapsedSeconds(0)
    setLastEventAt(Date.now())

    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current)
    elapsedTimerRef.current = setInterval(() => {
      setElapsedSeconds((s) => s + 1)
    }, 1000)

    // Optimistic add user message
    setMessages((prev) => [
      ...prev,
      { id: -1, session_id: activeSessionId, role: 'user', content: msg, tool_calls_json: null, tool_call_id: null },
    ])

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const resp = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: activeSessionId, message: msg }),
        signal: controller.signal,
      })

      if (!resp.ok || !resp.body) {
        const errData = await resp.json().catch(() => ({ error: '请求失败' }))
        throw new Error((errData as { error?: string }).error || '请求失败')
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n\n')
        buf = lines.pop() || ''

        for (const line of lines) {
          const dataLine = line.replace(/^data: /, '').trim()
          if (!dataLine) continue
          try {
            const evt: SSEEvent = JSON.parse(dataLine)
            handleSSEEvent(evt)
          } catch {
            /* ignore malformed events */
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setError((e as Error).message)
      }
    } finally {
      setLoading(false)
      abortRef.current = null
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current)
        elapsedTimerRef.current = null
      }
      // Reload messages to get persisted state
      if (activeSessionId) loadMessages(activeSessionId)
    }
  }

  const handleSSEEvent = (evt: SSEEvent) => {
    setLastEventAt(Date.now())
    switch (evt.type) {
      case 'answer_delta':
        setStreamingText((prev) => prev + (evt.content || ''))
        break
      case 'tool_call':
        setToolEvents((prev) => [...prev, { type: 'call', name: evt.name || '', args: evt.args }])
        break
      case 'tool_result':
        setToolEvents((prev) => [
          ...prev,
          { type: 'result', name: evt.name || '', result: evt.result, truncated: evt.truncated },
        ])
        break
      case 'context_stats':
        if (evt.total_tokens != null) {
          setContextStats({
            total_tokens: evt.total_tokens,
            message_count: evt.message_count ?? 0,
            limit: evt.limit,
          })
        }
        break
      case 'ping':
        // 心跳，仅用于确认连接存活
        break
      case 'error':
        setError(evt.message || '未知错误')
        break
      case 'done':
        // 用最终完整内容替换（以防流式丢包）
        if (evt.fullContent) {
          setStreamingText(evt.fullContent)
        }
        break
    }
  }

  const cancelRun = async () => {
    if (activeSessionId) {
      await postJson('/api/agent/chat/cancel', { session_id: activeSessionId })
      abortRef.current?.abort()
    }
  }

  const deleteSession = async (id: number) => {
    await delJson(`/api/agent/sessions/${id}`)
    setSessions((prev) => prev.filter((s) => s.id !== id))
    if (activeSessionId === id) {
      setActiveSessionId(null)
      setMessages([])
    }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText, toolEvents])

  // ---- Current session info ----
  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const activeProvider = providers.find((p) => p.id === activeSession?.provider_profile_id)
  const activeAgent = agents.find((a) => a.name === activeSession?.agent_name)

  // ---- Render ----
  return (
    <div className="agentPanel">
      {/* Header */}
      <div className="agentPanelHeader">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>AI 助手</span>
          <button className="btn btnGhost btnSm" onClick={() => setShowSessionList(!showSessionList)}>
            {activeSession?.title || '选择对话'} ▾
          </button>
          {activeSession && (
            <span className="muted" style={{ fontSize: 12 }}>
              {activeAgent?.displayName || activeSession.agent_name} · {activeProvider?.name || 'Provider #' + activeSession.provider_profile_id}
            </span>
          )}
          {contextStats && (
            <span
              className="agentContextStats"
              title={`system: ${contextStats.total_tokens} tokens / ${contextStats.message_count} messages / limit: ${(contextStats.limit ?? 256000).toLocaleString()}`}
            >
              {(() => {
                const limit = contextStats.limit ?? 256000
                const pct = Math.min(100, Math.round((contextStats.total_tokens / limit) * 100))
                let cls = 'ok'
                if (pct >= 90) cls = 'danger'
                else if (pct >= 70) cls = 'warn'
                return (
                  <span className={`agentContextStats--${cls}`}>
                    {contextStats.total_tokens.toLocaleString()} / {limit.toLocaleString()} ({pct}%)
                  </span>
                )
              })()}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn btnGhost btnSm" onClick={() => setShowCreateModal(true)} title="新建对话">+</button>
          <button className="btn btnGhost btnSm" onClick={onClose} title="关闭">✕</button>
        </div>
      </div>

      {/* Session list dropdown */}
      {showSessionList && (
        <div className="agentSessionList">
          {sessions.length === 0 ? (
            <div className="muted" style={{ padding: 8, fontSize: 13 }}>暂无对话，点击 + 新建</div>
          ) : (
            sessions.map((s) => (
              <div key={s.id} className="agentSessionItem">
                <button
                  className={`btn btnGhost btnSm ${s.id === activeSessionId ? 'btnActive' : ''}`}
                  style={{ flex: 1, textAlign: 'left' }}
                  onClick={() => selectSession(s.id)}
                >
                  #{s.id} {s.title}
                </button>
                <button
                  className="btn btnGhost btnSm"
                  style={{ color: 'var(--danger)', padding: '2px 6px' }}
                  onClick={() => deleteSession(s.id)}
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Create session modal */}
      {showCreateModal && (
        <div className="agentModalOverlay" onClick={(e) => { if (e.target === e.currentTarget) setShowCreateModal(false) }}>
          <div className="agentModal">
            <div className="agentModalHeader">
              <strong>新建对话</strong>
              <button className="btn btnGhost btnSm" onClick={() => setShowCreateModal(false)}>✕</button>
            </div>
            <div className="agentModalBody">
              <label className="agentLabel">选择 Agent</label>
              <select
                className="input"
                value={createAgent}
                onChange={(e) => setCreateAgent(e.target.value)}
              >
                {agents.map((a) => (
                  <option key={a.name} value={a.name}>{a.displayName}</option>
                ))}
              </select>
              <label className="agentLabel" style={{ marginTop: 12 }}>选择 Provider</label>
              <select
                className="input"
                value={createProvider}
                onChange={(e) => setCreateProvider(Number(e.target.value))}
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} · {p.default_model}</option>
                ))}
              </select>
            </div>
            <div className="agentModalFooter">
              <button className="btn btnGhost btnSm" onClick={() => setShowCreateModal(false)}>取消</button>
              <button className="btn btnPrimary btnSm" onClick={createSession}>创建</button>
            </div>
          </div>
        </div>
      )}

      {/* Messages area */}
      <div className="agentMessages">
        {messages.map((msg, i) => (
          <div key={msg.id || i} className={`agentMsg agentMsg--${msg.role}`}>
            {msg.role === 'user' ? (
              <div className="agentBubble agentBubble--user">{msg.content}</div>
            ) : msg.role === 'assistant' ? (
              !msg.content.trim() && !msg.tool_calls_json ? null : (
                msg.tool_calls_json && !msg.content.trim() ? (
                  <ToolCallPill toolCallsJson={msg.tool_calls_json} />
                ) : (
                  <div className="agentBubble agentBubble--assistant">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  </div>
                )
              )
            ) : msg.role === 'tool' ? (
              <ToolMessageCard content={msg.content} />
            ) : null}
          </div>
        ))}

        {/* Real-time streaming */}
        {loading && (
          <div className="agentStreaming">
            {/* Streaming answer (accumulated from answer_delta) */}
            {streamingText && (
              <div className="agentBubble agentBubble--assistant">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingText}</ReactMarkdown>
              </div>
            )}
            {/* Tool events */}
            {toolEvents.length > 0 && (
              <div className="agentToolsBlock">
                <button
                  className="btn btnGhost btnSm"
                  onClick={() => setShowTools(!showTools)}
                  style={{ fontSize: 11 }}
                >
                  🔧 {toolEvents.length} 个工具调用 {showTools ? '▾' : '▸'}
                </button>
                {showTools && (
                  <div style={{ marginTop: 4 }}>
                    {toolEvents.map((te, i) => (
                      <div key={i} className="agentToolEvent">
                        {te.type === 'call' ? (
                          <span>🔧 <code>{te.name}</code>({JSON.stringify(te.args || {}).slice(0, 100)})</span>
                        ) : (
                          <span>📊 <code>{te.name}</code> → {te.result?.slice(0, 200)}{te.truncated ? '...' : ''}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {!streamingText && (
              <div className="agentBubble agentBubble--assistant" style={{ opacity: 0.5 }}>
                思考中…{elapsedSeconds > 0 ? `（已 ${elapsedSeconds} 秒）` : ''}
                {lastEventAt && Date.now() - lastEventAt > 20000 && (
                  <span style={{ color: 'var(--danger)', marginLeft: 8 }}>⚠️ 长时间未收到响应</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="agentError">
            ⚠️ {error}
            <button className="btn btnGhost btnSm" onClick={() => setError(null)} style={{ marginLeft: 8 }}>✕</button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick prompts */}
      <div className="agentQuickPrompts">
        {QUICK_PROMPTS.map((qp) => (
          <button
            key={qp.label}
            className="btn btnGhost btnSm"
            onClick={() => sendMessage(qp.text)}
            disabled={loading}
          >
            {qp.label}
          </button>
        ))}
      </div>

      {/* Input area */}
      <div className="agentInputBar">
        <input
          className="input"
          placeholder="发消息..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              sendMessage()
            }
          }}
          disabled={loading}
          style={{ flex: 1 }}
        />
        {loading ? (
          <button className="btn btnDanger btnSm" onClick={cancelRun}>停止</button>
        ) : (
          <button className="btn btnPrimary btnSm" onClick={() => sendMessage()} disabled={!input.trim()}>
            发送
          </button>
        )}
      </div>
    </div>
  )
}

/** Compact pill for assistant tool_calls in history */
function ToolCallPill({ toolCallsJson }: { toolCallsJson: string }) {
  let names: string[] = []
  try {
    const parsed = JSON.parse(toolCallsJson) as Array<{ name?: string }>
    names = parsed.map((tc) => tc.name || 'unknown').filter(Boolean)
  } catch {
    names = ['unknown']
  }
  return (
    <div className="agentToolCallPill">
      <span>🔧 调用工具</span>
      {names.map((name) => (
        <code key={name}>{name}</code>
      ))}
    </div>
  )
}

/** Tool message card: collapsible with formatted JSON */
function ToolMessageCard({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  let displayContent = content
  try {
    const parsed = JSON.parse(content)
    displayContent = JSON.stringify(parsed, null, 2)
  } catch {
    /* not JSON, show as-is */
  }
  const preview = displayContent.length > 200 ? displayContent.slice(0, 200) + '…' : displayContent
  return (
    <div className="agentToolMsg">
      <button
        className="btn btnGhost btnSm"
        style={{ fontSize: 11, padding: '2px 6px' }}
        onClick={() => setExpanded(!expanded)}
      >
        🔧 工具返回 {expanded ? '▾' : '▸'}
      </button>
      {expanded ? (
        <pre style={{ fontSize: 11, maxHeight: 300, overflow: 'auto', margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>
          {displayContent}
        </pre>
      ) : (
        <pre style={{ fontSize: 11, maxHeight: 60, overflow: 'hidden', margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>
          {preview}
        </pre>
      )}
    </div>
  )
}
