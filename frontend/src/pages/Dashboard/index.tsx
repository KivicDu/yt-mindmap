import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import ThemeToggle from '../../components/ThemeToggle'
import NewProjectButton from '../../components/NewProjectButton'
import { SkeletonList } from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/useToast'
import { useAuth } from '../../context/AuthContext'
import { accountErrorMessage, validateEmailChange, validatePasswordChange } from '../../lib/account'
import { formatTime as formatClock } from '../../lib/mindmapTree'
import {
  deleteProject,
  duplicateProject,
  fetchProjectStats,
  formatWhen,
  listProjects,
  listSharedProjects,
  listTags,
  listTrash,
  parseShareSlug,
  purgeProject,
  restoreProject,
  searchProjects,
  updateProject,
  type ProjectStats,
  type ProjectSort,
  type ProjectSummary,
  type SearchMatch,
  type SearchResult,
  type SharedProjectSummary,
  type TagCount,
  type TrashedProject,
} from '../../lib/projects'
import ShareDialog from './ShareDialog'
import './Dashboard.css'

type SectionID =
  | 'overview'
  | 'projects'
  | 'drafts'
  | 'search'
  | 'shared'
  | 'trash'
  | 'join'
  | 'settings'

const sections: { id: SectionID; label: string }[] = [
  { id: 'overview', label: 'Tổng quan' },
  { id: 'projects', label: 'Dự án của tôi' },
  { id: 'drafts', label: 'Bản nháp' },
  { id: 'search', label: 'Tìm kiếm' },
  { id: 'shared', label: 'Được chia sẻ' },
  { id: 'trash', label: 'Thùng rác' },
  { id: 'join', label: 'Tham gia dự án' },
  { id: 'settings', label: 'Cài đặt' },
]

const API_MESSAGE = 'Không tải được dữ liệu. Kiểm tra kết nối rồi thử lại.'
const PAGE_SIZE = 10

const SORT_OPTIONS: { value: ProjectSort; label: string }[] = [
  { value: 'updated', label: 'Mới cập nhật' },
  { value: 'created', label: 'Mới tạo' },
  { value: 'title', label: 'Tên A–Z' },
]

