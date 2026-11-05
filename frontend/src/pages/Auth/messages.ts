import { ApiError, errorCode } from '../../lib/api'

const PROVIDER_NAMES: Record<string, string> = {
  google: 'Google',
  github: 'GitHub',
}

/** Turn an API failure into one sentence a reader can act on. */
export function authErrorMessage(error: unknown, mode: 'login' | 'register'): string {
  const code = errorCode(error)

  if (code === 'invalid_credentials') return 'Email hoặc mật khẩu chưa đúng.'
  if (code === 'email_taken') return 'Email này đã có tài khoản — hãy đăng nhập thay vì đăng ký lại.'
  if (code === 'missing_refresh_token' || code === 'invalid_refresh_token')
    return 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.'

  if (error instanceof ApiError && error.status === 422) {
    return mode === 'register'
      ? 'Thông tin chưa hợp lệ: mật khẩu cần ít nhất 8 ký tự và tên hiển thị không được để trống.'
      : 'Email hoặc mật khẩu chưa hợp lệ.'
  }

  if (error instanceof TypeError) {
    return 'Không kết nối được máy chủ. Kiểm tra backend đang chạy ở cổng 8001 nhé.'
  }

  return mode === 'register' ? 'Đăng ký chưa thành công, thử lại giúp mình.' : 'Đăng nhập chưa thành công, thử lại giúp mình.'
}

/**
 * Explain why the OAuth redirect came back to /login with `?error=...`.
 * The API never shows a raw provider error, only these short codes.
 */
export function oauthErrorMessage(error: string | null, provider: string | null): string {
  if (!error) return ''
  const name = PROVIDER_NAMES[provider ?? ''] ?? 'nhà cung cấp'

  switch (error) {
    case 'oauth_not_configured':
      return `Đăng nhập bằng ${name} chưa được cấu hình trên máy chủ này.`
    case 'oauth_denied':
      return `Bạn đã huỷ đăng nhập bằng ${name}. Có thể thử lại bất cứ lúc nào.`
    case 'oauth_state_mismatch':
      return 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Thử lại giúp mình nhé.'
    case 'oauth_callback_missing_code':
      return `Đăng nhập bằng ${name} không hoàn tất được. Thử lại nhé.`
    case 'email_unavailable':
      return `${name} không trả về email đã xác minh nên chưa thể tạo tài khoản. Hãy đăng ký bằng email thay thế.`
    case 'email_unverified':
      return `Email từ ${name} chưa được xác minh nên chưa thể dùng để đăng nhập.`
    default:
      return `Đăng nhập bằng ${name} chưa thành công. Thử lại giúp mình nhé.`
  }
}
