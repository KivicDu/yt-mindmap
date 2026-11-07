import { describe, expect, it } from 'vitest'
import { formatWhen, parseShareSlug } from './projects'

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

describe('parseShareSlug', () => {
  it('accepts a bare slug or a full share link', () => {
    expect(parseShareSlug('YTMM-8F2K9QZ1')).toBe('YTMM-8F2K9QZ1')
    expect(parseShareSlug('ytmm-8f2k9qz1')).toBe('YTMM-8F2K9QZ1')
    expect(parseShareSlug('http://localhost:5173/s/YTMM-8F2K9QZ1')).toBe('YTMM-8F2K9QZ1')
    expect(parseShareSlug('https://yt.example/s/YTMM-8F2K9QZ1?x=1')).toBe('YTMM-8F2K9QZ1')
  })

  it('rejects text without a usable share code', () => {
    expect(parseShareSlug('')).toBeNull()
    expect(parseShareSlug('YTMM-short')).toBeNull()
    expect(parseShareSlug('hello world')).toBeNull()
  })
})
