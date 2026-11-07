import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import ThemeToggle from '../../components/ThemeToggle'
import { useAuth } from '../../context/AuthContext'
import {
  deleteProject,
  duplicateProject,
  fetchProjectStats,
  formatWhen,
  listProjects,
  listSharedProjects,
  parseShareSlug,
  updateProject,
  type ProjectStats,
  type ProjectSummary,
  type SharedProjectSummary,
} from '../../lib/projects'
import ShareDialog from './ShareDialog'
import './Dashboard.css'

type SectionID = 'overview' | 'projects' | 'drafts' | 'shared' | 'join' | 'settings'

const sections: { id: SectionID; label: string }[] = [
  { id: 'overview', label: 'Tổng quan' },
  { id: 'projects', label: 'Dự án của tôi' },
  { id: 'drafts', label: 'Bản nháp' },
  { id: 'shared', label: 'Được chia sẻ' },
  { id: 'join', label: 'Tham gia dự án' },
  { id: 'settings', label: 'Cài đặt' },
]

const API_MESSAGE = 'Không tải được dữ liệu. Kiểm tra kết nối rồi thử lại.'

function Dashboard() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [active, setActive] = useState<SectionID>('overview')
  // Bumped after every mutation so the active section refetches.
  const [revision, setRevision] = useState(0)

  const handleLogout = async () => {
    // Leave the guarded route first: clearing the session while /dashboard is
    // mounted would make ProtectedRoute redirect to /login instead.
    navigate('/', { replace: true })
    await logout()
  }

  const refresh = useCallback(() => setRevision((value) => value + 1), [])

  const displayName = user?.display_name || 'bạn'
  const initial = displayName.trim().charAt(0).toUpperCase()
  const activeSection = sections.find((section) => section.id === active)

  return (
    <div className="dash">
      <aside className="dash-sidebar">
        <Link className="dash-brand" to="/">yt-mindmap</Link>

        <nav className="dash-nav" aria-label="Dashboard">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`dash-nav-item${active === section.id ? ' is-active' : ''}`}
              onClick={() => setActive(section.id)}
            >
              <span>{section.label}</span>
            </button>
          ))}
        </nav>

        <div className="dash-sidebar-footer">
          <Link className="dash-nav-item" to="/app">Mở workspace</Link>
          <Link className="dash-nav-item" to="/">Về trang chủ</Link>
        </div>
      </aside>

      <main className="dash-main">
        <header className="dash-header">
          <div className="dash-heading">
            <span className="dash-eyebrow">Dashboard</span>
            <h1>{activeSection?.label}</h1>
          </div>
          <div className="dash-account">
            <span className="dash-avatar" aria-hidden="true">{initial}</span>
            <span className="dash-account-name">{displayName}</span>
            <ThemeToggle />
            <button className="dash-logout" type="button" onClick={handleLogout}>
              Đăng xuất
            </button>
          </div>
        </header>

        <div className="dash-content">
          {active === 'overview' && (
            <Overview displayName={displayName} revision={revision} onOpen={setActive} />
          )}
          {active === 'projects' && (
            <ProjectList key="projects" draft={false} revision={revision} onChanged={refresh} />
          )}
          {active === 'drafts' && (
            <ProjectList key="drafts" draft revision={revision} onChanged={refresh} />
          )}
          {active === 'shared' && <SharedList revision={revision} />}
          {active === 'join' && <JoinSection />}
          {active === 'settings' && <SettingsSection />}
        </div>
      </main>
    </div>
  )
}

/* ---------------------------------------------------------------- */
/* Overview                                                          */
/* ---------------------------------------------------------------- */

