import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import type { AuthMascotMood } from './AuthMascot'
import { authErrorMessage } from './messages'
import PasswordInput from './PasswordInput'

const MIN_PASSWORD = 8

interface RegisterFormProps {
  active: boolean
  onMoodChange: (mood: AuthMascotMood) => void
  onCaretChange: (value: string, caret: number | null) => void
  onFocusTarget: (element: HTMLElement | null) => void
}

export function RegisterForm({
  active,
  onMoodChange,
  onCaretChange,
  onFocusTarget,
}: RegisterFormProps) {
  const { status, register } = useAuth()
  const navigate = useNavigate()

  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [successful, setSuccessful] = useState(false)

  if (active && status === 'authenticated' && !successful) {
    return <Navigate to="/dashboard" replace />
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    onMoodChange('idle')

    if (displayName.trim().length === 0) {
      setError('Hãy nhập tên hiển thị để mình biết gọi bạn là gì.')
      onMoodChange('error')
      return
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Mật khẩu cần ít nhất ${MIN_PASSWORD} ký tự.`)
      onMoodChange('error')
      return
    }
    if (password !== confirm) {
      setError('Hai lần nhập mật khẩu chưa khớp nhau.')
      onMoodChange('error')
      return
    }

    setPending(true)
    try {
      await register(displayName.trim(), email.trim(), password)
      setSuccessful(true)
      onMoodChange('success')
      const feedbackDuration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650
      await new Promise((resolve) => window.setTimeout(resolve, feedbackDuration))
      navigate('/dashboard', { replace: true })
    } catch (caught) {
      setError(authErrorMessage(caught, 'register'))
      onMoodChange('error')
    } finally {
      setPending(false)
    }
  }

  return (
    <section
      className="auth-panel auth-panel--register"
      aria-hidden={!active}
      inert={!active}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
        onMoodChange('idle')
        onFocusTarget(null)
      }}
    >
      <span className="auth-eyebrow">Tạo tài khoản</span>
      <h2 className="auth-title">Bắt đầu lưu lại quá trình học</h2>
      <p className="auth-subtitle">
        Tài khoản giúp bạn giữ lại sơ đồ tư duy, quay lại đúng chỗ đang học và chia sẻ với người khác.
      </p>
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {error && <p className="auth-error">{error}</p>}

        <div className="auth-field">
          <label htmlFor="register-name">Tên hiển thị</label>
          <input
            id="register-name"
            type="text"
            autoComplete="nickname"
            required
            maxLength={80}
            value={displayName}
            onFocus={(event) => {
              onMoodChange('typing')
              onCaretChange(event.currentTarget.value, event.currentTarget.selectionStart)
              onFocusTarget(event.currentTarget)
            }}
            onSelect={(event) =>
              onCaretChange(event.currentTarget.value, event.currentTarget.selectionStart)
            }
            onChange={(event) => {
              setDisplayName(event.target.value)
              setError('')
              onCaretChange(event.currentTarget.value, event.currentTarget.selectionStart)
            }}
            placeholder="Kivic"
          />
        </div>

        <div className="auth-field">
          <label htmlFor="register-email">Email</label>
          <input
            id="register-email"
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
          <label htmlFor="register-password">Mật khẩu</label>
          <PasswordInput
            id="register-password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD}
            value={password}
            placeholder="Ít nhất 8 ký tự"
            onFocusTarget={onFocusTarget}
            onChange={(value) => {
              setPassword(value)
              setError('')
            }}
            onMoodChange={onMoodChange}
          />
          <span className="auth-hint">Tối thiểu {MIN_PASSWORD} ký tự, tối đa 72 bytes.</span>
        </div>

        <div className="auth-field">
          <label htmlFor="register-confirm">Nhập lại mật khẩu</label>
          <PasswordInput
            id="register-confirm"
            autoComplete="new-password"
            required
            value={confirm}
            placeholder="••••••••"
            onFocusTarget={onFocusTarget}
            onChange={(value) => {
              setConfirm(value)
              setError('')
            }}
            onMoodChange={onMoodChange}
          />
        </div>

        <button className="auth-submit" type="submit" disabled={pending}>
          {pending ? 'Đang tạo tài khoản…' : 'Tạo tài khoản'}
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
        Đã có tài khoản? <Link to="/login">Đăng nhập</Link>
      </div>
    </section>
  )
}

export default RegisterForm
