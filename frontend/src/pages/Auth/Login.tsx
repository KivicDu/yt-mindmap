import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { authErrorMessage } from './messages'

interface LocationState {
  from?: string
}

export function LoginForm({ active }: { active: boolean }) {
  const { status, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as LocationState | null)?.from || '/dashboard'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (active && status === 'authenticated') navigate(from, { replace: true })
  }, [active, status, from, navigate])

  if (active && status === 'authenticated') return <Navigate to={from} replace />

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setPending(true)
    try {
      await login(email.trim(), password)
      navigate(from, { replace: true })
    } catch (caught) {
      setError(authErrorMessage(caught, 'login'))
    } finally {
      setPending(false)
    }
  }

  return (
    <section
      className="auth-panel auth-panel--login"
      aria-hidden={!active}
      inert={!active}
    >
      <span className="auth-eyebrow">Đăng nhập</span>
      <h2 className="auth-title">Chào mừng quay lại</h2>
      <p className="auth-subtitle">
        Đăng nhập để mở dashboard, lưu dự án và tiếp tục những sơ đồ đang làm dở.
      </p>
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {error && <p className="auth-error">{error}</p>}

        <div className="auth-field">
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="ban@example.com"
          />
        </div>

        <div className="auth-field">
          <label htmlFor="login-password">Mật khẩu</label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
          />
        </div>

        <button className="auth-submit" type="submit" disabled={pending}>
          {pending ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </button>
      </form>

      <div className="auth-divider">hoặc</div>
      <div className="auth-oauth">
        <button type="button" disabled title="Cần cấu hình Google OAuth (giai đoạn sau)">
          Tiếp tục với Google — sắp có
        </button>
        <button type="button" disabled title="Cần cấu hình GitHub OAuth (giai đoạn sau)">
          Tiếp tục với GitHub — sắp có
        </button>
      </div>
      <div className="auth-footer">
        Chưa có tài khoản? <Link to="/register">Đăng ký miễn phí</Link>
      </div>
    </section>
  )
}

export default LoginForm
