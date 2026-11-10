import { lazy, Suspense, useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import YouTube from 'react-youtube'
import type { YouTubeProps } from 'react-youtube'
import './Workspace.css'
import ThemeToggle from '../../components/ThemeToggle'
import ExportMenu from '../../components/ExportMenu'
import ShortcutHelp from '../../components/ShortcutHelp'
import TranscriptPanel, {
  type TranscriptCue as TranscriptEntry,
} from '../../components/TranscriptPanel'
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
  autosaveProject,
  clearLocalDraft,
  formatWhen,
  listProjectVersions,
  readLocalDraft,
  restoreProjectVersion,
  updateProject,
  writeLocalDraft,
  type LocalDraft,
  type ProjectVersionSummary,
} from '../../lib/projects'
import { getAccessToken, refreshSession } from '../../lib/api'
import { exportMap, type ExportFormat } from '../../lib/mapExport'
import { SkeletonList } from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/useToast'
import { activeChapter, buildChapters } from '../../lib/chapters'
import { isTypingTarget, shortcutFor } from '../../lib/shortcuts'
import {
  extractVideoId,
  fetchTranscriptTrack,
  isCaptionOnlyProblem,
  listTranscriptLanguages,
  playerErrorMessage,
  transcriptErrorMessage,
  transcriptStatusText,
  TranscriptLanguagesError,
  watchUrl,
  type PlayerErrorInfo,
  type TranscriptLanguage,
  type VideoInfo,
} from '../../lib/youtube'

// markmap + d3 are heavy; load them after the player shell is interactive.
const MindMap = lazy(() => import('../../components/MindMap'))

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
const AUTOSAVE_SECONDS = 2.5

type SessionRole = 'owner' | 'editor' | 'viewer'

type DetailTab = 'session' | 'transcript' | 'history'

/**
 * `/node` and `/update-map` are outside `/api` because they belong to the
 * live-session module, so they need the bearer token attached by hand. A
 * shared editor's writes must be attributable, and a viewer must stay read-only.
 */
async function sessionRequest(
  path: string,
  method: string,
  body: unknown,
): Promise<Response> {
  const send = () => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const token = getAccessToken()
    if (token) headers.Authorization = `Bearer ${token}`
    return fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: JSON.stringify(body),
    })
  }

  let response = await send()
  if (response.status === 401 && getAccessToken()) {
    if (await refreshSession()) response = await send()
  }
  return response
}

