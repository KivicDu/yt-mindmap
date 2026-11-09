import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import ThemeToggle from '../../components/ThemeToggle'
import { useAuth } from '../../context/AuthContext'
import { accountErrorMessage, validateEmailChange, validatePasswordChange } from '../../lib/account'
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
    <div className="dash-settings">
      <ProfileCard />
      <VerificationCard />
      <EmailCard />

      <section className="dash-panel">
        <header className="dash-panel-header">
          <h2>Thông tin tài khoản</h2>
          <span className="dash-panel-note">Chỉ bạn nhìn thấy</span>
        </header>

        <dl className="dash-rows">
          <div>
            <dt>Email</dt>
            <dd>{user?.email}</dd>
          </div>
          <div>
            <dt>Phương thức đăng nhập</dt>
            <dd>{user?.provider === 'local' ? 'Email & mật khẩu' : user?.provider}</dd>
          </div>
          <div>
            <dt>Lưu trữ</dt>
            <dd>Dự án và bản nháp được lưu trong tài khoản, không phụ thuộc trình duyệt</dd>
          </div>
        </dl>
      </section>

      {user?.provider === 'local' && <PasswordCard />}

      <section className="dash-panel">
        <header className="dash-panel-header">
          <h2>Phiên đăng nhập</h2>
          <span className="dash-panel-note">Thiết bị này</span>
        </header>
        <p className="dash-empty-inline">
          Đăng xuất sẽ thu hồi refresh token của trình duyệt này. Các thiết bị khác vẫn
          giữ phiên riêng cho tới khi bạn đổi mật khẩu.
        </p>
        <div className="dash-actions">
          <button className="dash-cta dash-cta--ghost" type="button" onClick={() => void logout()}>
            Đăng xuất
          </button>
        </div>
      </section>

      <DangerZone />
    </div>
  )
}

function DangerZone() {
  const { user, deleteAccount } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const emailMatches =
    Boolean(user) &&
    email.trim().toLowerCase() === user?.email.trim().toLowerCase() &&
    (user?.provider !== 'local' || password.length > 0)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!user || busy) return

    if (email.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
      setError('Gõ đúng email của tài khoản để xác nhận.')
      return
    }
    if (user.provider === 'local' && !password) {
      setError('Nhập mật khẩu hiện tại để xoá tài khoản.')
      return
    }

    setBusy(true)
    setError('')
    try {
      await deleteAccount(email.trim(), user.provider === 'local' ? password : undefined)
      // A full reload is deliberate: it drops the in-memory access token and
      // avoids a race where ProtectedRoute redirects to /login while the SPA
      // is still transitioning away from /dashboard.
      window.location.assign('/')
    } catch (caught) {
      setError(accountErrorMessage(caught))
      setBusy(false)
    }
  }

  return (
    <section className="dash-panel dash-panel--danger">
      <header className="dash-panel-header">
        <h2>Xoá tài khoản</h2>
        <span className="dash-panel-note">Không thể hoàn tác</span>
      </header>

      <p className="dash-empty-inline">
        Toàn bộ dự án, bản nháp, sơ đồ tư duy và phiên đăng nhập sẽ bị xoá vĩnh viễn.
        Email của bạn cũng được gỡ khỏi mọi lời mời chia sẻ.
      </p>

      {!confirming ? (
        <div className="dash-actions">
          <button
            className="dash-cta dash-cta--danger"
            type="button"
            onClick={() => setConfirming(true)}
          >
            Tôi muốn xoá tài khoản
          </button>
        </div>
      ) : (
        <form className="dash-form" onSubmit={(event) => void submit(event)} noValidate>
          <label className="dash-field">
            <span>Gõ lại email {user?.email}</span>
            <input
              type="email"
              autoComplete="off"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                setError('')
              }}
              placeholder={user?.email}
            />
          </label>

          {user?.provider === 'local' && (
            <label className="dash-field">
              <span>Mật khẩu hiện tại</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                  setError('')
                }}
              />
            </label>
          )}

          {error && <p className="dash-feedback dash-feedback--error">{error}</p>}

          <div className="dash-form-actions">
            <button
              className="dash-cta dash-cta--danger"
              type="submit"
              disabled={!emailMatches || busy}
            >
              {busy ? 'Đang xoá…' : 'Xoá tài khoản vĩnh viễn'}
            </button>
            <button
              className="dash-cta dash-cta--ghost"
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirming(false)
                setEmail('')
                setPassword('')
                setError('')
              }}
            >
              Huỷ
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