function Overview({
  displayName,
  revision,
  onOpen,
}: {
  displayName: string
  revision: number
  onOpen: (section: SectionID) => void
}) {
  const [stats, setStats] = useState<ProjectStats | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchProjectStats()
      .then((data) => {
        if (cancelled) return
        setStats(data)
        setError('')
      })
      .catch(() => {
        if (!cancelled) setError(API_MESSAGE)
      })
    return () => {
      cancelled = true
    }
  }, [revision])

  return (
    <>
      <section className="dash-intro">
        <h2>Xin chào, {displayName}</h2>
        <p>
          Sơ đồ được lưu tự động vào tài khoản sau khi bạn ngừng chỉnh sửa ít giây. Mở lại
          bất kỳ dự án nào để tiếp tục đúng chỗ đang học — phụ đề, ghi chú và ghim vẫn còn nguyên.
        </p>
        <div className="dash-actions">
          <Link className="dash-cta" to="/app">Tạo mindmap mới</Link>
          <button
            className="dash-cta dash-cta--ghost"
            type="button"
            onClick={() => onOpen('projects')}
          >
            Xem dự án
          </button>
        </div>
      </section>

      {error && <p className="dash-error" role="alert">{error}</p>}

      <section className="dash-stats" aria-label="Thống kê">
        <article className="dash-stat">
          <span className="dash-stat-label">Dự án đã lưu</span>
          <strong>{stats ? stats.saved : '—'}</strong>
          <span className="dash-stat-note">Sơ đồ bạn chủ động đặt tên</span>
        </article>
        <article className="dash-stat">
          <span className="dash-stat-label">Bản nháp</span>
          <strong>{stats ? stats.drafts : '—'}</strong>
          <span className="dash-stat-note">Tự động lưu, chưa đặt tên</span>
        </article>
        <article className="dash-stat">
          <span className="dash-stat-label">Đang chia sẻ</span>
          <strong>{stats ? stats.shared : '—'}</strong>
          <span className="dash-stat-note">
            {stats && stats.shared_with_me > 0
              ? `+ ${stats.shared_with_me} dự án người khác chia sẻ với bạn`
              : 'Dự án bạn đang mở link hoặc mời người khác'}
          </span>
        </article>
      </section>

      <section className="dash-panel">
        <header className="dash-panel-header">
          <h2>Gần đây</h2>
          {stats && stats.recent.length > 0 && (
            <button className="dash-panel-link" type="button" onClick={() => onOpen('projects')}>
              Xem tất cả
            </button>
          )}
        </header>
        {stats ? (
          stats.recent.length > 0 ? (
            <ul className="dash-list">
              {stats.recent.map((project) => (
                <li key={project.id} className="dash-item">
                  <Link className="dash-item__main" to={`/app/${project.id}`}>
                    <span className="dash-item__title">{project.title}</span>
                    <span className="dash-item__meta">
                      {project.node_count} nhánh · cập nhật {formatWhen(project.updated_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="dash-empty-inline">
              Chưa có dự án nào. Mở workspace và bấm “Lưu dự án”, hoặc để bản nháp tự lưu.
            </p>
          )
        ) : (
          !error && <p className="dash-empty-inline">Đang tải…</p>
        )}
      </section>
    </>
  )
}

/* ---------------------------------------------------------------- */
/* Projects / drafts                                                 */
/* ---------------------------------------------------------------- */

function ProjectList({
  draft,
  revision,
  onChanged,
}: {
  draft: boolean
  revision: number
  onChanged: () => void
}) {
  const [items, setItems] = useState<ProjectSummary[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [sharing, setSharing] = useState<ProjectSummary | null>(null)

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      setLoading(true)
      listProjects({ draft, q: query })
        .then((data) => {
          if (cancelled) return
          setItems(data.items)
          setError('')
        })
        .catch(() => {
          if (!cancelled) setError(API_MESSAGE)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [draft, query, revision, reload])

  const changed = () => {
    setReload((value) => value + 1)
    onChanged()
  }

  const handleOpen = draft ? 'Tiếp tục' : 'Mở'
  const heading = draft ? 'Bản nháp tự động' : 'Dự án đã lưu'

  return (
    <>
      <section className="dash-panel">
        <header className="dash-panel-header">
          <h2>{heading}</h2>
          <span className="dash-panel-note">
            {loading ? 'Đang tải…' : `${items.length} mục`}
          </span>
        </header>

        <div className="dash-toolbar">
          <input
            className="dash-search"
            type="search"
            value={query}
            placeholder="Tìm theo tên hoặc mã video"
            aria-label="Tìm dự án"
            onChange={(event) => setQuery(event.target.value)}
          />
          <Link className="dash-cta dash-cta--ghost" to="/app">
            {draft ? 'Tạo bản nháp mới' : 'Tạo dự án mới'}
          </Link>
        </div>

        {error && <p className="dash-error" role="alert">{error}</p>}

        {!loading && !error && items.length === 0 ? (
          <p className="dash-empty-inline">
            {query
              ? 'Không tìm thấy dự án nào khớp từ khoá.'
              : draft
                ? 'Chưa có bản nháp. Sơ đồ đang làm trong workspace sẽ tự lưu thành bản nháp.'
                : 'Chưa có dự án nào. Mở workspace, tạo sơ đồ rồi bấm “Lưu dự án”.'}
          </p>
        ) : (
          <ul className="dash-list">
            {items.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                openLabel={handleOpen}
                onChanged={changed}
                onShare={() => setSharing(project)}
              />
            ))}
          </ul>
        )}
      </section>

      {sharing && (
        <ShareDialog project={sharing} onClose={() => setSharing(null)} />
      )}
    </>
  )
}

function ProjectRow({
  project,
  openLabel,
  onChanged,
  onShare,
}: {
  project: ProjectSummary
  openLabel: string
  onChanged: () => void
  onShare: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(project.title)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      onChanged()
      return true
    } catch {
      setError('Thao tác thất bại')
      return false
    } finally {
      setBusy(false)
    }
  }

  const rename = async () => {
    const next = title.trim()
    if (!next || next === project.title) {
      setEditing(false)
      return
    }
    if (await run(() => updateProject(project.id, { title: next }))) setEditing(false)
  }

  const promote = async () => {
    await run(() => updateProject(project.id, { is_draft: false }))
  }

  return (
    <li className="dash-item">
      <div className="dash-item__main">
        {editing ? (
          <form
            className="dash-item__rename"
            onSubmit={(event) => {
              event.preventDefault()
              void rename()
            }}
          >
            <input
              value={title}
              maxLength={200}
              autoFocus
              aria-label="Tên dự án"
              onChange={(event) => setTitle(event.target.value)}
            />
            <button className="dash-mini" type="submit" disabled={busy}>Lưu</button>
            <button
              className="dash-mini"
              type="button"
              onClick={() => {
                setTitle(project.title)
                setEditing(false)
              }}
            >
              Huỷ
            </button>
          </form>
        ) : (
          <Link className="dash-item__link" to={`/app/${project.id}`}>
            <span className="dash-item__title">{project.title}</span>
            <span className="dash-item__meta">
              {project.video_id ? `${project.video_id} · ` : ''}
              {project.node_count} nhánh · cập nhật {formatWhen(project.updated_at)}
              {project.is_draft ? ' · bản nháp' : ''}
              {project.visibility !== 'private' ? ' · đang chia sẻ' : ''}
            </span>
          </Link>
        )}
        {error && <span className="dash-item__error">{error}</span>}
      </div>

      <div className="dash-item__actions">
        {confirming ? (
          <>
            <span className="dash-item__confirm">Xoá dự án này?</span>
            <button
              className="dash-mini dash-mini--danger"
              type="button"
              disabled={busy}
              onClick={async () => {
                if (await run(() => deleteProject(project.id))) setConfirming(false)
              }}
            >
              Xoá
            </button>
            <button className="dash-mini" type="button" onClick={() => setConfirming(false)}>
              Huỷ
            </button>
          </>
        ) : (
          <>
            <Link className="dash-mini dash-mini--link" to={`/app/${project.id}`}>
              {openLabel}
            </Link>
            <button className="dash-mini" type="button" onClick={() => setEditing(true)}>
              Đổi tên
            </button>
            {project.is_draft ? (
              <button className="dash-mini" type="button" disabled={busy} onClick={() => void promote()}>
                Lưu thành dự án
              </button>
            ) : (
              <>
                <button
                  className="dash-mini"
                  type="button"
                  disabled={busy}
                  onClick={onShare}
                >
                  Chia sẻ
                </button>
                <button
                  className="dash-mini"
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => duplicateProject(project.id))}
                >
                  Nhân bản
                </button>
              </>
            )}
            <button
              className="dash-mini dash-mini--danger"
              type="button"
              onClick={() => setConfirming(true)}
            >
              Xoá
            </button>
          </>
        )}
      </div>
    </li>
  )
}

/* ---------------------------------------------------------------- */
/* Shared with me                                                    */
/* ---------------------------------------------------------------- */

const ROLE_TEXT: Record<string, string> = {
  viewer: 'Chỉ xem',
  editor: 'Có thể chỉnh sửa',
}

function SharedList({ revision }: { revision: number }) {
  const [items, setItems] = useState<SharedProjectSummary[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      setLoading(true)
      listSharedProjects({ q: query })
        .then((data) => {
          if (cancelled) return
          setItems(data.items)
          setError('')
        })
        .catch(() => {
          if (!cancelled) setError(API_MESSAGE)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, revision])

  return (
    <section className="dash-panel">
      <header className="dash-panel-header">
        <h2>Được chia sẻ với tôi</h2>
        <span className="dash-panel-note">
          {loading ? 'Đang tải…' : `${items.length} mục`}
        </span>
      </header>

      <div className="dash-toolbar">
        <input
          className="dash-search"
          type="search"
          value={query}
          placeholder="Tìm theo tên hoặc mã video"
          aria-label="Tìm dự án được chia sẻ"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {error && <p className="dash-error" role="alert">{error}</p>}

      {!loading && !error && items.length === 0 ? (
        <p className="dash-empty-inline">
          {query
            ? 'Không tìm thấy dự án nào khớp từ khoá.'
            : 'Chưa có ai chia sẻ dự án với email của bạn. Khi được mời, dự án sẽ xuất hiện ở đây.'}
        </p>
      ) : (
        <ul className="dash-list">
          {items.map((project) => (
            <li key={project.id} className="dash-item">
              <div className="dash-item__main">
                <Link className="dash-item__link" to={`/app/${project.id}`}>
                  <span className="dash-item__title">
                    {project.title}
                    <span className={`share-badge share-badge--${project.role}`}>
                      {ROLE_TEXT[project.role] || project.role}
                    </span>
                  </span>
                  <span className="dash-item__meta">
                    của {project.owner_name}
                    {project.video_id ? ` · ${project.video_id}` : ''}
                    {` · ${project.node_count} nhánh · cập nhật ${formatWhen(project.updated_at)}`}
                  </span>
                </Link>
              </div>
              <div className="dash-item__actions">
                <Link className="dash-mini dash-mini--link" to={`/app/${project.id}`}>
                  Mở
                </Link>
                {project.share_slug && (
                  <Link
                    className="dash-mini dash-mini--link"
                    to={`/s/${project.share_slug}`}
                  >
                    Xem bằng link
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/* ---------------------------------------------------------------- */
/* Placeholders and account                                          */
/* ---------------------------------------------------------------- */

function JoinSection() {
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const [error, setError] = useState('')

  const join = () => {
    const slug = parseShareSlug(value)
    if (!slug) {
      setError('Mã chia sẻ chưa đúng. Ví dụ: YTMM-8F2K9QZ1 hoặc dán nguyên link được gửi.')
      return
    }
    navigate(`/s/${slug}`)
  }

  return (
    <section className="dash-panel">
      <header className="dash-panel-header">
        <h2>Tham gia dự án được chia sẻ</h2>
        <span className="dash-panel-note">Bằng link</span>
      </header>
      <p className="dash-empty-inline">
        Dán link chia sẻ hoặc mã YTMM-… để mở sơ đồ của người khác. Nếu dự án chỉ dành
        cho người được mời, bạn cần đăng nhập đúng email đã được mời.
      </p>
      <form
        className="dash-join"
        onSubmit={(event) => {
          event.preventDefault()
          join()
        }}
      >
        <input
          type="text"
          placeholder="Ví dụ: YTMM-8F2K9QZ1"
          aria-label="Mã hoặc link chia sẻ"
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            if (error) setError('')
          }}
        />
        <button type="submit" disabled={!value.trim()}>Tham gia</button>
      </form>
      {error && <p className="dash-error" role="alert">{error}</p>}
    </section>
  )
}

function SettingsSection() {
  const { user, logout } = useAuth()

  return (
    <section className="dash-panel">
      <header className="dash-panel-header">
        <h2>Thông tin tài khoản</h2>
        <span className="dash-panel-note">Chỉnh sửa hồ sơ: Giai đoạn 4</span>
      </header>

      <dl className="dash-rows">
        <div>
          <dt>Tên hiển thị</dt>
          <dd>{user?.display_name}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{user?.email}</dd>
        </div>
        <div>
          <dt>Phương thức đăng nhập</dt>
          <dd>{user?.provider === 'local' ? 'Email & mật khẩu' : user?.provider}</dd>
        </div>
        <div>
          <dt>Xác minh email</dt>
          <dd>{user?.email_verified ? 'Đã xác minh' : 'Chưa xác minh (sẽ bổ sung ở giai đoạn cuối)'}</dd>
        </div>
        <div>
          <dt>Lưu trữ</dt>
          <dd>Dự án và bản nháp được lưu trong tài khoản, không phụ thuộc trình duyệt</dd>
        </div>
      </dl>

      <button className="dash-cta dash-cta--ghost" type="button" onClick={() => void logout()}>
        Đăng xuất
      </button>
    </section>
  )
}

export default Dashboard