function App() {
  const { status: authStatus } = useAuth()
  const toast = useToast()
  const { projectId: routeProjectId } = useParams<{ projectId?: string }>()
  const navigate = useNavigate()
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
  const [mapVersion, setMapVersion] = useState(0)
  const [consumedUntil, setConsumedUntil] = useState(0)
  const [projectId, setProjectId] = useState<string | null>(routeProjectId ?? null)
  const [isDraft, setIsDraft] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [saveDialog, setSaveDialog] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [pendingDraft, setPendingDraft] = useState<LocalDraft | null>(null)
  const [role, setRole] = useState<SessionRole | null>(null)
  const [ownerName, setOwnerName] = useState<string | null>(null)
  const [summary, setSummary] = useState('')
  const [detailTab, setDetailTab] = useState<DetailTab>('session')
  const [versions, setVersions] = useState<ProjectVersionSummary[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [versionsError, setVersionsError] = useState('')
  const [restoringVersion, setRestoringVersion] = useState<string | null>(null)
  const [languages, setLanguages] = useState<TranscriptLanguage[]>([])
  const [languagesLoading, setLanguagesLoading] = useState(false)
  const [languagesError, setLanguagesError] = useState('')
  const [languageBusy, setLanguageBusy] = useState(false)
  const [bilingual, setBilingual] = useState(false)
  const [secondaryEntries, setSecondaryEntries] = useState<TranscriptEntry[]>([])
  const [secondaryLang, setSecondaryLang] = useState<string | null>(null)
  const [secondaryBusy, setSecondaryBusy] = useState(false)
  const [secondaryError, setSecondaryError] = useState('')
  const [exporting, setExporting] = useState<ExportFormat | null>(null)
  const [showHelp, setShowHelp] = useState(false)

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
  const projectIdRef = useRef<string | null>(routeProjectId ?? null)
  const saveRef = useRef<() => Promise<boolean>>(async () => false)
  const languagesLoadedRef = useRef(false)
  const languagesRequestRef = useRef(false)
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const setStatus = useCallback((text: string, kind: StatusKind = 'idle') => {
    setStatusState({ kind, text })
  }, [])

  // `null` means a fresh local session, which is editable by definition.
  const canEdit = role !== 'viewer'

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  /** Persist the live session. Returns false when the API refused the write. */
  const saveNow = useCallback(
    async (options?: { title?: string; promote?: boolean }): Promise<boolean> => {
      const session = sessionIdRef.current
      if (!session || authStatus !== 'authenticated' || !canEdit) return false
      setSaveState('saving')
      try {
        const summary = await autosaveProject({
          session_id: session,
          project_id: projectIdRef.current,
        })
        projectIdRef.current = summary.id
        setProjectId(summary.id)
        setIsDraft(summary.is_draft)

        if (options?.promote || options?.title) {
          const title = options.title?.trim()
          const saved = await updateProject(summary.id, {
            ...(title ? { title } : {}),
            ...(options.promote ? { is_draft: false } : {}),
          })
          setIsDraft(saved.is_draft)
          titleRef.current = saved.title
          setMapTitle(saved.title)
        }

        setSavedAt(new Date())
        setSaveState('saved')
        return true
      } catch (error) {
        console.warn('[autosave]', error)
        setSaveState('error')
        return false
      }
    },
    [authStatus, canEdit],
  )

  useEffect(() => {
    saveRef.current = saveNow
  }, [saveNow])

  // Debounced autosave after the AI adds a branch or the pointer moves.
  useEffect(() => {
    if (authStatus !== 'authenticated' || !sessionId || !canEdit) return
    const timer = setTimeout(() => {
      void saveRef.current()
    }, AUTOSAVE_SECONDS * 1000)
    return () => clearTimeout(timer)
  }, [authStatus, sessionId, mapVersion, consumedUntil, canEdit])

  // Guests get a browser-only draft so a reload does not lose the map.
  useEffect(() => {
    if (authStatus !== 'anonymous' || !videoId || mapVersion === 0) return
    const timer = setTimeout(() => {
      writeLocalDraft({
        videoId,
        url: watchUrl(videoId),
        title: mapTitle,
        nodes: nodesRef.current,
        consumedUntil,
        language: transcriptLang,
        savedAt: new Date().toISOString(),
      })
      setSavedAt(new Date())
      setSaveState('saved')
    }, 900)
    return () => clearTimeout(timer)
  }, [authStatus, videoId, mapVersion, consumedUntil, mapTitle, transcriptLang])

  // Signing in moves the map to the account; the browser copy is then stale.
  useEffect(() => {
    if (authStatus === 'authenticated') {
      clearLocalDraft()
      setPendingDraft(null)
    }
  }, [authStatus])

  /** Single place that swaps the tree, so the counter can never drift. */
  const applyNodes = useCallback((nodes: MapNode[], focusNew: boolean) => {
    const normalized = normalizeTree(nodes)
    nodesRef.current = normalized
    setNodeCount(countNodes(normalized))
    setMapVersion((version) => version + 1)
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
    setSummary(typeof data.summary === 'string' ? data.summary : '')
    setLanguages([])
    setLanguagesError('')
    languagesLoadedRef.current = false
    setBilingual(false)
    setSecondaryEntries([])
    setSecondaryLang(null)
    setSecondaryBusy(false)
    setSecondaryError('')

    const resolvedTitle = data.title || vid || DEFAULT_TITLE
    titleRef.current = resolvedTitle
    setMapTitle(resolvedTitle)

    if (Array.isArray(data.nodes)) {
      applyNodes(data.nodes, false)
    }

    if (data.role === 'owner' || data.role === 'editor' || data.role === 'viewer') {
      setRole(data.role)
    } else {
      setRole(null)
    }
    setOwnerName(typeof data.owner_name === 'string' ? data.owner_name : null)

    lastTriggerRef.current = Number(data.consumed_until || 0)
    setConsumedUntil(Number(data.consumed_until || 0))

    const suffix = data.cached ? ' — khôi phục từ bộ nhớ đệm' : ''
    setStatus(`${label}${suffix} · ${data.transcript?.length || 0} mục phụ đề`, 'ok')
  }

  const recreateSession = useCallback(async () => {
    if (!videoId) return
    try {
      const data = await fetchTranscript(
        projectIdRef.current ? { projectId: projectIdRef.current } : { url },
      )
      applyLoadResult(data, videoId, 'Đã khôi phục phiên làm việc')
    } catch (e: any) {
      setStatus(`Không khôi phục được phiên: ${e.message}`, 'error')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, videoId, setStatus])

  const fetchTranscript = async (payload: {
    url?: string
    fileContent?: string
    projectId?: string
    initialNodes?: MapNode[]
    resumeAt?: number
    title?: string
  }) => {
    const body: any = {}
    if (payload.url) body.url = payload.url
    if (payload.fileContent) body.file_content = payload.fileContent
    if (payload.projectId) body.project_id = payload.projectId
    if (payload.initialNodes) body.initial_nodes = payload.initialNodes
    if (payload.resumeAt !== undefined) body.resume_at = payload.resumeAt
    if (payload.title) body.title = payload.title

    const send = () => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      // Saved projects are owner-only, so reopening one needs the access token.
      // Guests have none and the endpoint still works for them.
      const token = getAccessToken()
      if (token) headers.Authorization = `Bearer ${token}`
      return fetch(`${API_BASE}/transcript`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
    }

    let response = await send()
    if (response.status === 401 && getAccessToken()) {
      if (await refreshSession()) response = await send()
    }

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
      throw new TranscriptRequestError(message, code ?? (typeof detail === 'string' ? detail : undefined))
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
    setSummary('')
    setDetailTab('session')
    setVersions([])
    setVersionsError('')
    setVersionsLoading(false)
    setLanguages([])
    setLanguagesError('')
    setLanguagesLoading(false)
    setLanguageBusy(false)
    setBilingual(false)
    setSecondaryEntries([])
    setSecondaryLang(null)
    setSecondaryBusy(false)
    setSecondaryError('')
    setExporting(null)
    languagesLoadedRef.current = false
    languagesRequestRef.current = false
    setSessionId(null)
    sessionIdRef.current = null
    setConsumedUntil(0)
    setProjectId(null)
    projectIdRef.current = null
    setIsDraft(false)
    setRole(null)
    setOwnerName(null)
    setSavedAt(null)
    setSaveState('idle')
    if (routeProjectId) navigate('/app', { replace: true })
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

  const restoreDraft = async () => {
    const draft = pendingDraft
    if (!draft) return
    const token = ++loadTokenRef.current
    setIsLoading(true)
    setUrlError('')
    setUrl(draft.url)
    setStatus('Đang khôi phục bản nháp…', 'busy')
    try {
      const data = await fetchTranscript({
        url: draft.url,
        initialNodes: draft.nodes,
        resumeAt: draft.consumedUntil,
        title: draft.title,
      })
      if (token !== loadTokenRef.current) return
      const id = draft.videoId || extractVideoId(draft.url)
      if (id) setVideoId(id)
      applyLoadResult(data, id || '', 'Đã khôi phục bản nháp trong trình duyệt')
      setPendingDraft(null)
    } catch (error: unknown) {
      if (token === loadTokenRef.current) {
        const code = error instanceof TranscriptRequestError ? error.code : undefined
        setStatus(transcriptStatusText(code), 'error')
        setUrlError(transcriptErrorMessage(code))
      }
    } finally {
      if (token === loadTokenRef.current) setIsLoading(false)
    }
  }

  const discardDraft = () => {
    clearLocalDraft()
    setPendingDraft(null)
  }

  const openSaveDialog = () => {
    setDraftTitle(mapTitle)
    setSaveDialog(true)
  }

  const confirmSave = async () => {
    const saved = await saveNow({ title: draftTitle, promote: true })
    if (saved) {
      setSaveDialog(false)
      setStatus('Đã lưu dự án vào tài khoản', 'ok')
    } else {
      setStatus('Chưa lưu được dự án — kiểm tra kết nối rồi thử lại', 'error')
    }
  }

  useEffect(() => {
    if (routeProjectId) return
    setPendingDraft(readLocalDraft())
  }, [routeProjectId])

  // Open a saved project from /app/:id. The row already holds the captions,
  // nodes and AI pointer, so no YouTube request is needed.
  useEffect(() => {
    if (!routeProjectId) return
    const token = ++loadTokenRef.current
    setIsLoading(true)
    setUrlError('')
    setStatus('Đang mở dự án…', 'busy')
    setProjectId(routeProjectId)
    projectIdRef.current = routeProjectId
    setIsDraft(false)
    setDetailTab('session')
    setVersions([])
    fetchTranscript({ projectId: routeProjectId })
      .then((data) => {
        if (token !== loadTokenRef.current) return
        applyLoadResult(data, data.video_id || '', 'Đã mở dự án')
        setVideoId(data.video_id || null)
        setUrl(data.video_id ? watchUrl(data.video_id) : '')
        setSavedAt(new Date())
      })
      .catch((error: unknown) => {
        if (token !== loadTokenRef.current) return
        const code = error instanceof TranscriptRequestError ? error.code : undefined
        setStatus('Không mở được dự án', 'error')
        setUrlError(
          code === 'project_not_found'
            ? 'Dự án không tồn tại hoặc bạn không có quyền mở.'
            : 'Không mở được dự án đã lưu.',
        )
      })
      .finally(() => {
        if (token === loadTokenRef.current) setIsLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeProjectId])

  const requestUpdate = async (atTime?: number) => {
    if (!videoId || isUpdatingRef.current || !canEdit) return
    const time = atTime ?? currentTimeRef.current
    const callSession = sessionIdRef.current
    isUpdatingRef.current = true
    setIsUpdating(true)

    try {
      setStatus('Đang phân tích nội dung mới…', 'busy')
      const response = await sessionRequest('/update-map', 'POST', {
        video_id: videoId,
        last_time: time,
        current_map: { markdown: '', nodes: nodesRef.current },
        session_id: sessionIdRef.current,
      })
      const data = await response.json()
      if (callSession !== sessionIdRef.current) return

      if (!response.ok) {
        const detail = data && typeof data.detail === 'object' ? data.detail : null
        const code = typeof data?.detail === 'string' ? data.detail : detail?.code
        setStatus(
          code === 'project_read_only'
            ? 'Dự án này chỉ cho phép xem'
            : code === 'rate_limited'
              ? 'Bạn thao tác quá nhanh — chờ một chút rồi thử lại'
              : code === 'ai_quota_exceeded'
                ? 'Đã hết hạn mức AI hôm nay. Đăng nhập hoặc thử lại vào ngày mai.'
                : 'Không cập nhật được sơ đồ',
          'error',
        )
        return
      }

      if (data.session_lost || data.reason === 'session_lost') {
        setStatus('Phiên đã hết hạn — đang khôi phục…', 'busy')
        await recreateSession()
        return
      }

      if (data.reason === 'busy') {
        setStatus('Người khác đang cập nhật sơ đồ…', 'idle')
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

      const nextSummary =
        typeof data.summary === 'string' ? data.summary : data.diff?.summary
      if (typeof nextSummary === 'string') setSummary(nextSummary)

      if (typeof data.consumed_until === 'number') {
        lastTriggerRef.current = data.consumed_until
        setConsumedUntil(data.consumed_until)
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

  /** Caption tracks are fetched only when the picker is opened. */
  const loadLanguages = useCallback(async (): Promise<TranscriptLanguage[]> => {
    if (languagesLoadedRef.current || languagesRequestRef.current) return []
    const id = videoId || extractVideoId(url)
    if (!id) return []
    languagesRequestRef.current = true
    setLanguagesLoading(true)
    setLanguagesError('')
    try {
      const items = await listTranscriptLanguages(watchUrl(id))
      setLanguages(items)
      languagesLoadedRef.current = true
      return items
    } catch (error: unknown) {
      const code = error instanceof TranscriptLanguagesError ? error.code : undefined
      setLanguagesError(transcriptErrorMessage(code))
      return []
    } finally {
      languagesRequestRef.current = false
      setLanguagesLoading(false)
    }
  }, [videoId, url])

  /** Swap the caption track in the live session; the map is left untouched. */
  const switchLanguage = async (code: string) => {
    const session = sessionIdRef.current
    if (!session || languageBusy) return
    setLanguageBusy(true)
    setLanguagesError('')
    setStatus('Đang đổi ngôn ngữ phụ đề…', 'busy')
    try {
      const response = await sessionRequest('/transcript', 'POST', {
        session_id: session,
        language: code,
      })
      const data = await response.json().catch(() => ({}))
      if (sessionIdRef.current !== session) return
      if (!response.ok) {
        const detail = data?.detail
        const detailCode =
          detail && typeof detail === 'object' ? detail.code : typeof detail === 'string' ? detail : undefined
        setStatus(
          detailCode === 'project_read_only'
            ? 'Dự án này chỉ cho phép xem'
            : 'Không đổi được ngôn ngữ phụ đề',
          'error',
        )
        return
      }
      if (Array.isArray(data.transcript)) setTranscript(data.transcript)
      setTranscriptLang(typeof data.language === 'string' ? data.language : code)
      setStatus(`Đã đổi phụ đề sang ${data.language || code}`, 'ok')
    } catch (error: any) {
      setStatus(`Không đổi được ngôn ngữ: ${error.message}`, 'error')
    } finally {
      setLanguageBusy(false)
    }
  }

  /** Load a second caption track for the bilingual view, without switching. */
  const loadSecondary = async (code: string) => {
    const id = videoId || extractVideoId(url)
    if (!id) return
    setSecondaryLang(code)
    setSecondaryBusy(true)
    setSecondaryError('')
    try {
      const data = await fetchTranscriptTrack(watchUrl(id), code)
      setSecondaryEntries(data.transcript)
      setSecondaryLang(data.language || code)
    } catch (error: unknown) {
      const message =
        error instanceof TranscriptLanguagesError
          ? transcriptErrorMessage(error.code)
          : 'Không tải được phụ đề song ngữ.'
      setSecondaryEntries([])
      setSecondaryError(message)
    } finally {
      setSecondaryBusy(false)
    }
  }

  const toggleBilingual = async () => {
    if (bilingual) {
      setBilingual(false)
      return
    }
    setBilingual(true)
    if (secondaryEntries.length > 0) return
    const items = languagesLoadedRef.current ? languages : await loadLanguages()
    const candidate = items.find((item) => item.code !== transcriptLang)
    if (candidate) {
      await loadSecondary(candidate.code)
    } else if (items.length > 0) {
      setSecondaryError('Video chỉ có một track phụ đề, chưa thể hiện song ngữ.')
    }
  }

  const handleExport = async (format: ExportFormat) => {
    if (nodeCount === 0) {
      setStatus('Chưa có nội dung để xuất — hãy tạo sơ đồ trước', 'idle')
      return
    }
    setExporting(format)
    setStatus(`Đang xuất ${format.toUpperCase()}…`, 'busy')
    try {
      await exportMap(format, {
        title: mapTitle,
        nodes: nodesRef.current,
        svg: mindmapRef.current?.getSvg() ?? null,
        bounds: mindmapRef.current?.getBounds() ?? null,
      })
      setStatus(`Đã xuất ${format.toUpperCase()}`, 'ok')
    } catch (error: any) {
      setStatus(error?.message || 'Không xuất được sơ đồ', 'error')
    } finally {
      setExporting(null)
    }
  }

  const loadVersions = useCallback(async () => {
    const id = projectIdRef.current
    if (!id) return
    setVersionsLoading(true)
    setVersionsError('')
    try {
      const data = await listProjectVersions(id)
      setVersions(data.items)
    } catch {
      setVersionsError('Không tải được lịch sử phiên bản.')
    } finally {
      setVersionsLoading(false)
    }
  }, [])

  const openHistory = useCallback(() => {
    setDetailTab('history')
    void loadVersions()
  }, [loadVersions])

  const restoreVersion = async (version: ProjectVersionSummary) => {
    const id = projectIdRef.current
    if (!id || restoringVersion) return
    setRestoringVersion(version.id)
    setStatus('Đang khôi phục phiên bản…', 'busy')
    try {
      const data = await restoreProjectVersion(id, version.id)
      applyNodes(data.nodes, false)
      setSummary(typeof data.summary_so_far === 'string' ? data.summary_so_far : '')
      titleRef.current = data.title
      setMapTitle(data.title)
      setConsumedUntil(Number(data.consumed_until || 0))
      lastTriggerRef.current = Number(data.consumed_until || 0)
      setStatus('Đã khôi phục phiên bản sơ đồ', 'ok')
      toast.show({ message: 'Đã khôi phục phiên bản sơ đồ', tone: 'success' })
      await loadVersions()
    } catch {
      setStatus('Không khôi phục được phiên bản', 'error')
      toast.show({ message: 'Không khôi phục được phiên bản', tone: 'error' })
    } finally {
      setRestoringVersion(null)
    }
  }

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
      if (autoUpdate && canEdit && videoId && transcript.length > 0 && !isUpdatingRef.current) {
        if (time - lastTriggerRef.current >= AUTO_UPDATE_SECONDS) {
          lastTriggerRef.current = time
          requestUpdateRef.current(time)
        }
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [player, isPlaying, autoUpdate, canEdit, videoId, transcript.length])

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
        if (typeof data?.summary === 'string') setSummary(data.summary)
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
    if (!canEdit) return
    const node = findNodeById(nodesRef.current, nodeId)
    if (!node) return
    setEditor({
      id: node.id,
      label: node.label,
      note: node.note || '',
      pinned: Boolean(node.pinned),
    })
  }, [canEdit])

  const patchNode = useCallback(
    async (patch: Record<string, unknown>) => {
      const session = sessionIdRef.current
      if (!session) {
        setStatus('Hãy tải video trước khi chỉnh sửa node', 'error')
        return null
      }
      if (!canEdit) {
        setStatus('Dự án này chỉ cho phép xem', 'error')
        return null
      }
      try {
        const response = await sessionRequest('/node', 'PATCH', {
          session_id: session,
          ...patch,
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          const code = data?.detail?.code
          if (data.detail === 'session_lost') {
            setStatus('Phiên đã hết hạn — đang khôi phục…', 'busy')
            await recreateSession()
          } else if (code === 'project_read_only') {
            setStatus('Dự án này chỉ cho phép xem', 'error')
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
    [canEdit, recreateSession, applyNodes, setStatus],
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

  const hasHistoryTab = Boolean(projectId && canEdit)

  const togglePlay = useCallback(() => {
    if (!player) return
    try {
      if (isPlaying) player.pauseVideo()
      else player.playVideo()
    } catch {
      setStatus('Không điều khiển được video', 'error')
    }
  }, [player, isPlaying, setStatus])

  const seekBy = useCallback(
    (delta: number) => {
      handleSeek(Math.max(0, currentTimeRef.current + delta))
    },
    [handleSeek],
  )

  /** Select a tab and move focus there, for arrow-key navigation. */
  const selectTab = useCallback(
    (tab: DetailTab) => {
      setDetailTab(tab)
      if (tab === 'history') void loadVersions()
      tabRefs.current[tab]?.focus()
    },
    [loadVersions],
  )

  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const order: DetailTab[] = hasHistoryTab
      ? ['session', 'transcript', 'history']
      : ['session', 'transcript']
    const index = order.indexOf(detailTab)
    let nextIndex = -1
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % order.length
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + order.length) % order.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = order.length - 1
    if (nextIndex < 0) return
    event.preventDefault()
    selectTab(order[nextIndex])
  }

  // One listener for the whole workspace. Fields keep their keys; the cheat
  // sheet owns the keyboard while it is open.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = shortcutFor(event, {
        typing: isTypingTarget(event.target),
        hasHistory: hasHistoryTab,
      })
      if (!action) return

      if (action === 'escape') {
        if (showHelp) {
          setShowHelp(false)
          event.preventDefault()
        } else if (editor) {
          setEditor(null)
          event.preventDefault()
        }
        return
      }
      if (action === 'toggle-help') {
        event.preventDefault()
        setShowHelp((value) => !value)
        return
      }
      if (showHelp) return

      if (action === 'toggle-play') {
        event.preventDefault()
        togglePlay()
      } else if (action === 'seek-back') {
        event.preventDefault()
        seekBy(-5)
      } else if (action === 'seek-forward') {
        event.preventDefault()
        seekBy(5)
      } else if (action === 'fit-map') {
        event.preventDefault()
        mindmapRef.current?.fit()
        setStatus('Đã thu sơ đồ vừa khung', 'idle')
      } else if (action === 'tab-session') {
        event.preventDefault()
        setDetailTab('session')
      } else if (action === 'tab-transcript') {
        event.preventDefault()
        setDetailTab('transcript')
      } else if (action === 'tab-history') {
        event.preventDefault()
        openHistory()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showHelp, editor, hasHistoryTab, togglePlay, seekBy, setStatus, openHistory])

  const lastEntry = transcript[transcript.length - 1]
  const totalSeconds = lastEntry ? lastEntry.start + (lastEntry.duration || 0) : 0
  const progress = totalSeconds > 0 ? Math.min(100, (currentTime / totalSeconds) * 100) : 0
  const playbackError = playerError
  // `mapVersion` is the render trigger for the mutable tree in `nodesRef`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const chapters = useMemo(() => buildChapters(nodesRef.current), [mapVersion])
  const currentChapter = activeChapter(chapters, currentTime)

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-main">
        Bỏ qua tới nội dung chính
      </a>
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
            {authStatus === 'authenticated' ? (
              <>
                {role && role !== 'owner' && (
                  <span
                    className={`app-role app-role--${role}`}
                    title={ownerName ? `Dự án của ${ownerName}` : undefined}
                  >
                    {role === 'editor' ? 'Cộng tác' : 'Chỉ xem'}
                  </span>
                )}
                {canEdit ? (
                  sessionId && (isDraft || !projectId) ? (
                    <button
                      className="btn btn--primary btn--sm"
                      type="button"
                      onClick={openSaveDialog}
                      disabled={saveState === 'saving'}
                    >
                      {saveState === 'saving' ? 'Đang lưu…' : 'Lưu dự án'}
                    </button>
                  ) : sessionId ? (
                    <span
                      className={`app-save app-save--${saveState}`}
                      title={savedAt ? `Lưu lúc ${savedAt.toLocaleTimeString('vi-VN')}` : undefined}
                    >
                      <span className="app-save__dot" aria-hidden="true" />
                      {saveState === 'saving'
                        ? 'Đang lưu…'
                        : saveState === 'error'
                          ? 'Chưa lưu được'
                          : 'Đã lưu'}
                    </span>
                  ) : null
                ) : null}
              </>
            ) : (
              <Link className="btn btn--ghost btn--sm" to="/login">
                Đăng nhập để lưu
              </Link>
            )}

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
            <button
              className="btn btn--ghost btn--sm app-topbar__keys"
              type="button"
              aria-haspopup="dialog"
              aria-keyshortcuts="?"
              title="Phím tắt (?)"
              onClick={() => setShowHelp(true)}
            >
              <kbd aria-hidden="true">?</kbd>
              <span className="app-topbar__keys-label">Phím tắt</span>
            </button>
          </div>
        </div>

        {urlError && (
          <p className="app-topbar__error" id="url-error" role="alert">
            {urlError}
          </p>
        )}

        {pendingDraft && (
          <div className="draft-banner" role="status">
            <span className="draft-banner__text">
              Có bản nháp trong trình duyệt: <strong>{pendingDraft.title}</strong>
            </span>
            <button className="btn btn--ghost btn--sm" type="button" onClick={() => void restoreDraft()}>
              Khôi phục
            </button>
            <button className="btn btn--ghost btn--sm" type="button" onClick={discardDraft}>
              Bỏ
            </button>
          </div>
        )}

        {saveDialog && (
          <form
            className="save-dialog"
            onSubmit={(event) => {
              event.preventDefault()
              void confirmSave()
            }}
          >
            <label className="save-dialog__label" htmlFor="project-title">
              Tên dự án
            </label>
            <input
              id="project-title"
              className="save-dialog__input"
              value={draftTitle}
              maxLength={200}
              autoFocus
              onChange={(event) => setDraftTitle(event.target.value)}
            />
            <button
              className="btn btn--primary btn--sm"
              type="submit"
              disabled={!draftTitle.trim() || saveState === 'saving'}
            >
              {saveState === 'saving' ? 'Đang lưu…' : 'Lưu'}
            </button>
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              onClick={() => setSaveDialog(false)}
            >
              Huỷ
            </button>
          </form>
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

      <main className="workspace" id="workspace-main" tabIndex={-1}>
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

          {chapters.length > 0 && (
            <nav className="chapter-rail" aria-label="Chương theo chủ đề">
              <div className="chapter-rail__head">
                <span className="chapter-rail__title">Chương</span>
                <span className="chapter-rail__now">
                  {currentChapter ? currentChapter.label : 'Chưa tới chương đầu'}
                </span>
              </div>
              <ol className="chapter-rail__list">
                {chapters.map((chapter) => {
                  const isActive = currentChapter?.id === chapter.id
                  return (
                    <li key={chapter.id}>
                      <button
                        type="button"
                        className={`chapter-rail__item${isActive ? ' is-active' : ''}`}
                        aria-current={isActive ? 'true' : undefined}
                        title={`Tua tới ${formatTime(chapter.start)}`}
                        onClick={() => handleSeek(chapter.start)}
                      >
                        <span className="chapter-rail__time">{formatTime(chapter.start)}</span>
                        <span className="chapter-rail__label">{chapter.label}</span>
                      </button>
                    </li>
                  )
                })}
              </ol>
            </nav>
          )}
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
              <span className="panel__meta">
                {detailTab === 'transcript'
                  ? transcript.length > 0
                    ? `${transcript.length} đoạn`
                    : 'Trống'
                  : detailTab === 'history'
                    ? versions.length > 0
                      ? `${versions.length} bản`
                      : 'Trống'
                    : nodeCount > 0
                      ? `${nodeCount} ý`
                      : 'Trống'}
              </span>
            )}
          </header>

          {!editor && (
            <div
              className="detail-tabs"
              role="tablist"
              aria-label="Nội dung phiên học"
              onKeyDown={onTabKeyDown}
            >
              <button
                id="detail-tab-session"
                type="button"
                role="tab"
                aria-selected={detailTab === 'session'}
                aria-controls="detail-panel"
                aria-keyshortcuts="s"
                tabIndex={detailTab === 'session' ? 0 : -1}
                ref={(element) => {
                  tabRefs.current.session = element
                }}
                className={`detail-tabs__item${detailTab === 'session' ? ' is-active' : ''}`}
                onClick={() => setDetailTab('session')}
              >
                Phiên học
              </button>
              <button
                id="detail-tab-transcript"
                type="button"
                role="tab"
                aria-selected={detailTab === 'transcript'}
                aria-controls="detail-panel"
                aria-keyshortcuts="t"
                tabIndex={detailTab === 'transcript' ? 0 : -1}
                ref={(element) => {
                  tabRefs.current.transcript = element
                }}
                className={`detail-tabs__item${detailTab === 'transcript' ? ' is-active' : ''}`}
                onClick={() => setDetailTab('transcript')}
              >
                Phụ đề
                {transcript.length > 0 && (
                  <span className="detail-tabs__count">{transcript.length}</span>
                )}
              </button>
              {hasHistoryTab && (
                <button
                  id="detail-tab-history"
                  type="button"
                  role="tab"
                  aria-selected={detailTab === 'history'}
                  aria-controls="detail-panel"
                  aria-keyshortcuts="h"
                  tabIndex={detailTab === 'history' ? 0 : -1}
                  ref={(element) => {
                    tabRefs.current.history = element
                  }}
                  className={`detail-tabs__item${detailTab === 'history' ? ' is-active' : ''}`}
                  onClick={openHistory}
                >
                  Lịch sử
                </button>
              )}
            </div>
          )}

          <div
            className="panel__body panel__body--details"
            role={editor ? undefined : 'tabpanel'}
            id={editor ? undefined : 'detail-panel'}
            aria-labelledby={editor ? undefined : `detail-tab-${detailTab}`}
          >
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
            ) : detailTab === 'transcript' ? (
              <TranscriptPanel
                entries={transcript}
                currentTime={currentTime}
                onSeek={handleSeek}
                language={transcriptLang}
                languages={languages}
                languagesLoading={languagesLoading}
                languagesError={languagesError}
                onLoadLanguages={() => void loadLanguages()}
                onSelectLanguage={(code) => void switchLanguage(code)}
                languageBusy={languageBusy}
                canEdit={canEdit}
                canChangeLanguage={Boolean(videoId || extractVideoId(url))}
                bilingual={bilingual}
                onToggleBilingual={() => void toggleBilingual()}
                secondary={secondaryEntries}
                secondaryLanguage={secondaryLang}
                secondaryBusy={secondaryBusy}
                secondaryError={secondaryError}
                onSelectSecondary={(code) => void loadSecondary(code)}
              />
            ) : detailTab === 'history' ? (
              <div className="version-history">
                <p className="version-history__hint">
                  Mỗi lần AI cập nhật hoặc bạn lưu đè sơ đồ, bản trước được giữ lại. Khôi
                  phục sẽ tạo thêm một bản an toàn, nên bạn vẫn quay lại được.
                </p>

                {versionsError && (
                  <p className="dash-error" role="alert">{versionsError}</p>
                )}

                {versionsLoading ? (
                  <SkeletonList rows={3} label="Đang tải lịch sử…" />
                ) : versions.length === 0 ? (
                  <p className="version-history__empty">
                    Chưa có bản nào. Lịch sử bắt đầu từ lần cập nhật sơ đồ tiếp theo.
                  </p>
                ) : (
                  <ol className="version-list">
                    {versions.map((version) => (
                      <li key={version.id} className="version-item">
                        <div className="version-item__main">
                          <span className="version-item__time">
                            {formatWhen(version.created_at)}
                          </span>
                          <span className="version-item__meta">
                            {version.node_count} nhánh
                            {version.consumed_until > 0
                              ? ` · tới ${formatTime(version.consumed_until)}`
                              : ''}
                          </span>
                          {version.summary && (
                            <p className="version-item__summary">{version.summary}</p>
                          )}
                        </div>
                        <button
                          className="btn btn--outline btn--sm"
                          type="button"
                          disabled={restoringVersion !== null}
                          onClick={() => void restoreVersion(version)}
                        >
                          {restoringVersion === version.id ? 'Đang khôi phục…' : 'Khôi phục'}
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ) : (
              <div className="session">
                <div className="session__title">
                  <span className="session__label">Chủ đề</span>
                  <strong>{mapTitle}</strong>
                </div>

                <div className={`summary-card${summary ? '' : ' summary-card--empty'}`}>
                  <div className="summary-card__head">
                    <span className="summary-card__label">Tóm tắt AI</span>
                    {isUpdating && <span className="summary-card__live">đang cập nhật…</span>}
                  </div>
                  <p>
                    {summary ||
                      'Tóm tắt sẽ xuất hiện khi video được phân tích. Bấm “Cập nhật” hoặc phát video để bắt đầu.'}
                  </p>
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

                {!canEdit && (
                  <div className="session__readonly" role="status">
                    <strong>Chế độ chỉ xem</strong>
                    <p>
                      {ownerName
                        ? `${ownerName} đã chia sẻ sơ đồ này với quyền chỉ xem.`
                        : 'Sơ đồ này được chia sẻ với quyền chỉ xem.'}{' '}
                      Bạn vẫn tua video bằng các mốc thời gian trên sơ đồ.
                    </p>
                  </div>
                )}

                {role === 'editor' && (
                  <div className="session__readonly session__readonly--edit" role="status">
                    <strong>Đang cộng tác</strong>
                    <p>
                      Thay đổi của bạn được lưu tự động và hiện ngay ở những người đang mở
                      cùng dự án.
                    </p>
                  </div>
                )}

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
                  disabled={!canEdit}
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
                disabled={!videoId || isUpdating || isLoading || !canEdit}
              >
                {isUpdating && <span className="spinner" aria-hidden="true" />}
                {isUpdating ? 'Đang phân tích…' : 'Cập nhật'}
              </button>

              <ExportMenu
                onExport={(format) => void handleExport(format)}
                disabled={nodeCount === 0}
                busy={exporting}
              />
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

      {showHelp && <ShortcutHelp onClose={() => setShowHelp(false)} />}
    </div>
  )
}

export default App