function ProfileCard() {
  const { user, updateProfile } = useAuth()
  const [name, setName] = useState(user?.display_name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const trimmed = name.trim()
  const dirty = Boolean(user) && trimmed !== user?.display_name && trimmed.length > 0

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!trimmed || busy) return
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      await updateProfile(trimmed)
      setSaved(true)
    } catch (caught) {
      setError(accountErrorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="dash-panel">
      <header className="dash-panel-header">
        <h2>Hồ sơ</h2>
        <span className="dash-panel-note">Tên hiển thị trong dự án được chia sẻ</span>
      </header>

      <form className="dash-form" onSubmit={(event) => void submit(event)}>
        <label className="dash-field">
          <span>Tên hiển thị</span>
          <input
            type="text"
            value={name}
            maxLength={80}
            autoComplete="name"
            onChange={(event) => {
              setName(event.target.value)
              setSaved(false)
            }}
          />
        </label>

        {error && <p className="dash-feedback dash-feedback--error">{error}</p>}
        {saved && <p className="dash-feedback dash-feedback--ok">Đã lưu tên hiển thị.</p>}

        <div className="dash-form-actions">
          <button className="dash-cta" type="submit" disabled={!dirty || busy}>
            {busy ? 'Đang lưu…' : 'Lưu hồ sơ'}
          </button>
        </div>
      </form>
    </section>
  )
}

function VerificationCard() {
  const { user, requestEmailVerification } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [devLink, setDevLink] = useState<string | null>(null)

  const request = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await requestEmailVerification()
      setSent(result.status === 'sent')
      setDevLink(result.dev_link)
    } catch (caught) {
      setError(accountErrorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="dash-panel">
      <header className="dash-panel-header">
        <h2>Xác minh email</h2>
        <span className={`dash-badge${user?.email_verified ? ' dash-badge--ok' : ''}`}>
          {user?.email_verified ? 'Đã xác minh' : 'Chưa xác minh'}
        </span>
      </header>

      {user?.email_verified ? (
        <p className="dash-empty-inline">
          Email <strong>{user.email}</strong> đã được xác minh. Người được mời bằng đúng
          địa chỉ này sẽ mở được dự án chia sẻ.
        </p>
      ) : (
        <>
          <p className="dash-empty-inline">
            Xác minh <strong>{user?.email}</strong> để chắc chắn lời mời chia sẻ đến đúng
            người. Link xác minh được gửi tới hộp thư của bạn và hết hạn sau 24 giờ.
          </p>

          {error && <p className="dash-feedback dash-feedback--error">{error}</p>}
          {sent && !devLink && (
            <p className="dash-feedback dash-feedback--ok">
              Đã gửi link xác minh. Kiểm tra hộp thư (và cả thư mục spam) nhé.
            </p>
          )}
          {devLink && (
            <p className="dash-feedback dash-feedback--ok">
              Chế độ dev:{' '}
              <a href={devLink}>mở link xác minh</a>.
            </p>
          )}

          <div className="dash-actions">
            <button className="dash-cta" type="button" onClick={() => void request()} disabled={busy}>
              {busy ? 'Đang gửi…' : sent ? 'Gửi lại link' : 'Gửi link xác minh'}
            </button>
          </div>
        </>
      )}
    </section>
  )
}