function SortSelect({
  value,
  onChange,
}: {
  value: ProjectSort
  onChange: (value: ProjectSort) => void
}) {
  return (
    <label className="dash-sort">
      <span className="sr-only">Sắp xếp danh sách</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as ProjectSort)}
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function Pagination({
  offset,
  total,
  onChange,
}: {
  offset: number
  total: number
  onChange: (offset: number) => void
}) {
  if (total <= PAGE_SIZE) return null
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const page = Math.floor(offset / PAGE_SIZE) + 1
  const from = offset + 1
  const to = Math.min(total, offset + PAGE_SIZE)

  return (
    <div className="dash-pagination">
      <span className="dash-pagination__range">
        {from}–{to} / {total}
      </span>
      <div className="dash-pagination__controls">
        <button
          className="dash-mini"
          type="button"
          disabled={offset <= 0}
          onClick={() => onChange(Math.max(0, offset - PAGE_SIZE))}
        >
          Trước
        </button>
        <span className="dash-pagination__page">
          Trang {page} / {pages}
        </span>
        <button
          className="dash-mini"
          type="button"
          disabled={offset + PAGE_SIZE >= total}
          onClick={() => onChange(offset + PAGE_SIZE)}
        >
          Sau
        </button>
      </div>
    </div>
  )
}

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
          {active === 'search' && <SearchSection />}
          {active === 'shared' && <SharedList revision={revision} />}
          {active === 'trash' && <TrashSection revision={revision} onChanged={refresh} />}
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
          <NewProjectButton className="dash-cta">Tạo mindmap mới</NewProjectButton>
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
        <article className="dash-stat">
          <span className="dash-stat-label">Trong thùng rác</span>
          <strong>{stats ? stats.trashed : '—'}</strong>
          <span className="dash-stat-note">
            <button className="dash-panel-link" type="button" onClick={() => onOpen('trash')}>
              Mở thùng rác
            </button>{' '}
            · tự xoá sau 30 ngày
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
  const [sort, setSort] = useState<ProjectSort>('updated')
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [sharing, setSharing] = useState<ProjectSummary | null>(null)
  const [tags, setTags] = useState<TagCount[]>([])
  const [activeTag, setActiveTag] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listTags()
      .then((data) => {
        if (!cancelled) setTags(data.items)
      })
      .catch(() => {
        // A tag summary is a convenience; the list itself still works.
      })
    return () => {
      cancelled = true
    }
  }, [revision, reload])

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      setLoading(true)
      listProjects({ draft, q: query, tag: activeTag ?? undefined, sort, limit: PAGE_SIZE, offset })
        .then((data) => {
          if (cancelled) return
          // A delete on the last page can leave the offset past the end.
          if (offset >= data.total && data.total > 0) {
            setOffset(Math.max(0, Math.floor((data.total - 1) / PAGE_SIZE) * PAGE_SIZE))
            return
          }
          setItems(data.items)
          setTotal(data.total)
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
  }, [draft, query, activeTag, sort, offset, revision, reload])

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
            {loading ? 'Đang tải…' : `${total} mục`}
          </span>
        </header>

        <div className="dash-toolbar">
          <input
            className="dash-search"
            type="search"
            value={query}
            placeholder="Tìm theo tên hoặc mã video"
            aria-label="Tìm dự án"
            onChange={(event) => {
              setQuery(event.target.value)
              setOffset(0)
            }}
          />
          <SortSelect
            value={sort}
            onChange={(value) => {
              setSort(value)
              setOffset(0)
            }}
          />
          <NewProjectButton className="dash-cta dash-cta--ghost">
            {draft ? 'Tạo bản nháp mới' : 'Tạo dự án mới'}
          </NewProjectButton>
        </div>

        {tags.length > 0 && (
          <div className="dash-tag-filter" role="group" aria-label="Lọc theo thẻ">
            <button
              type="button"
              className={`dash-tag-chip${activeTag === null ? ' is-active' : ''}`}
              aria-pressed={activeTag === null}
              onClick={() => {
                setActiveTag(null)
                setOffset(0)
              }}
            >
              Tất cả
            </button>
            {tags.map((item) => (
              <button
                key={item.tag}
                type="button"
                className={`dash-tag-chip${activeTag === item.tag ? ' is-active' : ''}`}
                aria-pressed={activeTag === item.tag}
                onClick={() => {
                  setActiveTag(activeTag === item.tag ? null : item.tag)
                  setOffset(0)
                }}
              >
                {item.tag}
                <span className="dash-tag-chip__count">{item.count}</span>
              </button>
            ))}
          </div>
        )}

        {error && <p className="dash-error" role="alert">{error}</p>}

        {loading ? (
          <SkeletonList rows={3} label="Đang tải danh sách dự án…" />
        ) : !error && total === 0 ? (
          <p className="dash-empty-inline">
            {query || activeTag
              ? 'Không tìm thấy dự án nào khớp bộ lọc.'
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

        <Pagination offset={offset} total={total} onChange={setOffset} />
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
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(project.title)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tagging, setTagging] = useState(false)
  const [tags, setTags] = useState<string[]>(project.tags ?? [])
  const [syncedTags, setSyncedTags] = useState(project.tags)
  const [tagDraft, setTagDraft] = useState('')
  const [tagError, setTagError] = useState('')

  // Adopt tags the server sent (normalised, or changed in another tab) without
  // an effect: React re-renders immediately with the new list.
  if (project.tags !== syncedTags) {
    setSyncedTags(project.tags)
    setTags(project.tags ?? [])
  }

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

  const saveTags = async (next: string[]) => {
    setTagError('')
    const previous = tags
    setTags(next)
    try {
      await updateProject(project.id, { tags: next })
      onChanged()
    } catch {
      setTags(previous)
      setTagError('Không lưu được thẻ')
    }
  }

  const addTag = () => {
    const value = tagDraft.trim()
    if (!value) return
    if (tags.length >= 8) {
      setTagError('Mỗi dự án tối đa 8 thẻ.')
      return
    }
    if (tags.includes(value)) {
      setTagDraft('')
      return
    }
    setTagDraft('')
    void saveTags([...tags, value])
  }

  const removeTag = (tag: string) => {
    void saveTags(tags.filter((value) => value !== tag))
  }

  const removeProject = async () => {
    if (!(await run(() => deleteProject(project.id)))) return
    setConfirming(false)
    toast.undo(`Đã chuyển “${project.title}” vào thùng rác`, async () => {
      try {
        await restoreProject(project.id)
        onChanged()
        toast.show({ message: `Đã khôi phục “${project.title}”`, tone: 'success' })
      } catch {
        toast.show({ message: 'Không khôi phục được dự án', tone: 'error' })
      }
    })
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

        {tags.length > 0 && (
          <ul className="dash-item__tags" aria-label="Thẻ của dự án">
            {tags.map((tag) => (
              <li key={tag} className="dash-item__tag">{tag}</li>
            ))}
          </ul>
        )}

        {tagging && (
          <div className="dash-tag-editor">
            <form
              className="dash-tag-editor__add"
              onSubmit={(event) => {
                event.preventDefault()
                addTag()
              }}
            >
              <label className="sr-only" htmlFor={`tag-${project.id}`}>
                Thêm thẻ
              </label>
              <input
                id={`tag-${project.id}`}
                value={tagDraft}
                maxLength={32}
                placeholder="Thêm thẻ, ví dụ: giải tích"
                onChange={(event) => {
                  setTagDraft(event.target.value)
                  if (tagError) setTagError('')
                }}
              />
              <button className="dash-mini" type="submit" disabled={!tagDraft.trim()}>
                Thêm
              </button>
            </form>
            {tags.length > 0 && (
              <ul className="dash-tag-editor__list">
                {tags.map((tag) => (
                  <li key={tag}>
                    <button
                      type="button"
                      className="dash-tag-chip dash-tag-chip--removable"
                      aria-label={`Bỏ thẻ ${tag}`}
                      onClick={() => void removeTag(tag)}
                    >
                      {tag}
                      <span aria-hidden="true">×</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="dash-tag-editor__hint">
              Thẻ được chuẩn hoá (không dấu, chữ thường) để lọc dễ hơn.
            </p>
            {tagError && <p className="dash-item__error" role="alert">{tagError}</p>}
          </div>
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
              onClick={() => void removeProject()}
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
            <button
              className="dash-mini"
              type="button"
              aria-expanded={tagging}
              onClick={() => setTagging((value) => !value)}
            >
              Thẻ
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
/* Search                                                            */
/* ---------------------------------------------------------------- */

const MATCH_LABEL: Record<SearchMatch['kind'], string> = {
  title: 'Tên dự án',
  node: 'Nhánh',
  note: 'Ghi chú',
  summary: 'Tóm tắt',
  transcript: 'Phụ đề',
}

function SearchSection() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const trimmed = query.trim()
  // A one-character query is not sent to the API; hide stale results instead of
  // clearing state inside the effect.
  const active = trimmed.length >= 2
  const shown = active ? results : []
  const busy = active && loading

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const timer = setTimeout(() => {
      setLoading(true)
      searchProjects(trimmed)
        .then((data) => {
          if (cancelled) return
          setResults(data.items)
          setError('')
        })
        .catch(() => {
          if (!cancelled) setError(API_MESSAGE)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [active, trimmed])

  return (
    <section className="dash-panel">
      <header className="dash-panel-header">
        <h2>Tìm trong nội dung</h2>
        <span className="dash-panel-note">
          {busy ? 'Đang tìm…' : active ? `${shown.length} dự án` : 'Toàn bộ dự án'}
        </span>
      </header>

      <div className="dash-toolbar">
        <input
          className="dash-search"
          type="search"
          value={query}
          autoFocus
          placeholder="Tìm trong nhãn, ghi chú, phụ đề, tóm tắt…"
          aria-label="Tìm trong nội dung dự án"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <p className="dash-search-hint">
        Không cần gõ dấu: “dao ham” vẫn tìm thấy “đạo hàm”. Kết quả hiện kèm đoạn khớp để
        bạn mở đúng chỗ.
      </p>

      {error && <p className="dash-error" role="alert">{error}</p>}

      {!active ? (
        <p className="dash-empty-inline">Gõ ít nhất 2 ký tự để bắt đầu tìm.</p>
      ) : busy ? (
        <SkeletonList rows={2} label="Đang tìm…" />
      ) : shown.length === 0 ? (
        <p className="dash-empty-inline">Không tìm thấy nội dung nào khớp “{trimmed}”.</p>
      ) : (
        <ul className="dash-list">
          {shown.map((project) => (
            <li key={project.id} className="dash-item">
              <div className="dash-item__main">
                <Link className="dash-item__link" to={`/app/${project.id}`}>
                  <span className="dash-item__title">{project.title}</span>
                  <span className="dash-item__meta">
                    {project.match_count} đoạn khớp · cập nhật {formatWhen(project.updated_at)}
                  </span>
                </Link>
                <ul className="dash-match-list">
                  {project.matches.map((match, index) => (
                    <li key={`${match.kind}-${index}`} className="dash-match">
                      <span className="dash-match__kind">{MATCH_LABEL[match.kind]}</span>
                      {match.time !== null && (
                        <span className="dash-match__time">{formatClock(match.time)}</span>
                      )}
                      <span className="dash-match__text">{match.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="dash-item__actions">
                <Link className="dash-mini dash-mini--link" to={`/app/${project.id}`}>
                  Mở
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/* ---------------------------------------------------------------- */
/* Trash                                                             */
/* ---------------------------------------------------------------- */

function TrashSection({
  revision,
  onChanged,
}: {
  revision: number
  onChanged: () => void
}) {
  const toast = useToast()
  const [items, setItems] = useState<TrashedProject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  // Initial state is already "loading"; a manual refresh sets it before bumping
  // the tick, so the effect itself never calls setState synchronously.
  const reload = useCallback(() => {
    setLoading(true)
    setReloadTick((value) => value + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    listTrash()
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
    return () => {
      cancelled = true
    }
  }, [revision, reloadTick])

  const restore = async (project: TrashedProject) => {
    setBusyId(project.id)
    try {
      await restoreProject(project.id)
      toast.show({ message: `Đã khôi phục “${project.title}”`, tone: 'success' })
      reload()
      onChanged()
    } catch {
      toast.show({ message: 'Không khôi phục được dự án', tone: 'error' })
    } finally {
      setBusyId(null)
    }
  }

  const purge = async (project: TrashedProject) => {
    setBusyId(project.id)
    try {
      await purgeProject(project.id)
      toast.show({ message: `Đã xoá vĩnh viễn “${project.title}”`, tone: 'success' })
      setConfirmingId(null)
      reload()
      onChanged()
    } catch {
      toast.show({ message: 'Không xoá được dự án', tone: 'error' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="dash-panel">
      <header className="dash-panel-header">
        <h2>Thùng rác</h2>
        <span className="dash-panel-note">
          {loading ? 'Đang tải…' : `${items.length} mục · giữ 30 ngày`}
        </span>
      </header>

      <p className="dash-empty-inline">
        Dự án đã xoá nằm đây 30 ngày rồi tự xoá vĩnh viễn. Link chia sẻ của dự án trong
        thùng rác cũng ngừng hoạt động cho tới khi bạn khôi phục.
      </p>

      {error && <p className="dash-error" role="alert">{error}</p>}

      {loading ? (
        <SkeletonList rows={2} label="Đang tải thùng rác…" />
      ) : items.length === 0 ? (
        <p className="dash-empty-inline">Thùng rác đang trống.</p>
      ) : (
        <ul className="dash-list">
          {items.map((project) => (
            <li key={project.id} className="dash-item">
              <div className="dash-item__main">
                <span className="dash-item__title">{project.title}</span>
                <span className="dash-item__meta">
                  {project.node_count} nhánh · xoá {formatWhen(project.deleted_at)}
                  {project.days_left > 0
                    ? ` · còn ${project.days_left} ngày`
                    : ' · sắp bị xoá vĩnh viễn'}
                </span>
              </div>
              <div className="dash-item__actions">
                {confirmingId === project.id ? (
                  <>
                    <span className="dash-item__confirm">Xoá vĩnh viễn?</span>
                    <button
                      className="dash-mini dash-mini--danger"
                      type="button"
                      disabled={busyId === project.id}
                      onClick={() => void purge(project)}
                    >
                      Xoá vĩnh viễn
                    </button>
                    <button
                      className="dash-mini"
                      type="button"
                      onClick={() => setConfirmingId(null)}
                    >
                      Huỷ
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="dash-mini"
                      type="button"
                      disabled={busyId === project.id}
                      onClick={() => void restore(project)}
                    >
                      Khôi phục
                    </button>
                    <button
                      className="dash-mini dash-mini--danger"
                      type="button"
                      onClick={() => setConfirmingId(project.id)}
                    >
                      Xoá vĩnh viễn
                    </button>
                  </>
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
/* Shared with me                                                    */
/* ---------------------------------------------------------------- */

const ROLE_TEXT: Record<string, string> = {
  viewer: 'Chỉ xem',
  editor: 'Có thể chỉnh sửa',
}

function SharedList({ revision }: { revision: number }) {
  const [items, setItems] = useState<SharedProjectSummary[]>([])
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ProjectSort>('updated')
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      setLoading(true)
      listSharedProjects({ q: query, sort, limit: PAGE_SIZE, offset })
        .then((data) => {
          if (cancelled) return
          if (offset >= data.total && data.total > 0) {
            setOffset(Math.max(0, Math.floor((data.total - 1) / PAGE_SIZE) * PAGE_SIZE))
            return
          }
          setItems(data.items)
          setTotal(data.total)
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
  }, [query, sort, offset, revision])

  return (
    <section className="dash-panel">
      <header className="dash-panel-header">
        <h2>Được chia sẻ với tôi</h2>
        <span className="dash-panel-note">
          {loading ? 'Đang tải…' : `${total} mục`}
        </span>
      </header>

      <div className="dash-toolbar">
        <input
          className="dash-search"
          type="search"
          value={query}
          placeholder="Tìm theo tên hoặc mã video"
          aria-label="Tìm dự án được chia sẻ"
          onChange={(event) => {
            setQuery(event.target.value)
            setOffset(0)
          }}
        />
        <SortSelect
          value={sort}
          onChange={(value) => {
            setSort(value)
            setOffset(0)
          }}
        />
      </div>

      {error && <p className="dash-error" role="alert">{error}</p>}

      {!loading && !error && total === 0 ? (
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

      <Pagination offset={offset} total={total} onChange={setOffset} />
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
