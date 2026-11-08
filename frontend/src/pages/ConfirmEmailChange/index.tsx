/**
 * Landing page for the "confirm your new email" link.
 *
 * Confirming revokes every session, so the page explains that the visitor has
 * to sign in again with the new address.
 */

import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { accountErrorMessage } from '../../lib/account'
import AccountShell from '../Account/AccountShell'

type Phase = 'loading' | 'success' | 'error'

function ConfirmEmailChange() {
  const [params] = useSearchParams()
  const { confirmEmailChange } = useAuth()
  const token = params.get('token')

  const [phase, setPhase] = useState<Phase>(token ? 'loading' : 'error')
  const [message, setMessage] = useState(
    token
      ? ''
      : 'Link xác nhận thiếu token. Hãy mở lại link trong email hoặc yêu cầu link mới trong Cài đặt.',
  )
  const [email, setEmail] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (!token || started.current) return
    started.current = true

    confirmEmailChange(token)
      .then((user) => {
        setEmail(user.email)
        setPhase('success')
      })
      .catch((error) => {
        setMessage(accountErrorMessage(error))
        setPhase('error')
      })
  }, [token, confirmEmailChange])

  if (phase === 'loading') {
    return (
      <AccountShell eyebrow="ĐỔI EMAIL" title="Đang xác nhận…">
        <p className="account-text">Chỉ mất một giây, bạn đợi nhé.</p>
      </AccountShell>
    )
  }

  if (phase === 'success') {
    return (
      <AccountShell eyebrow="ĐỔI EMAIL" title="Email đã được cập nhật" tone="ok">
        <p className="account-text">
          Tài khoản giờ dùng <strong>{email}</strong>. Mọi phiên đăng nhập đã bị thu hồi,
          hãy đăng nhập lại bằng địa chỉ mới.
        </p>
        <div className="account-actions">
          <Link className="account-cta" to="/login">
            Đăng nhập
          </Link>
          <Link className="account-cta account-cta--ghost" to="/">
            Về trang chủ
          </Link>
        </div>
      </AccountShell>
    )
  }

  return (
    <AccountShell eyebrow="ĐỔI EMAIL" title="Chưa xác nhận được" tone="error">
      <p className="account-text">{message}</p>
      <div className="account-actions">
        <Link className="account-cta" to="/login">
          Đăng nhập
        </Link>
        <Link className="account-cta account-cta--ghost" to="/">
          Về trang chủ
        </Link>
      </div>
    </AccountShell>
  )
}

export default ConfirmEmailChange
