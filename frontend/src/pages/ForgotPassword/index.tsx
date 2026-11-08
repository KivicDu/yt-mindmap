import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { accountErrorMessage } from '../../lib/account'
import AccountShell from '../Account/AccountShell'

function ForgotPassword() {
  const { requestPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    const trimmed = email.trim()
    if (!trimmed) {
      setError('Nhập email của tài khoản.')
      return
    }

    setPending(true)
    setError('')
    try {
      await requestPasswordReset(trimmed)
      setSent(true)
    } catch (caught) {
      setError(accountErrorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <AccountShell
      eyebrow="KHÔI PHỤC TÀI KHOẢN"
      title={sent ? 'Kiểm tra hộp thư' : 'Quên mật khẩu?'}
      tone={sent ? 'ok' : 'default'}
    >
      {sent ? (
        <>
          <p className="account-text">
            Nếu <strong>{email.trim()}</strong> thuộc một tài khoản dùng mật khẩu, link
            đặt lại đã được gửi. Link dùng một lần và hết hạn sau 1 giờ.
          </p>
          <p className="account-text">
            Không thấy email? Kiểm tra thư mục spam, hoặc thử lại sau ít phút.
          </p>
          <div className="account-actions">
            <Link className="account-cta" to="/login">
              Về trang đăng nhập
            </Link>
          </div>
        </>
      ) : (
        <>
          <p className="account-text">
            Nhập email của tài khoản. Nếu email tồn tại, chúng mình sẽ gửi link để chọn
            mật khẩu mới.
          </p>
          <form className="account-form" onSubmit={(event) => void submit(event)} noValidate>
            <label className="account-field">
              <span>Email</span>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                  setError('')
                }}
                placeholder="ban@example.com"
              />
            </label>

            {error && <p className="account-feedback account-feedback--error">{error}</p>}

            <div className="account-actions">
              <button className="account-cta" type="submit" disabled={pending}>
                {pending ? 'Đang gửi…' : 'Gửi link đặt lại'}
              </button>
              <Link className="account-cta account-cta--ghost" to="/login">
                Quay lại
              </Link>
            </div>
          </form>
        </>
      )}
    </AccountShell>
  )
}

export default ForgotPassword
