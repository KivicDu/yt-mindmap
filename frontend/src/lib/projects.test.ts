import { describe, expect, it } from 'vitest'
import { formatWhen } from './projects'

describe('formatWhen', () => {
  it('describes recent edits in words', () => {
    expect(formatWhen(new Date().toISOString())).toBe('vừa xong')

    const tenMinutes = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    expect(formatWhen(tenMinutes)).toBe('10 phút trước')

    const threeDays = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    expect(formatWhen(threeDays)).toBe('3 ngày trước')
  })

  it('falls back to a date for old rows and handles missing values', () => {
    expect(formatWhen(null)).toBe('—')
    expect(formatWhen('not-a-date')).toBe('—')
    expect(formatWhen(new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString())).toMatch(
      /\d{1,2}\/\d{1,2}\/\d{4}/,
    )
  })
})
