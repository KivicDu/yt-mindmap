import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import {
  accountErrorMessage,
  validateEmailChange,
  validateNewPassword,
  validatePasswordChange,
} from './account'

describe('validateNewPassword', () => {
  it('accepts a matching password of at least 8 characters', () => {
    expect(validateNewPassword('brandnewpass', 'brandnewpass')).toBeNull()
  })

  it('explains what is missing', () => {
    expect(validateNewPassword('short', 'short')).toMatch(/8 ký tự/)
    expect(validateNewPassword('brandnewpass', 'otherpass')).toMatch(/chưa khớp/)
  })

  it('counts bytes, not characters, because bcrypt caps at 72', () => {
    const long = 'a'.repeat(73)
    expect(validateNewPassword(long, long)).toMatch(/72 bytes/)
    // 30 emoji are 120 bytes even though the string is short.
    const emoji = '😀'.repeat(30)
    expect(validateNewPassword(emoji, emoji)).toMatch(/72 bytes/)
  })
})

describe('validatePasswordChange', () => {
  it('accepts a valid change', () => {
    expect(validatePasswordChange('hunter2pass', 'brandnewpass', 'brandnewpass')).toBeNull()
  })

  it('requires the current password and a different new one', () => {
    expect(validatePasswordChange('', 'brandnewpass', 'brandnewpass')).toMatch(/hiện tại/)
    expect(validatePasswordChange('hunter2pass', 'hunter2pass', 'hunter2pass')).toMatch(/khác/)
  })

  it('reuses the new-password rules', () => {
    expect(validatePasswordChange('hunter2pass', 'short', 'short')).toMatch(/8 ký tự/)
    expect(validatePasswordChange('hunter2pass', 'brandnewpass', 'otherpass')).toMatch(/chưa khớp/)
  })
})

describe('validateEmailChange', () => {
  it('accepts a different, well-formed address', () => {
    expect(validateEmailChange('new@example.com', 'old@example.com')).toBeNull()
    expect(validateEmailChange('  New@Example.com ', 'old@example.com')).toBeNull()
  })

  it('rejects a blank, malformed or unchanged address', () => {
    expect(validateEmailChange('', 'old@example.com')).toMatch(/Nhập email/)
    expect(validateEmailChange('not-an-email', 'old@example.com')).toMatch(/định dạng/)
    expect(validateEmailChange('OLD@example.com', 'old@example.com')).toMatch(/khác email/)
  })
})

describe('accountErrorMessage', () => {
  it('maps the API codes to Vietnamese copy', () => {
    expect(accountErrorMessage(new ApiError(400, 'wrong_password'))).toMatch(/hiện tại/)
    expect(accountErrorMessage(new ApiError(400, 'password_not_set'))).toMatch(/Google\/GitHub/)
    expect(accountErrorMessage(new ApiError(400, 'invalid_verification_token'))).toMatch(/hết hạn/)
    expect(accountErrorMessage(new ApiError(400, 'invalid_reset_token'))).toMatch(/đặt lại/)
    expect(accountErrorMessage(new ApiError(400, 'invalid_email_change_token'))).toMatch(/xác nhận email/)
    expect(accountErrorMessage(new ApiError(409, 'email_taken'))).toMatch(/tài khoản khác/)
    expect(accountErrorMessage(new ApiError(502, 'email_delivery_failed'))).toMatch(/SMTP/)
  })

  it('falls back for network and unknown failures', () => {
    expect(accountErrorMessage(new TypeError('failed'))).toMatch(/Không kết nối được/)
    expect(accountErrorMessage(new ApiError(500, null))).toMatch(/thử lại/)
  })
})
