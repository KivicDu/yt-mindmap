import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import './Auth.css'

interface AuthShellProps {
  mode: 'login' | 'register'
  children: ReactNode
}

function AuthShell({ mode, children }: AuthShellProps) {
  const isRegister = mode === 'register'

  return (
    <main className="auth">
      <header className="auth-topbar">
        <Link className="auth-brand" to="/">
          <img src="/yt-mindmap-icon.png" alt="" aria-hidden="true" />
          <span>yt-mindmap</span>
        </Link>
        <Link className="auth-back" to="/">← Về trang chủ</Link>
      </header>

      <section className="auth-card">
        <aside className={`auth-aside ${isRegister ? 'auth-aside--register' : ''}`}>
          <div className="auth-aside-inner">
            <span className="auth-aside-kicker">HỌC CÙNG YT-MINDMAP</span>
            <div className="auth-aside-mark">
              <img src="/yt-mindmap-icon.png" alt="" aria-hidden="true" />
            </div>
            <h1>{isRegister ? 'Mỗi bài học, một bước tiến.' : 'Tiếp tục mạch học của bạn.'}</h1>
            <p>
              {isRegister
                ? 'Tạo tài khoản để lưu sơ đồ, ghi chú và quay lại bài giảng bất cứ lúc nào.'
                : 'Đăng nhập để mở lại các sơ đồ, ghi chú và bài giảng bạn đang ôn tập.'}
            </p>
            <div className="auth-aside-switch">
              <span>{isRegister ? 'Đã có tài khoản?' : 'Bạn mới đến đây?'}</span>
              <Link to={isRegister ? '/login' : '/register'}>
                {isRegister ? 'Đăng nhập' : 'Tạo tài khoản'}
                <span aria-hidden="true"> →</span>
              </Link>
            </div>
          </div>
          <span className="auth-aside-index" aria-hidden="true">
            {isRegister ? '02' : '01'} <i /> 02
          </span>
        </aside>

        <div className="auth-form-window">
          <div className={`auth-form-track ${isRegister ? 'auth-form-track--register' : ''}`}>
            {children}
          </div>
        </div>
      </section>

      <footer className="auth-note">
        <span>yt-mindmap</span>
        <span>Biến bài giảng thành nội dung dễ ôn tập.</span>
      </footer>
    </main>
  )
}

export default AuthShell
