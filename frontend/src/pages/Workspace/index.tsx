import { lazy, Suspense, useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import YouTube from 'react-youtube'
import type { YouTubeProps } from 'react-youtube'
import './Workspace.css'
import ThemeToggle from '../../components/ThemeToggle'
import ExportMenu from '../../components/ExportMenu'
import MapStyleDialog from '../../components/MapStyleDialog'
import ShortcutHelp from '../../components/ShortcutHelp'
import ChapterRail from '../../components/ChapterRail'
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
  shareUrl,
  updateProject,
  writeLocalDraft,
  type LocalDraft,
  type ProjectVersionSummary,
} from '../../lib/projects'
import { apiFetch, getAccessToken, refreshSession } from '../../lib/api'
import { exportMap, type ExportFormat } from '../../lib/mapExport'
import {
  contentMode,
  hasStoredStyle,
  isContentMode,
  isMapLayout,
  MODE_LABELS,
  modeSwitch,
  normalizeStyle,
  readStoredStyle,
  storeStyle,
  styleFromSearch,
  stripStyleFromSearch,
  type ContentMode,
  type MapStyle,
} from '../../lib/mapStyle'
import { SkeletonList } from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/useToast'
import { buildChapters } from '../../lib/chapters'
import { parseDeepLink, stripDeepLinkFromSearch, type DeepLink } from '../../lib/deepLink'
import { findEmptyMinutes } from '../../lib/coverage'
import CoverageNotice from '../../components/CoverageNotice'
import SelfCheckPanel from '../../components/SelfCheckPanel'
import VideoSearch from '../../components/VideoSearch'
import { isTypingTarget, shortcutFor } from '../../lib/shortcuts'
import { PlaybackClock } from '../../lib/playbackClock'
import { PlaybackProgress, PlaybackTime } from '../../components/PlaybackTime'
import {
  DEFAULT_OUTPUT_LANGUAGE,
  OUTPUT_LANGUAGES,
  normalizeOutputLanguage,
  outputLanguageName,
  readStoredOutputLanguage,
  storeOutputLanguage,
} from '../../lib/outputLanguage'
import {
  extractVideoId,
  fetchTranscriptTrack,
  isCaptionOnlyProblem,
  listTranscriptLanguages,
  playerErrorMessage,
  transcriptErrorMessage,
  transcriptSourceLabel,
  transcriptStatusText,
  TranscriptLanguagesError,
  watchUrl,
  type PlayerErrorInfo,
  type TranscriptLanguage,
  type TranscriptSource,
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

class RequestError extends Error {
  readonly code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'RequestError'
    this.code = code
  }
}

interface AsrQueuedResult {
  kind: 'asr'
  jobId: string
  videoId: string
  title: string | null
  maxSeconds: number
}

interface TranscriptSessionResult {
  kind: 'session'
  data: any
}

type TranscriptFetchResult = AsrQueuedResult | TranscriptSessionResult

