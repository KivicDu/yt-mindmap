import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import AuthMascot, { type AuthMascotMood } from './AuthMascot'
import './Auth.css'

interface FocusTarget {
  x: number
  y: number
}

interface AuthShellProps {
  mode: 'login' | 'register'
  mascotMood: AuthMascotMood
  caretPosition: number
  focusTarget: FocusTarget | null
  children: ReactNode
}

function AuthShell({ mode, mascotMood, caretPosition, focusTarget, children }: AuthShellProps) {
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
        <div className="auth-aside">
          <AuthMascot
            mood={mascotMood}
            caretPosition={caretPosition}
            focusTarget={focusTarget}
          />
        </div>

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
