/**
 * Landing page for the email-verification link (`/verify-email?token=…`).
 *
 * The link may open in a browser with no session, so confirming never requires
 * auth. The token is single-use, hence the ref guard: React StrictMode mounts
 * effects twice in development and the second POST would otherwise fail.
 */

import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import ThemeToggle from '../../components/ThemeToggle'
import { useAuth } from '../../context/AuthContext'
import { accountErrorMessage } from '../../lib/account'
import './VerifyEmail.css'

type Phase = 'loading' | 'success' | 'error'

function VerifyEmail() {
  const [params] = useSearchParams()
  const { status, verifyEmail } = useAuth()
  const token = params.get('token')

  const [phase, setPhase] = useState<Phase>(token ? 'loading' : 'error')
  const [message, setMessage] = useState(
    token ? '' : 'Link xác minh thiếu token. Hãy mở lại link trong email hoặc tạo link mới trong Cài đặt.',
  )
  const [email, setEmail] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (!token || started.current) return
    started.current = true

    verifyEmail(token)
      .then((user) => {
        setEmail(user.email)
        setPhase('success')
      })
      .catch((error) => {
        setMessage(accountErrorMessage(error))
        setPhase('error')
      })
  }, [token, verifyEmail])

  return (
    <div className="verify-shell">
      <div className="verify-topbar">
        <Link className="verify-brand" to="/">yt-mindmap</Link>
        <ThemeToggle />
      </div>

      <main className={`verify-card${phase === 'success' ? ' verify-card--ok' : ''}`}>
        {phase === 'loading' && (
          <>
            <span className="verify-eyebrow">XÁC MINH EMAIL</span>
            <h1>Đang xác minh…</h1>
            <p className="verify-text">Chỉ mất một giây, bạn đợi nhé.</p>
          </>
        )}

        {phase === 'success' && (
          <>
            <span className="verify-eyebrow">XÁC MINH EMAIL</span>
            <h1>Email đã được xác minh</h1>
            <p className="verify-text">
              <strong>{email}</strong> đã được xác minh. Lời mời chia sẻ gửi tới địa chỉ
              này giờ sẽ mở đúng vào tài khoản của bạn.
            </p>
            <div className="verify-actions">
              {status === 'authenticated' ? (
                <Link className="verify-cta" to="/dashboard">Vào dashboard</Link>
              ) : (
                <Link className="verify-cta" to="/login">Đăng nhập</Link>
              )}
              <Link className="verify-cta verify-cta--ghost" to="/">Về trang chủ</Link>
            </div>
          </>
        )}

        {phase === 'error' && (
          <>
            <span className="verify-eyebrow">XÁC MINH EMAIL</span>
            <h1>Chưa xác minh được</h1>
            <p className="verify-text">{message}</p>
            <div className="verify-actions">
              {status === 'authenticated' ? (
                <Link className="verify-cta" to="/dashboard">Tạo link mới trong Cài đặt</Link>
              ) : (
                <Link className="verify-cta" to="/login">Đăng nhập</Link>
              )}
              <Link className="verify-cta verify-cta--ghost" to="/">Về trang chủ</Link>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

export default VerifyEmail