interface AsrProgress {
  jobId: string
  stage: string
  elapsedSeconds: number
  maxSeconds: number
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
async function authedFetch(
  path: string,
  method: string = 'GET',
  body?: unknown,
): Promise<Response> {
  const send = () => {
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const token = getAccessToken()
    if (token) headers.Authorization = `Bearer ${token}`
    return fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  let response = await send()
  if (response.status === 401 && getAccessToken()) {
    if (await refreshSession()) response = await send()
  }
  return response
}

async function sessionRequest(
  path: string,
  method: string,
  body: unknown,
): Promise<Response> {
  return authedFetch(path, method, body)
}

interface VerificationCounts {
  checked: number
  grounded: number
  repaired: number
  dropped: number
  model_used: boolean
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
  const [playbackClock] = useState(() => new PlaybackClock())
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [focusRecent, setFocusRecent] = useState(false)
  const [status, setStatusState] = useState<Status>({ kind: 'idle', text: 'Sẵn sàng' })
  const [verification, setVerification] = useState<VerificationCounts | null>(null)
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [transcriptLang, setTranscriptLang] = useState<string | null>(null)
  // What the learner wants to study in. Independent of the caption track.
  const [outputLanguage, setOutputLanguage] = useState<string | null>(
    () => readStoredOutputLanguage() ?? DEFAULT_OUTPUT_LANGUAGE,
  )
  const [outputLanguageBusy, setOutputLanguageBusy] = useState(false)
  const [transcriptSource, setTranscriptSource] = useState<TranscriptSource>(undefined)
  const [asrProgress, setAsrProgress] = useState<AsrProgress | null>(null)
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null)
  const [playerError, setPlayerError] = useState<PlayerErrorInfo | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [editor, setEditor] = useState<NodeDraft | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
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
  const [selfCheckOpen, setSelfCheckOpen] = useState(false)
  const [maskedIds, setMaskedIds] = useState<string[]>([])
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
  // The look chosen in the picker. A URL param wins (the dashboard hands the
  // choice over that way), then the learner's last choice, then the default.
  const [mapStyle, setMapStyle] = useState<MapStyle>(
    () => styleFromSearch(window.location.search) ?? readStoredStyle(),
  )
  // A first visit lands on a blank workspace, so the look is asked for before
  // anything is built — the "choose before you start" step. A saved project
  // carries its own look, and a returning learner already has a stored choice,
  // so neither of them is interrupted.
  const [styleOpen, setStyleOpen] = useState(
    () =>
      !routeProjectId &&
      styleFromSearch(window.location.search) === null &&
      !hasStoredStyle(),
  )
  // True only while the dialog is the "choose before you start" step, so it can
  // say "Bắt đầu" instead of "Áp dụng" the way the dashboard picker does.
  const [styleIntro, setStyleIntro] = useState(styleOpen)
  // The thinking mode the current content was built for (ADR 0013). Changing
  // the drawing (`tree` ↔ `tree-down`) does not change it; changing the mode
  // offers a rebuild instead of spending tokens behind the learner's back.
  const [builtMode, setBuiltMode] = useState<ContentMode>(() =>
    contentMode((styleFromSearch(window.location.search) ?? readStoredStyle()).layout),
  )
  const [rebuildOffer, setRebuildOffer] = useState<ContentMode | null>(null)
  const [rebuilding, setRebuilding] = useState(false)

  const urlInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mindmapRef = useRef<MindMapHandle>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const isUpdatingRef = useRef(false)
  const lastTriggerRef = useRef(0)
  const currentTimeRef = useRef(0)
  const loadTokenRef = useRef(0)
  const asrTimerRef = useRef<number | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const requestUpdateRef = useRef<(atTime?: number) => Promise<void>>(async () => {})
  const nodesRef = useRef<MapNode[]>([])
  const titleRef = useRef<string>(DEFAULT_TITLE)
  const projectIdRef = useRef<string | null>(routeProjectId ?? null)
  const saveRef = useRef<() => Promise<boolean>>(async () => false)
  const languagesLoadedRef = useRef(false)
  const languagesRequestRef = useRef(false)
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const styleRef = useRef(mapStyle)
  const outputLanguageRef = useRef(outputLanguage)
  const builtModeRef = useRef(builtMode)
  // Read once, before the mount effect removes the params from the URL. The
  // jump is a one-time action, not a persistent filter on the workspace.
  const deepLinkRef = useRef<DeepLink>(parseDeepLink(window.location.search))
  const pendingFocusRef = useRef<string | null>(null)
  const shareSlugRef = useRef<string | null>(null)

  const focusMapNode = useCallback((id: string) => {
    mindmapRef.current?.focusNode?.(id)
  }, [])

  // A check belongs to one project; changing projects must never leave its
  // masked labels behind.
  useEffect(() => {
    setSelfCheckOpen(false)
    setMaskedIds([])
  }, [routeProjectId])

  const setStatus = useCallback((text: string, kind: StatusKind = 'idle') => {
    setStatusState({ kind, text })
  }, [])

  // `null` means a fresh local session, which is editable by definition.
  const canEdit = role !== 'viewer'

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    styleRef.current = mapStyle
  }, [mapStyle])

  useEffect(() => {
    outputLanguageRef.current = outputLanguage
  }, [outputLanguage])

  useEffect(() => {
    builtModeRef.current = builtMode
  }, [builtMode])

  // The picker hands its choice over as a query param. Once the state above
  // has read it, drop it so a refresh or a shared link does not keep forcing
  // the style over whatever the learner picks next.
  useEffect(() => {
    const search = window.location.search
    const rest = stripDeepLinkFromSearch(stripStyleFromSearch(search))
    if (rest !== search) {
      navigate(`${window.location.pathname}${rest}`, { replace: true })
    }
    // Runs once: the params are gone after the first pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
          map_layout: styleRef.current.layout,
          map_palette: styleRef.current.palette,
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

        // Keep the browser copy until the server actually holds a map. Signing
        // in used to delete it immediately, so a failed autosave left no copy
        // of a guest's mindmap anywhere.
        if (nodesRef.current.length > 0) clearLocalDraft()
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
        outputLanguage,
        mapLayout: styleRef.current.layout,
        mapPalette: styleRef.current.palette,
        savedAt: new Date().toISOString(),
      })
      setSavedAt(new Date())
      setSaveState('saved')
    }, 900)
    return () => clearTimeout(timer)
  }, [authStatus, videoId, mapVersion, consumedUntil, mapTitle, transcriptLang, outputLanguage])

  // Do not surface the guest banner after sign-in; saveNow removes the browser
  // copy once the account has a map, so a failed autosave keeps the fallback.
  useEffect(() => {
    if (authStatus === 'authenticated') setPendingDraft(null)
  }, [authStatus])

  /** Single place that swaps the tree, so the counter can never drift. */
  const applyNodes = useCallback((nodes: MapNode[], focusNew: boolean) => {
    const normalized = normalizeTree(nodes)
    nodesRef.current = normalized
    setNodeCount(countNodes(normalized))
    setMapVersion((version) => version + 1)
    mindmapRef.current?.updateTree(titleRef.current, normalized, { focusNew })
  }, [])

  /** Select a linked node and reveal it once its renderer exists. */
  const showLinkedNode = useCallback((id: string) => {
    if (!findNodeById(nodesRef.current, id)) return
    setSelectedNodeId(id)
    if (mindmapRef.current?.focusNode) mindmapRef.current.focusNode(id)
    else pendingFocusRef.current = id
  }, [])

  /** Copy a link that opens the shared project at this moment and idea. */
  const copyMomentLink = useCallback(async () => {
    const base = shareSlugRef.current
      ? shareUrl(shareSlugRef.current)
      : `${window.location.origin}${projectIdRef.current ? `/app/${projectIdRef.current}` : window.location.pathname}`
    const link = new URL(base)
    const seconds = Math.floor(playbackClock.getSnapshot())
    if (seconds > 0) link.searchParams.set('t', String(seconds))
    if (selectedNodeId) link.searchParams.set('node', selectedNodeId)
    try {
      await navigator.clipboard.writeText(link.toString())
      toast.show({
        message:
          seconds > 0 || selectedNodeId
            ? 'Đã sao chép link tới thời điểm và nhánh này'
            : 'Đã sao chép link dự án',
        tone: 'success',
      })
    } catch {
      toast.show({ message: 'Không sao chép được link. Hãy kiểm tra quyền clipboard.', tone: 'error' })
    }
  }, [playbackClock, selectedNodeId, toast])

  const applyLoadResult = (data: any, vid: string, label: string) => {
    if (data.session_id) {
      setSessionId(data.session_id)
      sessionIdRef.current = data.session_id
    }

    // A saved project carries its own look, so reopening it looks the way the
    // learner left it rather than the way the last project happened to look.
    if (data.map_layout || data.map_palette) {
      setMapStyle(
        normalizeStyle({ layout: data.map_layout, palette: data.map_palette }),
      )
    }

    // The content mode is not the drawing: a project saved as "bubble" may
    // still hold tree content from before ADR 0013, which is what the rebuild
    // bar is for.
    const layout = isMapLayout(data.map_layout) ? data.map_layout : styleRef.current.layout
    const mode = isContentMode(data.map_mode) ? data.map_mode : contentMode(layout)
    setBuiltMode(mode)
    const change = modeSwitch(layout, mode, {
      hasContent: Array.isArray(data.nodes) && data.nodes.length > 0,
      canEdit: data.can_edit !== false,
    })
    setRebuildOffer(change?.offer ? change.mode : null)

    if (Array.isArray(data.transcript)) {
      setTranscript(data.transcript)
    }
    setTranscriptLang(typeof data.language === 'string' ? data.language : null)
    // A saved project carries its own choice; an old project with no choice is
    // deliberately left as "follow the captions" until the learner picks one.
    if (Object.prototype.hasOwnProperty.call(data, 'output_language')) {
      const language = normalizeOutputLanguage(data.output_language)
      setOutputLanguage(language)
      outputLanguageRef.current = language
    }
    setTranscriptSource(
      ['youtube_manual', 'youtube_auto', 'upload', 'asr'].includes(data.transcript_source)
        ? data.transcript_source
        : undefined,
    )
    setSummary(typeof data.summary === 'string' ? data.summary : '')
    setLanguages([])
    setLanguagesError('')
    languagesLoadedRef.current = false
    setBilingual(false)
    setSecondaryEntries([])
    setSecondaryLang(null)
    setSecondaryBusy(false)
    setSecondaryError('')

    shareSlugRef.current =
      typeof data.share_slug === 'string' && data.share_slug ? data.share_slug : null

    const resolvedTitle = data.title || vid || DEFAULT_TITLE
    titleRef.current = resolvedTitle
    setMapTitle(resolvedTitle)

    if (Array.isArray(data.nodes)) {
      applyNodes(data.nodes, false)
    }
    if (deepLinkRef.current.node) showLinkedNode(deepLinkRef.current.node)

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

  const stopAsrPolling = () => {
    if (asrTimerRef.current !== null) {
      window.clearTimeout(asrTimerRef.current)
      asrTimerRef.current = null
    }
    setAsrProgress(null)
  }

  const pollAsrJob = (
    jobId: string,
    id: string,
    maxSeconds: number,
    token: number,
  ) => {
    const poll = async () => {
      asrTimerRef.current = null
      if (token !== loadTokenRef.current) return
      try {
        const response = await authedFetch(
          `/transcript/asr/${encodeURIComponent(jobId)}`,
        )
        const body: any = await response.json().catch(() => ({}))
        if (token !== loadTokenRef.current) return
        if (!response.ok) {
          const code = body?.detail?.code
          stopAsrPolling()
          setIsLoading(false)
          setStatus(transcriptStatusText(code), 'error')
          setUrlError(transcriptErrorMessage(code))
          return
        }
        if (body.status === 'ready' && body.session) {
          stopAsrPolling()
          setIsLoading(false)
          applyLoadResult(body.session, id, 'Đã nghe audio')
          return
        }
        if (body.status === 'failed') {
          const code = body?.error?.code
          stopAsrPolling()
          setIsLoading(false)
          setStatus(transcriptStatusText(code), isCaptionOnlyProblem(code) ? 'idle' : 'error')
          setUrlError(transcriptErrorMessage(code))
          return
        }
        if (body.status === 'cancelled') {
          stopAsrPolling()
          setIsLoading(false)
          setStatus('Đã huỷ lượt nghe audio', 'idle')
          return
        }
        setAsrProgress({
          jobId,
          stage: String(body.stage || 'queued'),
          elapsedSeconds: Number(body.elapsed_seconds || 0),
          maxSeconds,
        })
        asrTimerRef.current = window.setTimeout(() => void poll(), 2000)
      } catch (error: unknown) {
        if (token !== loadTokenRef.current) return
        stopAsrPolling()
        setIsLoading(false)
        setStatus('Không kiểm tra được tiến trình nghe audio', 'error')
        setUrlError('Thử tải lại trang, hoặc tải file .srt/.vtt bên dưới.')
        console.warn('[asr]', error)
      }
    }
    void poll()
  }

  const cancelAsr = async () => {
    const jobId = asrProgress?.jobId
    const token = loadTokenRef.current
    stopAsrPolling()
    if (!jobId) return
    try {
      await authedFetch(`/transcript/asr/${encodeURIComponent(jobId)}`, 'DELETE')
    } catch (error: unknown) {
      console.warn('[asr cancel]', error)
    }
    if (token === loadTokenRef.current) {
      setIsLoading(false)
      setStatus('Đã huỷ lượt nghe audio', 'idle')
      setUrlError('')
    }
  }

  const applyTranscriptResult = (
    result: TranscriptFetchResult,
    id: string,
    label: string,
    token: number,
  ) => {
    if (token !== loadTokenRef.current) return
    if (result.kind === 'session') {
      applyLoadResult(result.data, id, label)
      return
    }
    // 202: the player can start while the job runs. The map pane gets a plain
    // progress panel and the same applyLoadResult path handles the final cues.
    setAsrProgress({
      jobId: result.jobId,
      stage: 'queued',
      elapsedSeconds: 0,
      maxSeconds: result.maxSeconds,
    })
    setUrlError('')
    setStatus('IVAN đang nghe audio để tạo phụ đề…', 'busy')
    pollAsrJob(result.jobId, id || result.videoId, result.maxSeconds, token)
  }

  const recreateSession = useCallback(async () => {
    if (!videoId) return
    try {
      const result = await fetchTranscript(
        projectIdRef.current ? { projectId: projectIdRef.current } : { url },
      )
      applyTranscriptResult(result, videoId, 'Đã khôi phục phiên làm việc', loadTokenRef.current)
    } catch (e: any) {
      setStatus(`Không khôi phục được phiên: ${e.message}`, 'error')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, videoId, setStatus])

  /**
   * POST to a session endpoint. These live outside `/api`, so the access token
   * is attached by hand; a guest call simply goes without one.
   */
  const requestError = async (response: Response, fallback: string) => {
    const payload = await response.json().catch(() => null)
    const detail =
      payload && typeof payload === 'object' && 'detail' in payload ? payload.detail : undefined
    const code =
      detail && typeof detail === 'object' && 'code' in detail && typeof detail.code === 'string'
        ? detail.code
        : undefined
    const message =
      detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string'
        ? detail.message
        : typeof detail === 'string'
          ? detail
          : fallback
    return new RequestError(message, code ?? (typeof detail === 'string' ? detail : undefined))
  }

  const postJson = async (path: string, body: unknown, fallback: string) => {
    const response = await authedFetch(path, 'POST', body)

    if (!response.ok) throw await requestError(response, fallback)
    return response.json()
  }

  const fetchTranscript = async (payload: {
    url?: string
    fileContent?: string
    projectId?: string
    initialNodes?: MapNode[]
    resumeAt?: number
    title?: string
    outputLanguage?: string | null
  }): Promise<TranscriptFetchResult> => {
    const body: any = {}
    if (payload.url) body.url = payload.url
    if (payload.fileContent) body.file_content = payload.fileContent
    if (payload.projectId) body.project_id = payload.projectId
    if (payload.initialNodes) body.initial_nodes = payload.initialNodes
    if (payload.resumeAt !== undefined) body.resume_at = payload.resumeAt
    if (payload.title) body.title = payload.title
    if (payload.outputLanguage !== undefined) {
      body.output_language = normalizeOutputLanguage(payload.outputLanguage)
    }
    // The first chunk should already be extracted for the chosen mode; the
    // backend ignores this for saved projects, which carry their own.
    body.map_layout = styleRef.current.layout

    const response = await authedFetch('/transcript', 'POST', body)
    if (!response.ok) throw await requestError(response, 'Không thể tải phụ đề')
    const data: any = await response.json()
    if (response.status === 202 && data?.status === 'asr_queued' && data.job_id) {
      return {
        kind: 'asr',
        jobId: data.job_id,
        videoId: String(data.video_id || ''),
        title: typeof data.title === 'string' ? data.title : null,
        maxSeconds: Number(data.asr?.max_seconds || 10_800),
      }
    }
    return { kind: 'session', data }
  }

  const loadVideo = async (id: string) => {
    const token = ++loadTokenRef.current
    setVideoId(id)
    setPlayer(null)
    setIsPlaying(false)
    setPlayerError(null)
    setVideoInfo(null)
    setTranscript([])
    setVerification(null)
    setTranscriptLang(null)
    setTranscriptSource(undefined)
    stopAsrPolling()
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
    playbackClock.set(0, true)
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
      const result = await fetchTranscript({
        url: watchUrl(id),
        outputLanguage: outputLanguageRef.current,
      })
      applyTranscriptResult(result, id, 'Đã tải phụ đề', token)
    } catch (error: unknown) {
      if (token === loadTokenRef.current) {
        const code = error instanceof RequestError ? error.code : undefined
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

  const handleLoadVideo = async (nextUrl?: string) => {
    if (nextUrl !== undefined) {
      setUrl(nextUrl)
      setUrlError('')
    }
    const trimmed = (nextUrl ?? url).trim()
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
      const result = await fetchTranscript({ url, fileContent: text })
      if (token !== loadTokenRef.current) return
      const id = extractVideoId(url)
      if (result.kind === 'session') {
        applyLoadResult(result.data, id || videoId || '', 'Đã tải phụ đề từ file')
      }
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
    const draftLanguage =
      draft.outputLanguage === undefined
        ? readStoredOutputLanguage() ?? DEFAULT_OUTPUT_LANGUAGE
        : draft.outputLanguage
    setOutputLanguage(draftLanguage)
    outputLanguageRef.current = draftLanguage
    try {
      const result = await fetchTranscript({
        url: draft.url,
        initialNodes: draft.nodes,
        resumeAt: draft.consumedUntil,
        title: draft.title,
        outputLanguage: draftLanguage,
      })
      if (token !== loadTokenRef.current) return
      const id = draft.videoId || extractVideoId(draft.url)
      if (id) setVideoId(id)
      if (draft.mapLayout || draft.mapPalette) {
        setMapStyle(
          normalizeStyle({ layout: draft.mapLayout, palette: draft.mapPalette }),
        )
      }
      applyTranscriptResult(
        result,
        id || '',
        'Đã khôi phục bản nháp trong trình duyệt',
        token,
      )
      setPendingDraft(null)
    } catch (error: unknown) {
      if (token === loadTokenRef.current) {
        const code = error instanceof RequestError ? error.code : undefined
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
      .then((result) => {
        if (token !== loadTokenRef.current) return
        if (result.kind !== 'session') return
        const data = result.data
        applyLoadResult(data, data.video_id || '', 'Đã mở dự án')
        setVideoId(data.video_id || null)
        setUrl(data.video_id ? watchUrl(data.video_id) : '')
        setSavedAt(new Date())
      })
      .catch((error: unknown) => {
        if (token !== loadTokenRef.current) return
        const code = error instanceof RequestError ? error.code : undefined
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

      const grounded = data?.verification
      if (grounded && typeof grounded.checked === 'number') {
        setVerification({
          checked: grounded.checked,
          grounded: Number(grounded.grounded) || 0,
          repaired: Number(grounded.repaired) || 0,
          dropped: Number(grounded.dropped) || 0,
          model_used: grounded.model_used === true,
        })
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
    // A `?t=` link is a one-time jump. Apply it here, where the YouTube instance
    // really exists, rather than in the mount effect where `player` is still
    // null. Clear it so a player reload cannot yank the learner back.
    const linkedTime = deepLinkRef.current.t
    if (linkedTime !== null && typeof event.target.seekTo === 'function') {
      deepLinkRef.current = { ...deepLinkRef.current, t: null }
      event.target.seekTo(linkedTime, true)
      currentTimeRef.current = linkedTime
      playbackClock.set(linkedTime, true)
      setStatus(`Đã tua đến ${formatTime(linkedTime)} từ link`, 'idle')
    }
  }

  const onPlayerError: YouTubeProps['onError'] = (event) => {
    const error = playerErrorMessage(event.data)
    setIsPlaying(false)
    setPlayerError(error)
    setStatus(error.title, 'error')
  }

  const handleSeek = useCallback(
    (seconds: number) => {
      if (!player || typeof player.seekTo !== 'function') return
      player.seekTo(seconds, true)
      currentTimeRef.current = seconds
      playbackClock.set(seconds, true)
      setStatus(`Đã tua đến ${formatTime(seconds)}`, 'idle')
    },
    [player, playbackClock, setStatus],
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

  /** Choose the language the map itself is written in, not the caption track. */
  const changeOutputLanguage = async (raw: string) => {
    const session = sessionIdRef.current
    const code = raw === '' ? null : normalizeOutputLanguage(raw)
    if (!session || outputLanguageBusy || code === outputLanguageRef.current) return
    setOutputLanguageBusy(true)
    setStatus('Đang đổi ngôn ngữ sơ đồ…', 'busy')
    try {
      const response = await sessionRequest('/output-language', 'POST', {
        session_id: session,
        project_id: projectIdRef.current,
        output_language: code,
      })
      const data = await response.json().catch(() => ({}))
      if (sessionIdRef.current !== session) return
      if (!response.ok) {
        const detail = data?.detail
        const detailCode =
          detail && typeof detail === 'object' ? detail.code : typeof detail === 'string' ? detail : undefined
        const message =
          detailCode === 'rebuild_required'
            ? 'Đổi về theo phụ đề cần tạo lại sơ đồ trước.'
            : detailCode === 'project_read_only'
              ? 'Dự án này chỉ cho phép xem'
              : 'Không đổi được ngôn ngữ sơ đồ'
        setStatus(message, 'error')
        return
      }
      if (Array.isArray(data.nodes)) applyNodes(data.nodes, false)
      if (typeof data.summary === 'string') setSummary(data.summary)
      setOutputLanguage(code)
      outputLanguageRef.current = code
      storeOutputLanguage(code)
      setStatus(
        data.translated
          ? `Đã dịch sơ đồ sang ${outputLanguageName(code)}`
          : `Sơ đồ sẽ tạo bằng ${outputLanguageName(code)}`,
        'ok',
      )
    } catch (error: any) {
      setStatus(`Không đổi được ngôn ngữ sơ đồ: ${error.message}`, 'error')
    } finally {
      setOutputLanguageBusy(false)
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

  /**
   * Ask the session to rewrite its content for `mode`.
   *
   * `offer` is false for the free cases (an empty map), where the call only
   * records the mode and never reaches the model.
   */
  const adoptMode = async (mode: ContentMode, offer: boolean) => {
    const session = sessionIdRef.current
    if (!session || rebuilding) return
    setRebuilding(true)
    if (offer) setStatus('Đang tạo lại nội dung…', 'busy')
    try {
      const data = await postJson(
        `/session/${session}/restructure`,
        { map_layout: mode },
        'Không tạo lại được nội dung',
      )
      if (Array.isArray(data.nodes)) applyNodes(data.nodes, false)
      const applied: ContentMode = isContentMode(data.map_mode) ? data.map_mode : mode
      setBuiltMode(applied)
      setRebuildOffer(null)
      if (offer) {
        setStatus(`Đã tạo lại nội dung theo kiểu ${MODE_LABELS[applied]}`, 'ok')
        // Persist the rewritten tree so reopening the project shows it.
        void saveRef.current()
      }
    } catch (error: any) {
      // The map is untouched server-side, so only the message is lost.
      setStatus(error?.message || 'Không tạo lại được nội dung', 'error')
    } finally {
      setRebuilding(false)
    }
  }

  /**
   * Apply a look chosen in the dialog. The style is presentation, so it is
   * remembered per project and per browser; a viewer keeps it local because
   * they cannot write to the row.
   *
   * A different mode is a different *content*, so it is offered rather than
   * spent: the drawing changes now, the rebuild is one click (ADR 0013).
   */
  const handleStyleConfirm = async (style: MapStyle) => {
    setMapStyle(style)
    styleRef.current = style
    storeStyle(style)
    setStyleOpen(false)
    // The renderer only reads the style on mount/update, so nudge it to
    // repaint the palette without waiting for the next AI update.
    mindmapRef.current?.updateTree(titleRef.current, nodesRef.current, { focusNew: false })

    const change = modeSwitch(style.layout, builtModeRef.current, {
      hasContent: nodesRef.current.length > 0,
      canEdit,
    })
    setRebuildOffer(change?.offer ? change.mode : null)
    // Nothing extracted yet, so switching costs nothing: the next chunk is
    // already built for the new mode. Do it quietly.
    if (change && !change.offer) void adoptMode(change.mode, false)

    const id = projectIdRef.current
    if (id && canEdit) {
      try {
        await updateProject(id, {
          map_layout: style.layout,
          map_palette: style.palette,
        })
      } catch {
        setStatus('Đã đổi kiểu sơ đồ, nhưng chưa lưu được vào dự án', 'error')
        return
      }
    }
    setStatus('Đã đổi kiểu sơ đồ', 'ok')
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
    } else if (event.data === YT.PlayerState.ENDED) {
      setIsPlaying(false)
      setStatus('Đã phát xong', 'idle')
    }
  }

  useEffect(() => {
    if (!player || !isPlaying) return

    const interval = setInterval(() => {
      const time = player.getCurrentTime()
      currentTimeRef.current = time
      playbackClock.set(time)
      if (autoUpdate && canEdit && videoId && transcript.length > 0 && !isUpdatingRef.current) {
        if (time - lastTriggerRef.current >= AUTO_UPDATE_SECONDS) {
          lastTriggerRef.current = time
          requestUpdateRef.current(time)
        }
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [player, isPlaying, autoUpdate, canEdit, videoId, transcript.length, playbackClock])

  useEffect(() => {
    eventSourceRef.current?.close()
    if (!sessionId) return
    let disposed = false

    const listen = (ticket: string) => {
      if (disposed) return
      const es = new EventSource(`${API_BASE}/stream/${encodeURIComponent(ticket)}`)
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data?.type === 'session_lost') {
            es.close()
            recreateSession()
            return
          }
          if (data?.type === 'stream_expired') {
            void renew()
            return
          }
          if (data?.type === 'access_revoked') {
            es.close()
            return
          }
          if (data?.type === 'restructure' && isContentMode(data.map_mode)) {
            // Another tab rewrote the map for a new mode; this one is up to date.
            setBuiltMode(data.map_mode)
            setRebuildOffer(null)
          }
          if (
            data?.type === 'output_language' &&
            Object.prototype.hasOwnProperty.call(data, 'output_language')
          ) {
            const language = normalizeOutputLanguage(data.output_language)
            setOutputLanguage(language)
            outputLanguageRef.current = language
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
    }

    // EventSource cannot send a bearer header, so exchange the access token
    // for an opaque ticket before opening the socket.
    const renew = async () => {
      try {
        const issued = await apiFetch<{ ticket: string }>(
          `/session/${encodeURIComponent(sessionId)}/stream-ticket`,
          { method: 'POST' },
        )
        listen(issued.ticket)
      } catch {
        // A revoked stream stays closed; the next navigation retries.
      }
    }

    void renew()
    return () => {
      disposed = true
      eventSourceRef.current?.close()
      eventSourceRef.current = null
    }
  }, [sessionId, recreateSession, applyNodes])

  useEffect(
    () => () => {
      if (asrTimerRef.current !== null) window.clearTimeout(asrTimerRef.current)
    },
    [],
  )

  const handleMindMapReady = useCallback(() => {
    mindmapRef.current?.updateTree(titleRef.current, nodesRef.current, { focusNew: false })
    const pending = pendingFocusRef.current
    if (pending && findNodeById(nodesRef.current, pending)) {
      pendingFocusRef.current = null
      mindmapRef.current?.focusNode?.(pending)
    }
  }, [])

  const handleSelectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId)
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
  const playbackError = playerError
  // `mapVersion` is the render trigger for the mutable tree in `nodesRef`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const chapters = useMemo(() => buildChapters(nodesRef.current), [mapVersion])
  const emptyMinutes = useMemo(() => {
    // `mapVersion` is the render trigger for the mutable tree in `nodesRef`.
    void mapVersion
    return findEmptyMinutes(nodesRef.current, transcript)
  }, [mapVersion, transcript])

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

          <VideoSearch onPick={(link) => void handleLoadVideo(link)} disabled={isLoading} />

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
              aria-label="Tải file phụ đề .srt hoặc .vtt"
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

        {rebuildOffer && (
          <div className="rebuild-bar" role="status">
            <span className="rebuild-bar__text">
              Đã đổi cách vẽ. Nội dung vẫn được tạo theo kiểu{' '}
              <strong>{MODE_LABELS[builtMode]}</strong>.
            </span>
            <span className="rebuild-bar__actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={rebuilding}
                onClick={() => void adoptMode(rebuildOffer, true)}
              >
                {rebuilding
                  ? 'Đang tạo lại…'
                  : `Tạo lại theo kiểu ${MODE_LABELS[rebuildOffer]}`}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={rebuilding}
                onClick={() => setRebuildOffer(null)}
              >
                Để sau
              </button>
            </span>
          </div>
        )}

        <div className={`app-status app-status--${status.kind}`} role="status" aria-live="polite">
          <span className="app-status__dot" aria-hidden="true" />
          <span className="app-status__text">{status.text}</span>
          <span className="app-status__meta">
            {verification && verification.checked > 0 && (
              <span
                title={`${verification.grounded} nhánh có bằng chứng phụ đề · ${verification.repaired} nhánh tự sửa · ${verification.dropped} nhánh bỏ vì không khớp`}
              >
                Đối chiếu {verification.checked} · sửa {verification.repaired} · bỏ {verification.dropped}
              </span>
            )}
            {transcript.length > 0 && <span>{transcript.length} mục phụ đề</span>}
            {videoId && <PlaybackTime clock={playbackClock} className="app-status__time" />}
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
            <PlaybackTime clock={playbackClock} className="player__clock" />
            <span className="player__track" aria-hidden="true">
              <PlaybackProgress clock={playbackClock} totalSeconds={totalSeconds} />
            </span>
            <span className="player__clock player__clock--muted">
              {totalSeconds > 0 ? formatTime(totalSeconds) : '—:—'}
            </span>
          </div>

          {chapters.length > 0 && (
            <ChapterRail chapters={chapters} clock={playbackClock} onSeek={handleSeek} />
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
                {transcriptSourceLabel(transcriptSource) && (
                  <span className="detail-tabs__source">
                    {transcriptSourceLabel(transcriptSource)}
                  </span>
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
                playbackClock={playbackClock}
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

                <label
                  className="session__output-language"
                  title="Ngôn ngữ của sơ đồ, không phụ thuộc vào ngôn ngữ phụ đề"
                >
                  <span>Ngôn ngữ sơ đồ</span>
                  <select
                    aria-label="Ngôn ngữ sơ đồ"
                    value={outputLanguage ?? ''}
                    disabled={!canEdit || !sessionId || outputLanguageBusy}
                    onChange={(event) => void changeOutputLanguage(event.target.value)}
                  >
                    <option value="">Theo phụ đề</option>
                    {OUTPUT_LANGUAGES.map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>

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

                <CoverageNotice ranges={emptyMinutes} onSeek={handleSeek} />

                {!selfCheckOpen && projectId && canEdit && authStatus === 'authenticated' && (
                  <div className="self-check-entry">
                    <span className="coverage-notice__label">Ôn lại</span>
                    <strong>Kiểm tra lại bài này</strong>
                    <p>
                      Nhãn vài nhánh sẽ bị che. Tự nhớ lại rồi mới xem đáp án — chỉ đếm nhánh
                      và ý bạn nắm được.
                    </p>
                    <button
                      className="btn btn--outline btn--sm"
                      type="button"
                      onClick={() => setSelfCheckOpen(true)}
                    >
                      Bắt đầu tự kiểm
                    </button>
                  </div>
                )}

                {selfCheckOpen && projectId && (
                  <SelfCheckPanel
                    projectId={projectId}
                    nodes={nodesRef.current}
                    cues={transcript}
                    onSeek={handleSeek}
                    onFocusTarget={focusMapNode}
                    onMaskedIdsChange={setMaskedIds}
                    onClose={() => {
                      setSelfCheckOpen(false)
                      setMaskedIds([])
                    }}
                  />
                )}

                <dl className="session__rows">
                  <div>
                    <dt>Video</dt>
                    <dd>{videoId || '—'}</dd>
                  </div>
                  <div>
                    <dt>Phụ đề</dt>
                    <dd>
                      {transcript.length > 0
                        ? `${transcript.length} mục${transcriptLang ? ` · ${transcriptLang}` : ''}${
                            transcriptSourceLabel(transcriptSource)
                              ? ` · ${transcriptSourceLabel(transcriptSource)}`
                              : ''
                          }`
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>Ý trong sơ đồ</dt>
                    <dd>{nodeCount > 0 ? nodeCount : '—'}</dd>
                  </div>
                  <div>
                    <dt>Thời điểm</dt>
                    <dd>{videoId ? <PlaybackTime clock={playbackClock} /> : '—'}</dd>
                  </div>
                </dl>

                <div className="session__moment">
                  <button
                    className="btn btn--outline btn--sm"
                    type="button"
                    onClick={() => void copyMomentLink()}
                  >
                    Sao chép link tới đây
                  </button>
                  <span>Gồm thời điểm phát và nhánh đang chọn.</span>
                </div>

                <div className="session__hint">
                  <span className="session__hint-title">Mẹo</span>
                  <p>
                    Dùng Tab hoặc phím mũi tên để duyệt nhánh, rồi Enter hoặc Space để chọn.
                    Dùng +/− để thu phóng và 0 để vừa khung. Nhánh có mốc thời gian sẽ tua
                    video; nhãn node sẽ mở chỉnh sửa.
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

              <button
                type="button"
                className="btn btn--outline btn--sm"
                onClick={() => setStyleOpen(true)}
                title="Đổi bảng màu và kiểu sơ đồ"
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" width="14" height="14">
                  <path
                    d="M4 15.5 12.5 7a1.8 1.8 0 0 0-2.5-2.5L1.5 13v2.5H4ZM11 5l3.5 3.5M14 12.5c1.4 0 2.5 1 2.5 2.3 0 1.2-1.1 2.2-2.5 2.2s-2.5-1-2.5-2.2c0-1.3 1.1-2.3 2.5-2.3Z"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Kiểu sơ đồ
              </button>

              <ExportMenu
                onExport={(format) => void handleExport(format)}
                disabled={nodeCount === 0}
                busy={exporting}
              />
            </div>
          </header>

          <div className="panel__body panel__body--canvas">
            {asrProgress && (
              <div className="asr-progress" role="status" aria-live="polite">
                <strong>IVAN đang nghe audio để tự tạo phụ đề</strong>
                <p>
                  Video này không có phụ đề. Bạn có thể xem video bên dưới trong lúc chờ — thường
                  mất 1–2 phút cho mỗi 10 phút video.
                </p>
                <div className="asr-progress__meta">
                  <span>
                    {asrProgress.stage === 'downloading'
                      ? 'Đang tải audio'
                      : asrProgress.stage === 'transcribing'
                        ? 'Đang nghe và chép lại'
                        : 'Đang xếp hàng'}
                  </span>
                  <span>Đã chờ {formatTime(asrProgress.elapsedSeconds)}</span>
                </div>
                <button type="button" className="btn btn--outline btn--sm" onClick={() => void cancelAsr()}>
                  Huỷ
                </button>
              </div>
            )}
            <Suspense fallback={<div className="canvas-loading">Đang tải sơ đồ…</div>}>
              <MindMap
                ref={mindmapRef}
                onSeek={handleSeek}
                onSelect={handleSelectNode}
                selectedId={selectedNodeId}
                collapseOld={focusRecent}
                onReady={handleMindMapReady}
                layout={mapStyle.layout}
                palette={mapStyle.palette}
                maskedIds={maskedIds}
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
      <MapStyleDialog
        open={styleOpen}
        initial={mapStyle}
        title={styleIntro ? 'Chọn kiểu sơ đồ' : 'Đổi kiểu sơ đồ'}
        confirmLabel={styleIntro ? 'Bắt đầu' : 'Áp dụng'}
        onClose={() => {
          // Dismissing means "keep what is on screen". Remembering it stops the
          // first-visit prompt from coming back; the dashboard's own picker
          // still asks before every new project.
          storeStyle(styleRef.current)
          setStyleIntro(false)
          setStyleOpen(false)
        }}
        onConfirm={(style) => {
          setStyleIntro(false)
          void handleStyleConfirm(style)
        }}
      />
    </div>
  )
}

export default App
