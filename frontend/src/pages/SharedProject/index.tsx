/**
 * Read-only page behind a share link (`/s/YTMM-…`).
 *
 * Anyone with the link can read a public project without an account; an
 * invite-only project asks the server who the signed-in email is. Editors get a
 * button into the full workspace, where they can actually change the map.
 */

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import YouTube from 'react-youtube'
import type { YouTubeProps } from 'react-youtube'
import ThemeToggle from '../../components/ThemeToggle'
import type { MindMapHandle } from '../../components/MindMap'
import { useAuth } from '../../context/AuthContext'
import { API_BASE, ApiError } from '../../lib/api'
import { applyRouteMetadata, getRouteMetadata } from '../../lib/seo'
import {
  getSharedBySlug,
  type SharedProjectView,
} from '../../lib/projects'
import { normalizeTree, type MapNode } from '../../lib/mindmapTree'
import { watchUrl, playerErrorMessage, type PlayerErrorInfo } from '../../lib/youtube'
import { PlaybackClock } from '../../lib/playbackClock'
import { PlaybackTime } from '../../components/PlaybackTime'
import '../Workspace/Workspace.css'
import './SharedProject.css'

const MindMap = lazy(() => import('../../components/MindMap'))

const ROLE_TEXT = {
  viewer: 'Chỉ xem',
  editor: 'Có thể chỉnh sửa',
} as const

interface LoadError {
  kind: 'missing' | 'login' | 'not-invited' | 'network'
  message: string
}

function describeError(error: unknown): LoadError {
  if (error instanceof ApiError) {
    const detail = error.detail
    const code =
      detail && typeof detail === 'object' && 'code' in detail
        ? String((detail as { code: unknown }).code)
        : null

    // Server details are English by design (they double as API errors), so the
    // share page keeps its own Vietnamese copy keyed by code.
    if (code === 'share_login_required' || error.status === 401) {
      return {
        kind: 'login',
        message: 'Đăng nhập bằng email đã được mời để mở dự án này.',
      }
    }
    if (code === 'share_not_invited' || error.status === 403) {
      return {
        kind: 'not-invited',
        message: 'Tài khoản đang đăng nhập chưa được mời vào dự án này.',
      }
    }
    return {
      kind: 'missing',
      message: 'Link chia sẻ không tồn tại hoặc đã bị chủ dự án tắt.',
    }
  }
  return {
    kind: 'network',
    message: 'Không tải được dự án. Kiểm tra kết nối rồi thử lại.',
  }
}

