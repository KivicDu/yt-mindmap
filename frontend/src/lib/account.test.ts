import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { accountErrorMessage, validatePasswordChange } from './account'

describe('validatePasswordChange', () => {
  it('accepts a valid change', () => {
    expect(validatePasswordChange('hunter2pass', 'brandnewpass', 'brandnewpass')).toBeNull()
  })

  it('explains what is missing', () => {
    expect(validatePasswordChange('', 'brandnewpass', 'brandnewpass')).toMatch(/hiện tại/)
    expect(validatePasswordChange('hunter2pass', 'short', 'short')).toMatch(/8 ký tự/)
    expect(validatePasswordChange('hunter2pass', 'brandnewpass', 'otherpass')).toMatch(/chưa khớp/)
    expect(validatePasswordChange('hunter2pass', 'hunter2pass', 'hunter2pass')).toMatch(/khác/)
  })

  it('counts bytes, not characters, because bcrypt caps at 72', () => {
    const long = 'a'.repeat(73)
    expect(validatePasswordChange('hunter2pass', long, long)).toMatch(/72 bytes/)
    // 30 emoji are 120 bytes even though the string is short.
    const emoji = '😀'.repeat(30)
    expect(validatePasswordChange('hunter2pass', emoji, emoji)).toMatch(/72 bytes/)
  })
})

describe('accountErrorMessage', () => {
  it('maps the API codes to Vietnamese copy', () => {
    expect(accountErrorMessage(new ApiError(400, 'wrong_password'))).toMatch(/hiện tại/)
    expect(accountErrorMessage(new ApiError(400, 'password_not_set'))).toMatch(/Google\/GitHub/)
    expect(accountErrorMessage(new ApiError(400, 'invalid_verification_token'))).toMatch(/hết hạn/)
  })

  it('falls back for network and unknown failures', () => {
    expect(accountErrorMessage(new TypeError('failed'))).toMatch(/Không kết nối được/)
    expect(accountErrorMessage(new ApiError(500, null))).toMatch(/thử lại/)
  })
})
