import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import type { AuthMascotMood } from './AuthMascot'
import { authErrorMessage, oauthErrorMessage } from './messages'
import OAuthButtons from './OAuthButtons'
import PasswordInput from './PasswordInput'

interface LocationState {
  from?: string
}

interface LoginFormProps {
  active: boolean
  onMoodChange: (mood: AuthMascotMood) => void
  onCaretChange: (value: string, caret: number | null) => void
  onFocusTarget: (element: HTMLElement | null) => void
}

export function LoginForm({ active, onMoodChange, onCaretChange, onFocusTarget }: LoginFormProps) {
  const { status, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as LocationState | null)?.from || '/dashboard'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [successful, setSuccessful] = useState(false)

  // OAuth failures come back as /login?oauth=google&error=...
  const params = new URLSearchParams(location.search)
  const oauthMessage = oauthErrorMessage(params.get('error'), params.get('oauth'))
  const shownError = error || oauthMessage

  useEffect(() => {
    if (active && status === 'authenticated' && !successful) navigate(from, { replace: true })
  }, [active, status, successful, from, navigate])

  if (active && status === 'authenticated' && !successful) return <Navigate to={from} replace />

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    onMoodChange('idle')
    setPending(true)
    try {
      await login(email.trim(), password)
      setSuccessful(true)
      onMoodChange('success')
      const feedbackDuration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650
      await new Promise((resolve) => window.setTimeout(resolve, feedbackDuration))
      navigate(from, { replace: true })
    } catch (caught) {
      setError(authErrorMessage(caught, 'login'))
      onMoodChange('error')
    } finally {
      setPending(false)
    }
  }

  return (
    <section
      className="auth-panel auth-panel--login"
      aria-hidden={!active}
      inert={!active}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
        onMoodChange('idle')
        onFocusTarget(null)
      }}
    >
      <span className="auth-eyebrow">Đăng nhập</span>
      <h2 className="auth-title">Chào mừng quay lại</h2>
      <p className="auth-subtitle">
        Đăng nhập để mở dashboard, lưu dự án và tiếp tục những sơ đồ đang làm dở.
      </p>
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {shownError && <p className="auth-error">{shownError}</p>}

        <div className="auth-field">
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onFocus={(event) => {
              onMoodChange('typing')
              onCaretChange(event.currentTarget.value, event.currentTarget.selectionStart)
              onFocusTarget(event.currentTarget)
            }}
            onSelect={(event) =>
              onCaretChange(event.currentTarget.value, event.currentTarget.selectionStart)
            }
            onChange={(event) => {
              setEmail(event.target.value)
              setError('')
              onCaretChange(event.currentTarget.value, event.currentTarget.selectionStart)
            }}
            placeholder="ban@example.com"
          />
        </div>

        <div className="auth-field">
          <label htmlFor="login-password">Mật khẩu</label>
          <PasswordInput
            id="login-password"
            autoComplete="current-password"
            required
            value={password}
            placeholder="••••••••"
            onFocusTarget={onFocusTarget}
            onChange={(value) => {
              setPassword(value)
              setError('')
            }}
            onMoodChange={onMoodChange}
          />
        </div>

        <button className="auth-submit" type="submit" disabled={pending}>
          {pending ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </button>
      </form>

      <div className="auth-divider">hoặc</div>
      <OAuthButtons />
      <div className="auth-footer">
        Chưa có tài khoản? <Link to="/register">Đăng ký miễn phí</Link>
      </div>
    </section>
  )
}

export default LoginForm
