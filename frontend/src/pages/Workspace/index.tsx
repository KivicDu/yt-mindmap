import { lazy, Suspense, useState, useRef, useEffect, useCallback } from 'react'
import type { ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import YouTube from 'react-youtube'
import type { YouTubeProps } from 'react-youtube'
import './Workspace.css'
import ThemeToggle from '../../components/ThemeToggle'
import { useAuth } from '../../context/AuthContext'
import type { MindMapHandle } from '../../components/MindMap'
import {
  countNodes,
  findNodeById,
  formatTime,
  normalizeTree,
  type MapNode,
} from '../../lib/mindmapTree'
import {
  extractVideoId,
  isCaptionOnlyProblem,
  playerErrorMessage,
  transcriptErrorMessage,
  transcriptStatusText,
  watchUrl,
  type PlayerErrorInfo,
  type VideoInfo,
} from '../../lib/youtube'

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

type StatusKind = 'idle' | 'busy' | 'ok' | 'error'

interface Status {
  kind: StatusKind
  text: string
}

class TranscriptRequestError extends Error {
  readonly code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'TranscriptRequestError'
    this.code = code
  }
}

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8001'
const DEFAULT_TITLE = 'Lecture Mind Map'
const AUTO_UPDATE_SECONDS = 15

function App() {
  const { status: authStatus } = useAuth()
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState('')
  const [videoId, setVideoId] = useState<string | null>(null)
  const [mapTitle, setMapTitle] = useState(DEFAULT_TITLE)
  const [nodeCount, setNodeCount] = useState(0)
  const [player, setPlayer] = useState<any>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [focusRecent, setFocusRecent] = useState(false)
  const [status, setStatusState] = useState<Status>({ kind: 'idle', text: 'Sẵn sàng' })
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [transcriptLang, setTranscriptLang] = useState<string | null>(null)
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null)
  const [playerError, setPlayerError] = useState<PlayerErrorInfo | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [editor, setEditor] = useState<NodeDraft | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const urlInputRef = useRef<HTMLInputElement>(null)
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

  const setStatus = useCallback((text: string, kind: StatusKind = 'idle') => {
    setStatusState({ kind, text })
  }, [])

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  /** Single place that swaps the tree, so the counter can never drift. */
  const applyNodes = useCallback((nodes: MapNode[], focusNew: boolean) => {
    const normalized = normalizeTree(nodes)
    nodesRef.current = normalized
    setNodeCount(countNodes(normalized))
    mindmapRef.current?.updateTree(titleRef.current, normalized, { focusNew })
  }, [])

  const applyLoadResult = (data: any, vid: string, label: string) => {
    if (data.session_id) {
      setSessionId(data.session_id)
      sessionIdRef.current = data.session_id
    }

    if (Array.isArray(data.transcript)) {
      setTranscript(data.transcript)
    }
    setTranscriptLang(typeof data.language === 'string' ? data.language : null)

    const resolvedTitle = data.title || vid || DEFAULT_TITLE
    titleRef.current = resolvedTitle
    setMapTitle(resolvedTitle)

    if (Array.isArray(data.nodes)) {
      applyNodes(data.nodes, false)
    }

    lastTriggerRef.current = Number(data.consumed_until || 0)

    const suffix = data.cached ? ' — khôi phục từ bộ nhớ đệm' : ''
    setStatus(`${label}${suffix} · ${data.transcript?.length || 0} mục phụ đề`, 'ok')
  }

  const recreateSession = useCallback(async () => {
    if (!videoId) return
    try {
      const data = await fetchTranscript({ url })
      applyLoadResult(data, videoId, 'Đã khôi phục phiên làm việc')
    } catch (e: any) {
      setStatus(`Không khôi phục được phiên: ${e.message}`, 'error')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, videoId, setStatus])

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
      const body = await response.json().catch(() => null)
      const detail =
        body && typeof body === 'object' && 'detail' in body ? body.detail : undefined
      const code =
        detail && typeof detail === 'object' && 'code' in detail && typeof detail.code === 'string'
          ? detail.code
          : undefined
      const message =
        detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string'
          ? detail.message
          : typeof detail === 'string'
            ? detail
            : 'Không thể tải phụ đề'
      throw new TranscriptRequestError(message, code)
    }
    return response.json()
  }

  const loadVideo = async (id: string) => {
    const token = ++loadTokenRef.current
    setVideoId(id)
    setPlayer(null)
    setIsPlaying(false)
    setPlayerError(null)
    setVideoInfo(null)
    setTranscript([])
    setTranscriptLang(null)
    setSessionId(null)
    sessionIdRef.current = null
    titleRef.current = DEFAULT_TITLE
    setMapTitle(DEFAULT_TITLE)
    applyNodes([], false)
    setEditor(null)
    setCurrentTime(0)
    currentTimeRef.current = 0
    lastTriggerRef.current = 0
    setIsLoading(true)
    setUrlError('')
    setStatus('Đang tải phụ đề…', 'busy')

    void fetch(
      `${API_BASE}/video-info?url=${encodeURIComponent(watchUrl(id))}`,
    )
      .then(async (response) => (response.ok ? ((await response.json()) as VideoInfo) : null))
      .then((info) => {
        if (info && token === loadTokenRef.current) {
          setVideoInfo(info)
          if (info.title) {
            titleRef.current = info.title
            setMapTitle(info.title)
          }
        }
      })
      .catch((error: unknown) => {
        console.warn('[video-info]', error)
      })

    try {
      const data = await fetchTranscript({ url: watchUrl(id) })
      if (token !== loadTokenRef.current) return
      applyLoadResult(data, id, 'Đã tải phụ đề')
    } catch (error: unknown) {
      if (token === loadTokenRef.current) {
        const code = error instanceof TranscriptRequestError ? error.code : undefined
        console.warn('[transcript]', code || error)
        setStatus(
          transcriptStatusText(code),
          isCaptionOnlyProblem(code) ? 'idle' : 'error',
        )
        setUrlError(transcriptErrorMessage(code))
      }
    } finally {
      if (token === loadTokenRef.current) setIsLoading(false)
    }
  }

  const handleLoadVideo = async () => {
    const trimmed = url.trim()
    if (!trimmed) {
      setUrlError('Dán link YouTube trước đã.')
      setStatus('Chưa có link để tải', 'error')
      urlInputRef.current?.focus()
      return
    }
    const id = extractVideoId(trimmed)
    if (!id) {
      setUrlError('Link chưa đúng dạng. Ví dụ: https://www.youtube.com/watch?v=…')
      setStatus('Link YouTube không hợp lệ', 'error')
      urlInputRef.current?.focus()
      return
    }
    await loadVideo(id)
  }

  const handleTranscriptUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const token = ++loadTokenRef.current
    setIsLoading(true)
    setUrlError('')
    setStatus(`Đang đọc ${file.name}…`, 'busy')
    try {
      const text = await file.text()
      const data = await fetchTranscript({ url, fileContent: text })
      if (token !== loadTokenRef.current) return
      const id = extractVideoId(url)
      applyLoadResult(data, id || videoId || '', 'Đã tải phụ đề từ file')
      if (id) setVideoId(id)
      setEditor(null)
    } catch (e: any) {
      if (token === loadTokenRef.current) {
        setStatus(`Không đọc được file: ${e.message}`, 'error')
      }
    } finally {
      if (token === loadTokenRef.current) setIsLoading(false)
      if (event.target) event.target.value = ''
    }
  }

  const requestUpdate = async (atTime?: number) => {
    if (!videoId || isUpdatingRef.current) return
    const time = atTime ?? currentTimeRef.current
    const callSession = sessionIdRef.current
    isUpdatingRef.current = true
    setIsUpdating(true)

    try {
      setStatus('Đang phân tích nội dung mới…', 'busy')
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
        setStatus('Phiên đã hết hạn — đang khôi phục…', 'busy')
        await recreateSession()
        return
      }

      if (data.should_update && data.diff && Array.isArray(data.diff.nodes) && mindmapRef.current) {
        applyNodes(data.diff.nodes, true)
        setStatus('Đã thêm nhánh mới vào sơ đồ', 'ok')
      } else {
        setStatus(
          data.reason === 'no_new_content' ? 'Chưa có nội dung mới' : 'Đang chờ thêm nội dung',
          'idle',
        )
      }

      if (typeof data.consumed_until === 'number') {
        lastTriggerRef.current = data.consumed_until
      }
    } catch (e: any) {
      setStatus(`Không cập nhật được: ${e.message}`, 'error')
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
    // Deliberately silent: the player becoming ready is visible on screen, and
    // announcing it here would overwrite the more useful "đã tải phụ đề" line
    // that almost always arrives at the same moment.
  }

  const onPlayerError: YouTubeProps['onError'] = (event) => {
    const error = playerErrorMessage(event.data)
    setPlayerError(error)
    setStatus(error.title, 'error')
  }

  const handleSeek = useCallback(
    (seconds: number) => {
      if (!player || typeof player.seekTo !== 'function') return
      player.seekTo(seconds, true)
      currentTimeRef.current = seconds
      setCurrentTime(seconds)
      setStatus(`Đã tua đến ${formatTime(seconds)}`, 'idle')
    },
    [player, setStatus],
  )

  const onPlayerStateChange: YouTubeProps['onStateChange'] = (event: any) => {
    const YT = (window as any).YT
    if (event.data === YT.PlayerState.PLAYING) {
      setIsPlaying(true)
      setStatus('Đang phát', 'ok')
    } else if (event.data === YT.PlayerState.PAUSED) {
      setIsPlaying(false)
      setStatus('Tạm dừng', 'idle')
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
          applyNodes(data.nodes, data?.type === 'diff')
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
  }, [sessionId, recreateSession, applyNodes])

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

  const patchNode = useCallback(
    async (patch: Record<string, unknown>) => {
      const session = sessionIdRef.current
      if (!session) {
        setStatus('Hãy tải video trước khi chỉnh sửa node', 'error')
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
            setStatus('Phiên đã hết hạn — đang khôi phục…', 'busy')
            await recreateSession()
          } else {
            setStatus(`Chỉnh sửa thất bại: ${data.detail || 'lỗi không rõ'}`, 'error')
          }
          return null
        }
        if (sessionIdRef.current !== session) return null

        applyNodes(data.nodes, false)
        return data
      } catch (e: any) {
        setStatus(`Không chỉnh sửa được: ${e.message}`, 'error')
        return null
      }
    },
    [recreateSession, applyNodes, setStatus],
  )

  const saveEditor = useCallback(async () => {
    if (!editor) return
    const label = editor.label.trim()
    if (!label) {
      setStatus('Node cần có nhãn', 'error')
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
        setStatus('Đã lưu node', 'ok')
      }
    } finally {
      setIsSaving(false)
    }
  }, [editor, patchNode, setStatus])

  const togglePin = useCallback(async () => {
    if (!editor) return
    const next = !editor.pinned
    setEditor({ ...editor, pinned: next })
    const data = await patchNode({ node_id: editor.id, pinned: next })
    if (data?.node) {
      setEditor((prev) => (prev ? { ...prev, pinned: Boolean(data.node.pinned) } : prev))
      setStatus(data.node.pinned ? 'Đã ghim node' : 'Đã bỏ ghim node', 'ok')
    }
  }, [editor, patchNode, setStatus])

  const opts: YouTubeProps['opts'] = {
    height: '100%',
    width: '100%',
    playerVars: {
      autoplay: 0,
      rel: 0,
    },
  }

  const lastEntry = transcript[transcript.length - 1]
  const totalSeconds = lastEntry ? lastEntry.start + (lastEntry.duration || 0) : 0
  const progress = totalSeconds > 0 ? Math.min(100, (currentTime / totalSeconds) * 100) : 0
  const playbackError = playerError

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="app-topbar__row">
          <Link className="app-brand" to="/" aria-label="yt-mindmap — về trang chủ">
            <img className="app-brand__mark" src="/yt-mindmap-icon.png" alt="" aria-hidden="true" />
            <span className="app-brand__text">yt-mindmap</span>
          </Link>

          <form
            className="url-bar"
            onSubmit={(event) => {
              event.preventDefault()
              void handleLoadVideo()
            }}
          >
            <label className="sr-only" htmlFor="video-url">
              Link video YouTube
            </label>
            <svg className="url-bar__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M8.2 11.8 11.8 8.2M7.4 5.8l1.2-1.2a3.4 3.4 0 1 1 4.8 4.8l-1.2 1.2M12.6 14.2l-1.2 1.2a3.4 3.4 0 1 1-4.8-4.8l1.2-1.2"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <input
              id="video-url"
              ref={urlInputRef}
              className="url-bar__input"
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="Dán link YouTube hoặc ID video"
              value={url}
              aria-invalid={Boolean(urlError)}
              aria-describedby={urlError ? 'url-error' : undefined}
              onChange={(event) => {
                setUrl(event.target.value)
                if (urlError) setUrlError('')
              }}
            />
            <button className="btn btn--primary btn--sm" type="submit" disabled={isLoading}>
              {isLoading ? 'Đang tải…' : 'Tải video'}
            </button>
          </form>

          <div className="app-topbar__actions">
            <button
              className="btn btn--ghost btn--sm app-topbar__upload"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  d="M10 13V4m0 0L6.6 7.4M10 4l3.4 3.4M4 13.5V15a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 16 15v-1.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="app-topbar__upload-label">Tải .srt/.vtt</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".srt,.vtt"
              className="sr-only"
              tabIndex={-1}
              aria-label="Tải file phụ đề .srt hoặc .vtt"
              onChange={handleTranscriptUpload}
            />

            <span className="app-topbar__divider" aria-hidden="true" />

            <Link
              className="btn btn--ghost btn--sm app-topbar__account"
              to={authStatus === 'authenticated' ? '/dashboard' : '/login'}
            >
              {authStatus === 'authenticated' ? 'Dashboard' : 'Đăng nhập'}
            </Link>
            <ThemeToggle />
          </div>
        </div>

        {urlError && (
          <p className="app-topbar__error" id="url-error" role="alert">
            {urlError}
          </p>
        )}

        <div className={`app-status app-status--${status.kind}`} role="status" aria-live="polite">
          <span className="app-status__dot" aria-hidden="true" />
          <span className="app-status__text">{status.text}</span>
          <span className="app-status__meta">
            {transcript.length > 0 && <span>{transcript.length} mục phụ đề</span>}
            {videoId && <span className="app-status__time">{formatTime(currentTime)}</span>}
          </span>
        </div>
      </header>

      <main className="workspace">
        <section className="panel panel--player" aria-label="Bài giảng">
          <header className="panel__head">
            <h2 className="panel__title">Bài giảng</h2>
            <span className="panel__meta">{videoId ? 'YouTube' : 'Chưa tải'}</span>
          </header>

          <div className="player">
            {videoId ? (
              videoInfo?.embeddable === false ? (
                <div className="player__empty player__blocked" role="status">
                  <span className="player__empty-glyph" aria-hidden="true">
                    !
                  </span>
                  <h3>Không thể phát trong trang này</h3>
                  <p>
                    YouTube từ chối nhúng video này — có thể video để riêng tư, đã bị xoá,
                    giới hạn độ tuổi/khu vực, hoặc chủ video đã tắt “Allow embedding”.
                  </p>
                  <a
                    className="btn btn--outline btn--sm"
                    href={watchUrl(videoId)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Mở trên YouTube
                  </a>
                </div>
              ) : (
                <div className="player__frame">
                  <YouTube
                    videoId={videoId}
                    opts={opts}
                    onReady={onPlayerReady}
                    onStateChange={onPlayerStateChange}
                    onError={onPlayerError}
                    style={{ height: '100%', width: '100%' }}
                  />
                  {playbackError && (
                    <div className="player__notice" role="alert">
                      <h3>{playbackError.title}</h3>
                      <p>{playbackError.message}</p>
                      <a href={watchUrl(videoId)} target="_blank" rel="noopener noreferrer">
                        Mở trên YouTube
                      </a>
                    </div>
                  )}
                </div>
              )
            ) : (
              <div className="player__empty">
                <span className="player__empty-glyph" aria-hidden="true">
                  ▶
                </span>
                <h3>Chưa có bài giảng</h3>
                <p>
                  Dán link YouTube ở thanh trên để bắt đầu. Video không có phụ đề? Tải file
                  .srt/.vtt.
                </p>
              </div>
            )}
          </div>

          <div className="player__foot">
            <span className="player__clock">{formatTime(currentTime)}</span>
            <span className="player__track" aria-hidden="true">
              <span className="player__track-fill" style={{ width: `${progress}%` }} />
            </span>
            <span className="player__clock player__clock--muted">
              {totalSeconds > 0 ? formatTime(totalSeconds) : '—:—'}
            </span>
          </div>
        </section>

        <section className="panel panel--details" aria-label="Chi tiết phiên học">
          <header className="panel__head">
            <h2 className="panel__title">{editor ? 'Chỉnh sửa node' : 'Phiên học'}</h2>
            {editor ? (
              <button
                type="button"
                className="btn btn--icon btn--sm"
                aria-label="Đóng trình chỉnh sửa"
                onClick={() => setEditor(null)}
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="m5.5 5.5 9 9m0-9-9 9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            ) : (
              <span className="panel__meta">{nodeCount > 0 ? `${nodeCount} ý` : 'Trống'}</span>
            )}
          </header>

          <div className="panel__body panel__body--details">
            {editor ? (
              <div className="node-editor">
                <div className="node-editor__field">
                  <label className="field-label" htmlFor="node-label">
                    Nhãn
                  </label>
                  <input
                    id="node-label"
                    className="field"
                    type="text"
                    autoFocus
                    value={editor.label}
                    onChange={(e) => setEditor({ ...editor, label: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void saveEditor()
                      }
                    }}
                  />
                </div>

                <div className="node-editor__field">
                  <label className="field-label" htmlFor="node-note">
                    Ghi chú
                  </label>
                  <textarea
                    id="node-note"
                    className="field"
                    rows={4}
                    placeholder="Điều bạn muốn nhớ về ý này…"
                    value={editor.note}
                    onChange={(e) => setEditor({ ...editor, note: e.target.value })}
                  />
                  <span className="field-hint">Ghi chú hiện ngay dưới nhãn trong sơ đồ.</span>
                </div>

                <label className="node-editor__pin">
                  <input
                    type="checkbox"
                    checked={editor.pinned}
                    onChange={() => void togglePin()}
                  />
                  <span>Ghim nhánh này</span>
                </label>
                <span className="field-hint">
                  Nhánh được ghim sẽ không bị thu gọn ở chế độ “Gần đây”.
                </span>

                <div className="node-editor__actions">
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    onClick={() => void saveEditor()}
                    disabled={isSaving}
                  >
                    {isSaving ? 'Đang lưu…' : 'Lưu'}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setEditor(null)}
                  >
                    Hủy
                  </button>
                </div>
              </div>
            ) : (
              <div className="session">
                <div className="session__title">
                  <span className="session__label">Chủ đề</span>
                  <strong>{mapTitle}</strong>
                </div>

                <dl className="session__rows">
                  <div>
                    <dt>Video</dt>
                    <dd>{videoId || '—'}</dd>
                  </div>
                  <div>
                    <dt>Phụ đề</dt>
                    <dd>
                      {transcript.length > 0
                        ? `${transcript.length} mục${transcriptLang ? ` · ${transcriptLang}` : ''}`
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>Ý trong sơ đồ</dt>
                    <dd>{nodeCount > 0 ? nodeCount : '—'}</dd>
                  </div>
                  <div>
                    <dt>Thời điểm</dt>
                    <dd>{videoId ? formatTime(currentTime) : '—'}</dd>
                  </div>
                </dl>

                <div className="session__hint">
                  <span className="session__hint-title">Mẹo</span>
                  <p>
                    Nhấn vào một nhánh có mốc thời gian để tua video tới đúng đoạn. Nhấn vào
                    nhãn (không phải mốc giờ) để sửa nội dung.
                  </p>
                </div>

                <p className="session__keys">
                  <span className="kbd">+</span>
                  <span className="kbd">−</span> thu phóng
                  <span className="kbd">0</span> vừa khung
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="panel panel--canvas" aria-label="Sơ đồ tư duy">
          <header className="panel__head panel__head--canvas">
            <div className="panel__heading">
              <h2 className="panel__title">Sơ đồ tư duy</h2>
              <p className="panel__sub">
                {nodeCount > 0
                  ? `${nodeCount} ý · cập nhật theo tiến trình xem`
                  : 'Sơ đồ sẽ hình thành khi video bắt đầu'}
              </p>
            </div>

            <div className="panel__actions">
              <div className="segmented" role="group" aria-label="Chế độ sơ đồ">
                <button
                  type="button"
                  className="segmented__item"
                  aria-pressed={autoUpdate}
                  title={`Tự động phân tích thêm nội dung mỗi ${AUTO_UPDATE_SECONDS} giây`}
                  onClick={() => setAutoUpdate((value) => !value)}
                >
                  Tự động
                </button>
                <button
                  type="button"
                  className="segmented__item"
                  aria-pressed={focusRecent}
                  title="Thu gọn các nhánh cũ, chỉ giữ lại 3 nhánh mới nhất"
                  onClick={() => setFocusRecent((value) => !value)}
                >
                  Gần đây
                </button>
              </div>

              <button
                type="button"
                className="btn btn--outline btn--sm"
                onClick={() => void requestUpdate()}
                disabled={!videoId || isUpdating || isLoading}
              >
                {isUpdating && <span className="spinner" aria-hidden="true" />}
                {isUpdating ? 'Đang phân tích…' : 'Cập nhật'}
              </button>
            </div>
          </header>

          <div className="panel__body panel__body--canvas">
            <Suspense fallback={<div className="canvas-loading">Đang tải sơ đồ…</div>}>
              <MindMap
                ref={mindmapRef}
                onSeek={handleSeek}
                onSelect={handleSelectNode}
                selectedId={editor?.id ?? null}
                collapseOld={focusRecent}
                onReady={handleMindMapReady}
              />
            </Suspense>

            <div className="canvas-toolbar" role="group" aria-label="Điều khiển sơ đồ">
              <button
                type="button"
                className="canvas-toolbar__btn"
                aria-label="Thu nhỏ"
                title="Thu nhỏ (−)"
                onClick={() => mindmapRef.current?.zoom(1 / 1.2)}
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M5 10h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
              <button
                type="button"
                className="canvas-toolbar__btn"
                aria-label="Phóng to"
                title="Phóng to (+)"
                onClick={() => mindmapRef.current?.zoom(1.2)}
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M10 5v10M5 10h10"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              <span className="canvas-toolbar__divider" aria-hidden="true" />
              <button
                type="button"
                className="canvas-toolbar__btn"
                aria-label="Vừa khung"
                title="Vừa khung (0)"
                onClick={() => mindmapRef.current?.fit()}
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M4 7V4h3M13 4h3v3M16 13v3h-3M7 16H4v-3"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                className="canvas-toolbar__btn"
                aria-label="Căn giữa"
                title="Căn giữa"
                onClick={() => mindmapRef.current?.center()}
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <circle cx="10" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.6" />
                  <path
                    d="M10 3v3M10 14v3M3 10h3M14 10h3"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
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
