import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { accountErrorMessage, validateNewPassword } from '../../lib/account'
import AccountShell from '../Account/AccountShell'

function ResetPassword() {
  const [params] = useSearchParams()
  const { resetPassword } = useAuth()
  const token = params.get('token')

  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState(
    token ? '' : 'Link đặt lại thiếu token. Hãy mở lại link trong email hoặc yêu cầu link mới.',
  )

  if (!token) {
    return (
      <AccountShell eyebrow="ĐẶT LẠI MẬT KHẨU" title="Link chưa đầy đủ" tone="error">
        <p className="account-text">{error}</p>
        <div className="account-actions">
          <Link className="account-cta" to="/forgot-password">
            Yêu cầu link mới
          </Link>
          <Link className="account-cta account-cta--ghost" to="/login">
            Về trang đăng nhập
          </Link>
        </div>
      </AccountShell>
    )
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return

    const problem = validateNewPassword(next, confirm)
    if (problem) {
      setError(problem)
      return
    }

    setPending(true)
    setError('')
    try {
      await resetPassword(token, next)
      setDone(true)
    } catch (caught) {
      setError(accountErrorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  if (done) {
    return (
      <AccountShell eyebrow="ĐẶT LẠI MẬT KHẨU" title="Mật khẩu đã được đặt lại" tone="ok">
        <p className="account-text">
          Đăng nhập bằng mật khẩu mới. Mọi phiên đăng nhập cũ đã bị thu hồi.
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
    <AccountShell eyebrow="ĐẶT LẠI MẬT KHẨU" title="Chọn mật khẩu mới">
      <p className="account-text">
        Mật khẩu cần ít nhất 8 ký tự. Sau khi lưu, mọi thiết bị khác sẽ đăng xuất.
      </p>

      <form className="account-form" onSubmit={(event) => void submit(event)} noValidate>
        <label className="account-field">
          <span>Mật khẩu mới</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            value={next}
            onChange={(event) => {
              setNext(event.target.value)
              setError('')
            }}
          />
        </label>
        <label className="account-field">
          <span>Nhập lại mật khẩu mới</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(event) => {
              setConfirm(event.target.value)
              setError('')
            }}
          />
        </label>

        {error && <p className="account-feedback account-feedback--error">{error}</p>}

        <div className="account-actions">
          <button className="account-cta" type="submit" disabled={pending}>
            {pending ? 'Đang lưu…' : 'Đặt lại mật khẩu'}
          </button>
          <Link className="account-cta account-cta--ghost" to="/login">
            Quay lại
          </Link>
        </div>
      </form>
    </AccountShell>
  )
}

export default ResetPassword
