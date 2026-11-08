/**
 * Landing page for the email-verification link (`/verify-email?token=…`).
 *
 * The link may open in a browser with no session, so confirming never requires
 * auth. The token is single-use, hence the ref guard: React StrictMode mounts
 * effects twice in development and the second POST would otherwise fail.
 */

import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { accountErrorMessage } from '../../lib/account'
import AccountShell from '../Account/AccountShell'

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

  if (phase === 'loading') {
    return (
      <AccountShell eyebrow="XÁC MINH EMAIL" title="Đang xác minh…">
        <p className="account-text">Chỉ mất một giây, bạn đợi nhé.</p>
      </AccountShell>
    )
  }

  if (phase === 'success') {
    return (
      <AccountShell eyebrow="XÁC MINH EMAIL" title="Email đã được xác minh" tone="ok">
        <p className="account-text">
          <strong>{email}</strong> đã được xác minh. Lời mời chia sẻ gửi tới địa chỉ này
          giờ sẽ mở đúng vào tài khoản của bạn.
        </p>
        <div className="account-actions">
          {status === 'authenticated' ? (
            <Link className="account-cta" to="/dashboard">
              Vào dashboard
            </Link>
          ) : (
            <Link className="account-cta" to="/login">
              Đăng nhập
            </Link>
          )}
          <Link className="account-cta account-cta--ghost" to="/">
            Về trang chủ
          </Link>
        </div>
      </AccountShell>
    )
  }

  return (
    <AccountShell eyebrow="XÁC MINH EMAIL" title="Chưa xác minh được" tone="error">
      <p className="account-text">{message}</p>
      <div className="account-actions">
        {status === 'authenticated' ? (
          <Link className="account-cta" to="/dashboard">
            Tạo link mới trong Cài đặt
          </Link>
        ) : (
          <Link className="account-cta" to="/login">
            Đăng nhập
          </Link>
        )}
        <Link className="account-cta account-cta--ghost" to="/">
          Về trang chủ
        </Link>
      </div>
    </AccountShell>
  )
}

export default VerifyEmail