function SharedProject() {
  const { slug = '' } = useParams<{ slug: string }>()
  const location = useLocation()
  const { status: authStatus } = useAuth()

  const [data, setData] = useState<SharedProjectView | null>(null)
  const [error, setError] = useState<LoadError | null>(null)
  const [loading, setLoading] = useState(true)
  const [player, setPlayer] = useState<any>(null)
  const [playerError, setPlayerError] = useState<PlayerErrorInfo | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackClock] = useState(() => new PlaybackClock())
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const mindmapRef = useRef<MindMapHandle>(null)
  const nodesRef = useRef<MapNode[]>([])
  const titleRef = useRef('')
  const sessionRef = useRef<string | null>(null)

  const applyNodes = useCallback((nodes: MapNode[], focusNew: boolean) => {
    const normalized = normalizeTree(nodes)
    nodesRef.current = normalized
    mindmapRef.current?.updateTree(titleRef.current, normalized, { focusNew })
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    getSharedBySlug(slug)
      .then((view) => {
        if (cancelled) return
        titleRef.current = view.project.title
        setData(view)
        // The lazy map may already be mounted (or may mount later), so push
        // the snapshot now and let onReady push it again if it is not.
        applyNodes(view.project.nodes, false)
        sessionRef.current = view.session_id
      })
      .catch((caught) => {
        if (!cancelled) setError(describeError(caught))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [slug, authStatus, applyNodes])

  useEffect(() => {
    if (!data) return
    const routeMetadata = getRouteMetadata(location.pathname)
    applyRouteMetadata(
      {
        ...routeMetadata,
        title: `${data.project.title} — sơ đồ tư duy | yt-mindmap`,
        description: `Xem sơ đồ tư duy “${data.project.title}” được chia sẻ bằng yt-mindmap.`,
      },
      location.pathname,
    )
  }, [data, location.pathname])

  // The project row is the initial snapshot; the shared live session adds
  // edits from collaborators as they happen.
  useEffect(() => {
    const session = data?.session_id
    if (!session) return
    const source = new EventSource(`${API_BASE}/stream/${session}`)
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data)
        if (
          payload &&
          (payload.type === 'diff' || payload.type === 'node_edit') &&
          Array.isArray(payload.nodes)
        ) {
          applyNodes(payload.nodes, payload.type === 'diff')
        }
      } catch {
        // A malformed event must not take the whole page down.
      }
    }
    return () => source.close()
  }, [data?.session_id, applyNodes])

  const handleReady = useCallback(() => {
    applyNodes(nodesRef.current, false)
  }, [applyNodes])

  const handleSelectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId)
  }, [])

  const onPlayerReady: YouTubeProps['onReady'] = (event) => {
    setPlayer(event.target)
  }

  const onPlayerError: YouTubeProps['onError'] = (event) => {
    setIsPlaying(false)
    setPlayerError(playerErrorMessage(event.data))
  }

  const handleSeek = useCallback(
    (seconds: number) => {
      if (!player || typeof player.seekTo !== 'function') return
      player.seekTo(seconds, true)
      playbackClock.set(seconds, true)
    },
    [player, playbackClock],
  )

  const onPlayerStateChange: YouTubeProps['onStateChange'] = (event: any) => {
    const YT = (window as any).YT
    if (event.data === YT?.PlayerState?.PLAYING) {
      setIsPlaying(true)
      setPlayerError(null)
    } else if (
      event.data === YT?.PlayerState?.PAUSED ||
      event.data === YT?.PlayerState?.ENDED
    ) {
      setIsPlaying(false)
    }
  }

  useEffect(() => {
    if (!player || !isPlaying) return
    const interval = window.setInterval(() => {
      if (typeof player.getCurrentTime === 'function') {
        playbackClock.set(player.getCurrentTime())
      }
    }, 1000)
    return () => window.clearInterval(interval)
  }, [player, isPlaying, playbackClock])

  if (loading) {
    return (
      <div className="shared-shell">
        <p className="shared-loading">Đang mở sơ đồ được chia sẻ…</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="shared-shell">
        <section className="shared-error" role="alert">
          <span className="shared-eyebrow">
            {error?.kind === 'login'
              ? 'Cần đăng nhập'
              : error?.kind === 'not-invited'
                ? 'Chưa được mời'
                : 'Không mở được link'}
          </span>
          <h1>{error?.message || 'Link chia sẻ không hợp lệ.'}</h1>
          <div className="shared-error__actions">
            {error?.kind === 'login' ? (
              <Link
                className="btn btn--primary btn--sm"
                to="/login"
                state={{ from: location.pathname }}
              >
                Đăng nhập
              </Link>
            ) : error?.kind === 'not-invited' ? (
              <Link
                className="btn btn--primary btn--sm"
                to="/login"
                state={{ from: location.pathname }}
              >
                Đổi tài khoản
              </Link>
            ) : null}
            <Link className="btn btn--ghost btn--sm" to="/">
              Về trang chủ
            </Link>
          </div>
        </section>
      </div>
    )
  }

  const project = data.project
  const videoId = project.video_id
  const roleLabel = ROLE_TEXT[data.role] || data.role

  return (
    <div className="app-shell shared-app">
      <header className="app-topbar">
        <div className="app-topbar__row">
          <Link className="app-brand" to="/" aria-label="yt-mindmap — về trang chủ">
            <img
              className="app-brand__mark"
              src="/yt-mindmap-icon.png"
              alt=""
              aria-hidden="true"
            />
            <span className="app-brand__text">yt-mindmap</span>
          </Link>

          <div className="shared-title">
            <span className="shared-eyebrow">Sơ đồ được chia sẻ</span>
            <strong>{project.title}</strong>
          </div>

          <div className="app-topbar__actions">
            <span className={`app-role app-role--${data.role}`}>{roleLabel}</span>
            {data.can_edit && (
              <Link className="btn btn--primary btn--sm" to={`/app/${project.id}`}>
                Mở để chỉnh sửa
              </Link>
            )}
            <Link
              className="btn btn--ghost btn--sm app-topbar__account"
              to={authStatus === 'authenticated' ? '/dashboard' : '/login'}
              state={
                authStatus === 'authenticated'
                  ? undefined
                  : { from: location.pathname }
              }
            >
              {authStatus === 'authenticated' ? 'Dashboard' : 'Đăng nhập'}
            </Link>
            <ThemeToggle />
          </div>
        </div>

        <div className="app-status app-status--ok" role="status">
          <span className="app-status__dot" aria-hidden="true" />
          <span className="app-status__text">
            {data.owner_name} chia sẻ với quyền {roleLabel.toLowerCase()}
          </span>
          <span className="app-status__meta">
            <span>{project.node_count} ý</span>
            {videoId && <PlaybackTime clock={playbackClock} className="app-status__time" />}
          </span>
        </div>
      </header>

      <main className="workspace">
        <section className="panel panel--player" aria-label="Bài giảng">
          <header className="panel__head">
            <h2 className="panel__title">Bài giảng</h2>
            <span className="panel__meta">{videoId ? 'YouTube' : 'Không có video'}</span>
          </header>

          <div className="player">
            {videoId ? (
              <div className="player__frame">
                <YouTube
                  videoId={videoId}
                  opts={{ height: '100%', width: '100%', playerVars: { autoplay: 0, rel: 0 } }}
                  onReady={onPlayerReady}
                  onStateChange={onPlayerStateChange}
                  onError={onPlayerError}
                  style={{ height: '100%', width: '100%' }}
                />
                {playerError && (
                  <div className="player__notice" role="alert">
                    <h3>{playerError.title}</h3>
                    <p>{playerError.message}</p>
                    <a href={watchUrl(videoId)} target="_blank" rel="noopener noreferrer">
                      Mở trên YouTube
                    </a>
                  </div>
                )}
              </div>
            ) : (
              <div className="player__empty">
                <span className="player__empty-glyph" aria-hidden="true">▶</span>
                <h3>Không có video</h3>
                <p>Sơ đồ này được tạo từ file phụ đề, nên không có trình phát.</p>
              </div>
            )}
          </div>
        </section>

        <section className="panel panel--details" aria-label="Thông tin dự án">
          <header className="panel__head">
            <h2 className="panel__title">Về sơ đồ này</h2>
            <span className="panel__meta">{project.node_count} ý</span>
          </header>
          <div className="panel__body panel__body--details">
            <div className="session">
              <div className="session__title">
                <span className="session__label">Chủ đề</span>
                <strong>{project.title}</strong>
              </div>

              <dl className="session__rows">
                <div>
                  <dt>Người chia sẻ</dt>
                  <dd>{data.owner_name}</dd>
                </div>
                <div>
                  <dt>Quyền của bạn</dt>
                  <dd>{roleLabel}</dd>
                </div>
                <div>
                  <dt>Video</dt>
                  <dd>{videoId || 'File phụ đề'}</dd>
                </div>
                <div>
                  <dt>Cập nhật</dt>
                  <dd>
                    {project.updated_at
                      ? new Date(project.updated_at).toLocaleDateString('vi-VN')
                      : '—'}
                  </dd>
                </div>
              </dl>

              <div className="session__readonly">
                <strong>{data.can_edit ? 'Bạn có thể chỉnh sửa' : 'Chế độ chỉ xem'}</strong>
                <p>
                  {data.can_edit
                    ? 'Mở workspace để sửa nhãn, ghi chú, ghim và theo dõi video. Thay đổi được lưu vào dự án của chủ sở hữu.'
                    : 'Bạn xem được toàn bộ sơ đồ, ghi chú và ghim. Muốn sửa, hãy nhờ chủ dự án cấp quyền chỉnh sửa.'}
                </p>
              </div>

              <div className="session__hint">
                <span className="session__hint-title">Mẹo</span>
                <p>
                  Dùng Tab hoặc phím mũi tên để duyệt nhánh, Enter hoặc Space để chọn;
                  nhánh có mốc thời gian sẽ tua video tới đúng đoạn.
                  {data.can_edit ? ' Nút “Mở để chỉnh sửa” ở thanh trên mở workspace đầy đủ.' : ''}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="panel panel--canvas" aria-label="Sơ đồ tư duy">
          <header className="panel__head panel__head--canvas">
            <div className="panel__heading">
              <h2 className="panel__title">Sơ đồ tư duy</h2>
              <p className="panel__sub">
                {project.node_count > 0
                  ? `${project.node_count} ý · chia sẻ bởi ${data.owner_name}`
                  : 'Chủ dự án chưa thêm nội dung nào'}
              </p>
            </div>
          </header>

          <div className="panel__body panel__body--canvas">
            <Suspense fallback={<div className="canvas-loading">Đang tải sơ đồ…</div>}>
              <MindMap
                ref={mindmapRef}
                onSeek={handleSeek}
                onSelect={handleSelectNode}
                selectedId={selectedNodeId}
                onReady={handleReady}
              />
            </Suspense>

            <div className="canvas-toolbar" role="group" aria-label="Điều khiển sơ đồ">
              <button
                type="button"
                className="canvas-toolbar__btn"
                aria-label="Thu nhỏ"
                title="Thu nhỏ"
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
                title="Phóng to"
                onClick={() => mindmapRef.current?.zoom(1.2)}
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M10 5v10M5 10h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
              <span className="canvas-toolbar__divider" aria-hidden="true" />
              <button
                type="button"
                className="canvas-toolbar__btn"
                aria-label="Vừa khung"
                title="Vừa khung"
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

export default SharedProject
