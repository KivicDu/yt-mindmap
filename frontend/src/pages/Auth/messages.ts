import { ApiError, errorCode } from '../../lib/api'

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
