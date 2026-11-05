import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import ThemeToggle from '../../components/ThemeToggle'
import { useAuth } from '../../context/AuthContext'
import './Dashboard.css'

type SectionID = 'overview' | 'projects' | 'drafts' | 'join' | 'settings'

const sections: { id: SectionID; label: string; soon?: string }[] = [
  { id: 'overview', label: 'Tổng quan' },
  { id: 'projects', label: 'Dự án của tôi', soon: 'Giai đoạn 2' },
  { id: 'drafts', label: 'Bản nháp', soon: 'Giai đoạn 2' },
  { id: 'join', label: 'Tham gia dự án', soon: 'Giai đoạn 3' },
  { id: 'settings', label: 'Cài đặt' },
]

function Dashboard() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [active, setActive] = useState<SectionID>('overview')

  const handleLogout = async () => {
    // Leave the guarded route first: clearing the session while /dashboard is
    // mounted would make ProtectedRoute redirect to /login instead.
    navigate('/', { replace: true })
    await logout()
  }

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
              {section.soon && <span className="dash-soon">{section.soon}</span>}
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
          {active === 'overview' && <Overview displayName={displayName} />}
          {active === 'projects' && (
            <EmptyState
              title="Chưa có dự án nào được lưu"
              body="Việc lưu sơ đồ vào tài khoản sẽ có ở Giai đoạn 2. Hiện tại bạn vẫn tạo và chỉnh sửa mindmap trực tiếp trong workspace."
              cta={<Link className="dash-cta" to="/app">Mở workspace</Link>}
            />
          )}
          {active === 'drafts' && (
            <EmptyState
              title="Bản nháp sẽ xuất hiện ở đây"
              body="Khi bạn rời workspace giữa chừng, sơ đồ đang làm sẽ được lưu tự động thành bản nháp — tính năng này thuộc Giai đoạn 2."
            />
          )}
          {active === 'join' && <JoinSection />}
          {active === 'settings' && <SettingsSection />}
        </div>
      </main>
    </div>
  )
}

function Overview({ displayName }: { displayName: string }) {
  return (
    <>
      <section className="dash-intro">
        <h2>Xin chào, {displayName}</h2>
        <p>
          Đây là nơi bạn quản lý các sơ đồ tư duy đã lưu. Ở giai đoạn này, tài khoản mới chỉ dùng để đăng nhập —
          phần dự án và chia sẻ sẽ được bật ở các giai đoạn tiếp theo.
        </p>
        <div className="dash-actions">
          <Link className="dash-cta" to="/app">Tạo mindmap mới</Link>
        </div>
      </section>

      <section className="dash-stats" aria-label="Thống kê">
        <article className="dash-stat">
          <span className="dash-stat-label">Dự án đã lưu</span>
          <strong>0</strong>
          <span className="dash-stat-note">Giai đoạn 2</span>
        </article>
        <article className="dash-stat">
          <span className="dash-stat-label">Bản nháp</span>
          <strong>0</strong>
          <span className="dash-stat-note">Giai đoạn 2</span>
        </article>
        <article className="dash-stat">
          <span className="dash-stat-label">Dự án được chia sẻ</span>
          <strong>0</strong>
          <span className="dash-stat-note">Giai đoạn 3</span>
        </article>
      </section>

      <section className="dash-panel">
        <header className="dash-panel-header">
          <h2>Gần đây</h2>
          <span className="dash-panel-note">Chưa có hoạt động</span>
        </header>
        <p className="dash-empty-inline">
          Những sơ đồ bạn mở gần nhất sẽ xuất hiện ở đây sau khi tính năng lưu dự án hoàn thành.
        </p>
      </section>
    </>
  )
}

function JoinSection() {
  return (
    <section className="dash-panel">
      <header className="dash-panel-header">
        <h2>Tham gia dự án được chia sẻ</h2>
        <span className="dash-panel-note">Giai đoạn 3</span>
      </header>
      <p className="dash-empty-inline">
        Nhập mã chia sẻ hoặc dán link được gửi cho bạn để xem sơ đồ của người khác. Phần này cần hệ thống chia sẻ
        ở Giai đoạn 3 nên ô nhập hiện chưa hoạt động.
      </p>
      <div className="dash-join">
        <input
          type="text"
          placeholder="Ví dụ: YTMM-8F2K"
          aria-label="Mã chia sẻ"
          disabled
        />
        <button type="button" disabled>Tham gia</button>
      </div>
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
      </dl>

      <button className="dash-cta dash-cta--ghost" type="button" onClick={() => void logout()}>
        Đăng xuất
      </button>
    </section>
  )
}

function EmptyState({ title, body, cta }: { title: string; body: string; cta?: React.ReactNode }) {
  return (
    <section className="dash-panel dash-panel--empty">
      <h2>{title}</h2>
      <p>{body}</p>
      {cta}
    </section>
  )
}

export default Dashboard