function EmailCard() {
  const { user, requestEmailChange } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [devLink, setDevLink] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !user) return

    const problem = validateEmailChange(email, user.email)
    if (problem) {
      setError(problem)
      setSent(false)
      return
    }
    if (user.provider === 'local' && !password) {
      setError('Nhập mật khẩu hiện tại để đổi email.')
      return
    }

    setBusy(true)
    setError('')
    setSent(false)
    setDevLink(null)
    try {
      const result = await requestEmailChange(
        email.trim(),
        user.provider === 'local' ? password : undefined,
      )
      if (result.status === 'unchanged') {
        setError('Email mới cần khác email hiện tại.')
        return
      }
      setSent(true)
      setDevLink(result.dev_link)
      setPassword('')
    } catch (caught) {
      setError(accountErrorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="dash-panel">
      <header className="dash-panel-header">
        <h2>Đổi email</h2>
        <span className="dash-panel-note">Cần xác nhận qua hộp thư mới</span>
      </header>

      <p className="dash-empty-inline">
        Email hiện tại: <strong>{user?.email}</strong>. Link xác nhận sẽ gửi tới địa chỉ
        mới; sau khi xác nhận, mọi thiết bị sẽ đăng xuất.
      </p>

      <form className="dash-form" onSubmit={(event) => void submit(event)} noValidate>
        <label className="dash-field">
          <span>Email mới</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setError('')
              setSent(false)
            }}
            placeholder="email-moi@example.com"
          />
        </label>

        {user?.provider === 'local' && (
          <label className="dash-field">
            <span>Mật khẩu hiện tại</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                setError('')
                setSent(false)
              }}
            />
          </label>
        )}

        {error && <p className="dash-feedback dash-feedback--error">{error}</p>}
        {sent && !devLink && (
          <p className="dash-feedback dash-feedback--ok">
            Đã gửi link xác nhận tới <strong>{email.trim()}</strong>. Mở hộp thư để hoàn tất.
          </p>
        )}
        {devLink && (
          <p className="dash-feedback dash-feedback--ok">
            Chế độ dev: <a href={devLink}>mở link xác nhận email mới</a>.
          </p>
        )}

        <div className="dash-form-actions">
          <button className="dash-cta" type="submit" disabled={busy}>
            {busy ? 'Đang gửi…' : 'Gửi link xác nhận'}
          </button>
        </div>
      </form>
    </section>
  )
}

function PasswordCard() {
  const { changePassword } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return

    const problem = validatePasswordChange(current, next, confirm)
    if (problem) {
      setError(problem)
      setSaved(false)
      return
    }

    setBusy(true)
    setError('')
    setSaved(false)
    try {
      await changePassword(current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      setSaved(true)
    } catch (caught) {
      setError(accountErrorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="dash-panel">
      <header className="dash-panel-header">
        <h2>Đổi mật khẩu</h2>
        <span className="dash-panel-note">Các thiết bị khác sẽ bị đăng xuất</span>
      </header>

      <form className="dash-form" onSubmit={(event) => void submit(event)}>
        <label className="dash-field">
          <span>Mật khẩu hiện tại</span>
          <input
            type="password"
            value={current}
            autoComplete="current-password"
            onChange={(event) => setCurrent(event.target.value)}
          />
        </label>
        <label className="dash-field">
          <span>Mật khẩu mới</span>
          <input
            type="password"
            value={next}
            autoComplete="new-password"
            onChange={(event) => setNext(event.target.value)}
          />
        </label>
        <label className="dash-field">
          <span>Nhập lại mật khẩu mới</span>
          <input
            type="password"
            value={confirm}
            autoComplete="new-password"
            onChange={(event) => setConfirm(event.target.value)}
          />
        </label>

        {error && <p className="dash-feedback dash-feedback--error">{error}</p>}
        {saved && <p className="dash-feedback dash-feedback--ok">Đã đổi mật khẩu và làm mới phiên đăng nhập.</p>}

        <div className="dash-form-actions">
          <button className="dash-cta" type="submit" disabled={busy}>
            {busy ? 'Đang đổi…' : 'Đổi mật khẩu'}
          </button>
        </div>
      </form>
    </section>
  )
}

export default Dashboard
