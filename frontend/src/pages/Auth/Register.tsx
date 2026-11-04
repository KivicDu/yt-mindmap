import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { authErrorMessage } from './messages'

const MIN_PASSWORD = 8

export function RegisterForm({ active }: { active: boolean }) {
  const { status, register } = useAuth()
  const navigate = useNavigate()

  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  if (active && status === 'authenticated') return <Navigate to="/dashboard" replace />

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')

    if (displayName.trim().length === 0) {
      setError('Hãy nhập tên hiển thị để mình biết gọi bạn là gì.')
      return
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Mật khẩu cần ít nhất ${MIN_PASSWORD} ký tự.`)
      return
    }
    if (password !== confirm) {
      setError('Hai lần nhập mật khẩu chưa khớp nhau.')
      return
    }

    setPending(true)
    try {
      await register(displayName.trim(), email.trim(), password)
      navigate('/dashboard', { replace: true })
    } catch (caught) {
      setError(authErrorMessage(caught, 'register'))
    } finally {
      setPending(false)
    }
  }

  return (
    <section
      className="auth-panel auth-panel--register"
      aria-hidden={!active}
      inert={!active}
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
            onChange={(event) => setDisplayName(event.target.value)}
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
            onChange={(event) => setEmail(event.target.value)}
            placeholder="ban@example.com"
          />
        </div>

        <div className="auth-field">
          <label htmlFor="register-password">Mật khẩu</label>
          <input
            id="register-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Ít nhất 8 ký tự"
          />
          <span className="auth-hint">Tối thiểu {MIN_PASSWORD} ký tự, tối đa 72 bytes.</span>
        </div>

        <div className="auth-field">
          <label htmlFor="register-confirm">Nhập lại mật khẩu</label>
          <input
            id="register-confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder="••••••••"
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
