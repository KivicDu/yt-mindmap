/**
 * Account helpers shared by the dashboard settings and the verify-email page.
 *
 * Kept free of React so the validation and error copy can be unit-tested.
 */

import { ApiError, errorCode } from './api'

export interface User {
  id: string
  email: string
  display_name: string
  provider: string
  avatar_url: string | null
  email_verified: boolean
  created_at: string
}

export interface VerificationRequestResult {
  status: 'sent' | 'already_verified'
  /** Present only when the API runs with DEBUG_EMAIL_LINKS (local dev). */
  dev_link: string | null
}

export interface EmailChangeRequestResult {
  status: 'sent' | 'unchanged'
  /** Present only when the API runs with DEBUG_EMAIL_LINKS (local dev). */
  dev_link: string | null
}

const BCRYPT_MAX_BYTES = 72
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Byte length, because bcrypt caps the password at 72 bytes, not chars. */
function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

/** Rules shared by "change password" and "reset password". */
export function validateNewPassword(next: string, confirm: string): string | null {
  if (next.length < 8) return 'Mật khẩu mới cần ít nhất 8 ký tự.'
  if (byteLength(next) > BCRYPT_MAX_BYTES) return 'Mật khẩu mới tối đa 72 bytes.'
  if (next !== confirm) return 'Mật khẩu nhập lại chưa khớp.'
  return null
}

export function validatePasswordChange(
  current: string,
  next: string,
  confirm: string,
): string | null {
  if (!current) return 'Nhập mật khẩu hiện tại.'
  if (next === current) return 'Mật khẩu mới cần khác mật khẩu hiện tại.'
  return validateNewPassword(next, confirm)
}

export function validateEmailChange(newEmail: string, currentEmail: string): string | null {
  const trimmed = newEmail.trim()
  if (!trimmed) return 'Nhập email mới.'
  if (!EMAIL_PATTERN.test(trimmed)) return 'Email mới chưa đúng định dạng.'
  if (trimmed.toLowerCase() === currentEmail.trim().toLowerCase())
    return 'Email mới cần khác email hiện tại.'
  return null
}

/** One actionable sentence for every account error the API can return. */
export function accountErrorMessage(error: unknown): string {
  const code = errorCode(error)

  switch (code) {
    case 'wrong_password':
      return 'Mật khẩu hiện tại chưa đúng.'
    case 'password_not_set':
      return 'Tài khoản này đăng nhập bằng Google/GitHub nên chưa có mật khẩu để đổi.'
    case 'display_name_required':
      return 'Tên hiển thị không được để trống.'
    case 'invalid_verification_token':
      return 'Link xác minh không hợp lệ, đã dùng rồi hoặc đã hết hạn.'
    case 'invalid_reset_token':
      return 'Link đặt lại mật khẩu không hợp lệ, đã dùng rồi hoặc đã hết hạn.'
    case 'invalid_email_change_token':
      return 'Link xác nhận email không hợp lệ, đã dùng rồi hoặc đã hết hạn.'
    case 'email_taken':
      return 'Email này đã có tài khoản khác sử dụng.'
    case 'email_mismatch':
      return 'Email xác nhận chưa khớp với tài khoản đang đăng nhập.'
    case 'rate_limited':
      return 'Bạn thao tác quá nhanh. Chờ một chút rồi thử lại nhé.'
    case 'same_email':
      return 'Email mới cần khác email hiện tại.'
    case 'email_delivery_failed':
      return 'Chưa gửi được email. Kiểm tra cấu hình SMTP rồi thử lại.'
    case 'not_authenticated':
    case 'missing_refresh_token':
    case 'invalid_refresh_token':
      return 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.'
    default:
      break
  }

  if (error instanceof ApiError && error.status === 422) {
    return 'Thông tin chưa hợp lệ. Kiểm tra lại tên hiển thị, email hoặc mật khẩu.'
  }
  if (error instanceof TypeError) {
    return 'Không kết nối được máy chủ. Kiểm tra backend đang chạy ở cổng 8001 nhé.'
  }
  return 'Chưa lưu được thay đổi, thử lại giúp mình.'
}
