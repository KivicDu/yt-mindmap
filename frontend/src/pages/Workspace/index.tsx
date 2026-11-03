import { lazy, Suspense, useState, useRef, useEffect, useCallback } from 'react'
import type { ChangeEvent } from 'react'
import YouTube from 'react-youtube'
import type { YouTubeProps } from 'react-youtube'
import './Workspace.css'
import type { MindMapHandle } from '../../components/MindMap'
import { findNodeById, normalizeTree, type MapNode } from '../../lib/mindmapTree'

// markmap + d3 are heavy; load them after the player shell is interactive.
const MindMap = lazy(() => import('../../components/MindMap'))

interface TranscriptEntry {
  start: number
  duration: number
  text: string
}

/** Draft of the node being edited; separate from the tree until saved. */
interface NodeDraft {
  id: string
  label: string
  note: string
  pinned: boolean
}

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8001'
const DEFAULT_TITLE = 'Lecture Mind Map'
const AUTO_UPDATE_SECONDS = 15

function App() {
  const [url, setUrl] = useState('')
  const [videoId, setVideoId] = useState<string | null>(null)
  const [player, setPlayer] = useState<any>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [focusRecent, setFocusRecent] = useState(false)
  const [status, setStatus] = useState('Sẵn sàng')
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [editor, setEditor] = useState<NodeDraft | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mindmapRef = useRef<MindMapHandle>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const isUpdatingRef = useRef(false)
  const lastTriggerRef = useRef(0)
  const currentTimeRef = useRef(0)
  const loadTokenRef = useRef(0)
  const sessionIdRef = useRef<string | null>(null)
  const requestUpdateRef = useRef<(atTime?: number) => Promise<void>>(async () => {})
  const nodesRef = useRef<MapNode[]>([])
  const titleRef = useRef<string>(DEFAULT_TITLE)

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  const extractVideoId = (input: string) => {
    try {
      const urlObj = new URL(input)
      if (urlObj.hostname.includes('youtube.com')) {
        return urlObj.searchParams.get('v')
      }
      if (urlObj.hostname === 'youtu.be') {
        return urlObj.pathname.slice(1)
      }
    } catch {
      return null
    }
    return null
  }

  const recreateSession = useCallback(async () => {
    if (!videoId) return
    try {
      const data = await fetchTranscript({ url })
      applyLoadResult(data, videoId, 'Phiên làm việc đã được khôi phục')
    } catch (e: any) {
      setStatus(`Lỗi khôi phục phiên: ${e.message}`)
    }
  }, [url, videoId])

  const applyLoadResult = (
    data: any,
    vid: string,
    label: string,
  ) => {
    if (data.session_id) {
      setSessionId(data.session_id)
      sessionIdRef.current = data.session_id
    }

    if (Array.isArray(data.transcript)) {
      setTranscript(data.transcript)
    }

    const resolvedTitle = data.title || vid || DEFAULT_TITLE
    titleRef.current = resolvedTitle

    if (Array.isArray(data.nodes)) {
      nodesRef.current = normalizeTree(data.nodes)
      mindmapRef.current?.updateTree(titleRef.current, nodesRef.current, { focusNew: false })
    }

    lastTriggerRef.current = Number(data.consumed_until || 0)

    nodesRef.current = normalizeTree(data.nodes)
    mindmapRef.current?.updateTree(titleRef.current, nodesRef.current, { focusNew: false })

    const suffix = data.cached ? ' — khôi phục từ bộ nhớ đệm' : ''
    setStatus(`${label}${suffix} (${data.transcript?.length || 0} mục)`)
  }

  const handleLoadVideo = async () => {
    const id = extractVideoId(url)
    if (!id) {
      alert('Đường dẫn YouTube không hợp lệ')
      return
    }
    const token = ++loadTokenRef.current
    setIsLoading(true)
    setStatus('Đang tải phụ đề...')
    try {
      const data = await fetchTranscript({ url })
      if (token !== loadTokenRef.current) return
      applyLoadResult(data, id, 'Đã tải phụ đề')
      setVideoId(id)
    } catch (e: any) {
      if (token === loadTokenRef.current) {
        setStatus(`Lỗi: ${e.message} (không có phụ đề? thử tải file .srt/.vtt)`)
      }
    } finally {
      if (token === loadTokenRef.current) setIsLoading(false)
    }
  }

  const handleTranscriptUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const token = ++loadTokenRef.current
    setIsLoading(true)
    setStatus(`Đang tải ${file.name}...`)
    try {
      const text = await file.text()
      const data = await fetchTranscript({ url, fileContent: text })
      if (token !== loadTokenRef.current) return
      const id = extractVideoId(url) || 'upload'
      applyLoadResult(data, id, 'Đã tải phụ đề từ file')
      setVideoId(id)
    } catch (e: any) {
      if (token === loadTokenRef.current) {
        setStatus(`Lỗi: ${e.message}`)
      }
    } finally {
      if (token === loadTokenRef.current) setIsLoading(false)
      if (event.target) event.target.value = ''
    }
  }

  const fetchTranscript = async (payload: { url?: string; fileContent?: string }) => {
    const body: any = {}
    if (payload.url) body.url = payload.url
    if (payload.fileContent) body.file_content = payload.fileContent
    if (sessionIdRef.current) body.initial_session_id = sessionIdRef.current

    const response = await fetch(`${API_BASE}/transcript`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.detail || 'Không thể tải phụ đề')
    }
    return response.json()
  }

  const requestUpdate = async (atTime?: number) => {
    if (!videoId || isUpdatingRef.current) return
    const time = atTime ?? currentTimeRef.current
    const callSession = sessionIdRef.current
    isUpdatingRef.current = true
    setIsUpdating(true)

    try {
      setStatus('Đang phân tích...')
      const response = await fetch(`${API_BASE}/update-map`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_id: videoId,
          last_time: time,
          current_map: { markdown: '', nodes: nodesRef.current },
          session_id: sessionIdRef.current,
        }),
      })
      const data = await response.json()
      if (callSession !== sessionIdRef.current) return

      if (data.session_lost || data.reason === 'session_lost') {
        setStatus('Phiên đã hết hạn — đang khôi phục...')
        await recreateSession()
        return
      }

      if (data.should_update && data.diff && Array.isArray(data.diff.nodes) && mindmapRef.current) {
        nodesRef.current = normalizeTree(data.diff.nodes)
        mindmapRef.current.updateTree(titleRef.current, nodesRef.current, { focusNew: true })
        setStatus('Đã cập nhật mindmap')
      } else {
        setStatus(data.reason === 'no_new_content' ? 'Chưa có nội dung mới' : 'Đang chờ thêm nội dung')
      }

      if (typeof data.consumed_until === 'number') {
        lastTriggerRef.current = data.consumed_until
      }
    } catch (e: any) {
      setStatus(`Lỗi cập nhật: ${e.message}`)
    } finally {
      if (callSession === sessionIdRef.current) {
        isUpdatingRef.current = false
        setIsUpdating(false)
      }
    }
  }

  useEffect(() => {
    requestUpdateRef.current = requestUpdate
  })

  const onPlayerReady: YouTubeProps['onReady'] = (event) => {
    setPlayer(event.target)
    setStatus('Trình phát sẵn sàng')
  }

  const handleSeek = useCallback((seconds: number) => {
    if (!player || typeof player.seekTo !== 'function') return
    player.seekTo(seconds, true)
    currentTimeRef.current = seconds
    setCurrentTime(seconds)
    setStatus(`Nhảy đến ${Math.floor(seconds)}s`)
  }, [player])

  const onPlayerStateChange: YouTubeProps['onStateChange'] = (event: any) => {
    const YT = (window as any).YT
    if (event.data === YT.PlayerState.PLAYING) {
      setIsPlaying(true)
      setStatus('Đang phát')
    } else if (event.data === YT.PlayerState.PAUSED) {
      setIsPlaying(false)
      setStatus('Tạm dừng')
    }
  }

  useEffect(() => {
    if (!player || !isPlaying) return

    const interval = setInterval(() => {
      const time = player.getCurrentTime()
      currentTimeRef.current = time
      setCurrentTime(time)
      if (autoUpdate && videoId && transcript.length > 0 && !isUpdatingRef.current) {
        if (time - lastTriggerRef.current >= AUTO_UPDATE_SECONDS) {
          lastTriggerRef.current = time
          requestUpdateRef.current(time)
        }
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [player, isPlaying, autoUpdate, videoId, transcript.length])

  useEffect(() => {
    eventSourceRef.current?.close()
    if (!sessionId) return

    const es = new EventSource(`${API_BASE}/stream/${sessionId}`)
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data?.type === 'session_lost') {
          es.close()
          recreateSession()
          return
        }
        if (data && Array.isArray(data.nodes) && mindmapRef.current) {
          nodesRef.current = normalizeTree(data.nodes)
          mindmapRef.current.updateTree(titleRef.current, nodesRef.current, { focusNew: data?.type === 'diff' })
        }
      } catch (err) {
        console.error('SSE parse error', err)
      }
    }
    es.onerror = () => {
      // keep retrying via native EventSource
    }
    eventSourceRef.current = es

    return () => {
      es.close()
      eventSourceRef.current = null
    }
  }, [sessionId, recreateSession])

  const handleMindMapReady = useCallback(() => {
    mindmapRef.current?.updateTree(titleRef.current, nodesRef.current, { focusNew: false })
  }, [])

  const handleSelectNode = useCallback((nodeId: string) => {
    const node = findNodeById(nodesRef.current, nodeId)
    if (!node) return
    setEditor({
      id: node.id,
      label: node.label,
      note: node.note || '',
      pinned: Boolean(node.pinned),
    })
  }, [])

  const patchNode = useCallback(async (patch: Record<string, unknown>) => {
    const session = sessionIdRef.current
    if (!session) {
      setStatus('Hãy tải video trước khi chỉnh sửa node')
      return null
    }
    try {
      const response = await fetch(`${API_BASE}/node`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: session, ...patch }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (data.detail === 'session_lost') {
          setStatus('Phiên đã hết hạn — đang khôi phục...')
          await recreateSession()
        } else {
          setStatus(`Chỉnh sửa thất bại: ${data.detail || 'lỗi'}`)
        }
        return null
      }
      if (sessionIdRef.current !== session) return null

      nodesRef.current = normalizeTree(data.nodes)
      mindmapRef.current?.updateTree(titleRef.current, nodesRef.current, { focusNew: false })
      return data
    } catch (e: any) {
      setStatus(`Lỗi chỉnh sửa: ${e.message}`)
      return null
    }
  }, [recreateSession])

  const saveEditor = useCallback(async () => {
    if (!editor) return
    const label = editor.label.trim()
    if (!label) {
      setStatus('Node cần có nhãn')
      return
    }
    setIsSaving(true)
    try {
      const data = await patchNode({ node_id: editor.id, label, note: editor.note })
      if (data?.node) {
        setEditor({
          id: data.node.id,
          label: data.node.label,
          note: data.node.note || '',
          pinned: Boolean(data.node.pinned),
        })
        setStatus('Đã lưu node')
      }
    } finally {
      setIsSaving(false)
    }
  }, [editor, patchNode])

  const togglePin = useCallback(async () => {
    if (!editor) return
    const next = !editor.pinned
    setEditor({ ...editor, pinned: next })
    const data = await patchNode({ node_id: editor.id, pinned: next })
    if (data?.node) {
      setEditor((prev) => (prev ? { ...prev, pinned: Boolean(data.node.pinned) } : prev))
      setStatus(data.node.pinned ? 'Đã ghim node' : 'Đã bỏ ghim node')
    }
  }, [editor, patchNode])

  const opts: YouTubeProps['opts'] = {
    height: '100%',
    width: '100%',
    playerVars: {
      autoplay: 0,
      rel: 0,
    },
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="topbar-brand">
            <span className="brand-text">yt-mindmap</span>
          </div>
          <div className="command-bar">
            <input
              className="command-input"
              type="text"
              placeholder="Dán link YouTube tại đây..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLoadVideo()}
            />
            <button className="command-cta" onClick={handleLoadVideo} disabled={isLoading}>
              {isLoading ? 'Đang tải...' : 'Tải video'}
            </button>
          </div>
          <div className="topbar-actions">
            <button className="pill-button" onClick={() => fileInputRef.current?.click()} disabled={isLoading}>
              Tải file .srt / .vtt
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".srt,.vtt"
              style={{ display: 'none' }}
              onChange={handleTranscriptUpload}
            />
            <span className="status-badge">{status}</span>
          </div>
        </div>
      </header>

      <main className="workspace">
        <section className="panel panel-video">
          <div className="panel-body panel-body-video">
            {videoId ? (
              <div className="video-frame">
                <YouTube
                  videoId={videoId}
                  opts={opts}
                  onReady={onPlayerReady}
                  onStateChange={onPlayerStateChange}
                  style={{ height: '100%', width: '100%' }}
                />
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-state-card">
                  <div className="empty-state-title">Bắt đầu tạo mindmap</div>
                  <p className="empty-state-text">
                    Dán link YouTube vào thanh phía trên để tự động tạo mindmap trực tiếp trong lúc bạn xem bài giảng.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="panel panel-mindmap">
          <header className="panel-header">
            <div className="panel-title-group">
              <span className="panel-title">Mind Map</span>
              <span className="panel-subtitle">Thời gian: {currentTime.toFixed(1)}s • Mục: {transcript.length}</span>
            </div>
            <div className="panel-actions">
              <div className="segmented">
                <label className={`segmented-item ${autoUpdate ? 'segmented-item-active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={autoUpdate}
                    onChange={(e) => setAutoUpdate(e.target.checked)}
                  />
                  <span>Tự động cập nhật</span>
                </label>
                <label className={`segmented-item ${focusRecent ? 'segmented-item-active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={focusRecent}
                    onChange={(e) => setFocusRecent(e.target.checked)}
                  />
                  <span>Chỉ xem gần đây</span>
                </label>
              </div>
              <button className="btn-ghost" onClick={() => requestUpdate()} disabled={!videoId || isUpdating || isLoading}>
                {isUpdating ? 'Đang phân tích...' : 'Cập nhật ngay'}
              </button>
            </div>
          </header>
          <div className="panel-body">
            {editor && (
              <div className="node-editor" role="group" aria-label="Chỉnh sửa node">
                <div className="node-editor-head">
                  <strong>Chỉnh sửa node</strong>
                  <button
                    type="button"
                    className="node-editor-close"
                    aria-label="Đóng trình chỉnh sửa"
                    onClick={() => setEditor(null)}
                  >
                    ×
                  </button>
                </div>
                <label>
                  Nhãn
                  <input
                    type="text"
                    value={editor.label}
                    onChange={(e) => setEditor({ ...editor, label: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        saveEditor()
                      }
                    }}
                  />
                </label>
                <label>
                  Ghi chú
                  <textarea
                    rows={2}
                    placeholder="Ghi điều bạn muốn nhớ về node này..."
                    value={editor.note}
                    onChange={(e) => setEditor({ ...editor, note: e.target.value })}
                  />
                </label>
                <div className="node-editor-actions">
                  <label className="node-editor-pin">
                    <input type="checkbox" checked={editor.pinned} onChange={togglePin} />
                    Ghim
                  </label>
                  <button type="button" className="btn-primary btn-small" onClick={saveEditor} disabled={isSaving}>
                    {isSaving ? 'Đang lưu...' : 'Lưu'}
                  </button>
                  <button type="button" className="btn-ghost btn-small" onClick={() => setEditor(null)}>
                    Đóng
                  </button>
                </div>
                <span className="node-editor-hint">Nhấn vào bất kỳ node nào để chỉnh sửa</span>
              </div>
            )}
            <Suspense fallback={<div className="mindmap-loading">Đang tải mindmap...</div>}>
              <MindMap
                ref={mindmapRef}
                onSeek={handleSeek}
                onSelect={handleSelectNode}
                selectedId={editor?.id ?? null}
                collapseOld={focusRecent}
                onReady={handleMindMapReady}
              />
            </Suspense>
            <div className="canvas-toolbar">
              <button className="canvas-btn" title="Phóng to" onClick={() => mindmapRef.current?.zoom?.(0.2)}>
                <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M10 4V16M4 10H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
              <button className="canvas-btn" title="Thu nhỏ" onClick={() => mindmapRef.current?.zoom?.(-0.2)}>
                <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M4 10H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
              <button className="canvas-btn" title="Vừa khung" onClick={() => mindmapRef.current?.fit?.()}>
                <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M4 7V4H7M13 4H16V7M16 13V16H13M7 16H4V13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button className="canvas-btn" title="Căn giữa" onClick={() => mindmapRef.current?.center?.()}>
                <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M10 2V5M10 15V18M2 10H5M15 10H18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
