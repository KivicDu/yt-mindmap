import { describe, expect, it } from 'vitest'
import {
  extractVideoId,
  playerErrorMessage,
  transcriptErrorMessage,
  transcriptStatusText,
} from './youtube'

describe('extractVideoId', () => {
  it.each([
    ['https://www.youtube.com/watch?v=abcdefghijk', 'abcdefghijk'],
    ['https://youtu.be/abcdefghijk?t=42', 'abcdefghijk'],
    ['youtube.com/shorts/abcdefghijk', 'abcdefghijk'],
    ['https://youtube.com/live/abcdefghijk', 'abcdefghijk'],
    ['https://www.youtube-nocookie.com/embed/abcdefghijk', 'abcdefghijk'],
    ['abcdefghijk', 'abcdefghijk'],
  ])('extracts IDs from %s', (url, expected) => {
    expect(extractVideoId(url)).toBe(expected)
  })

  it.each(['https://example.com/watch?v=abcdefghijk', 'https://youtu.be/too-short'])(
    'rejects invalid YouTube URL %s',
    (url) => {
      expect(extractVideoId(url)).toBeNull()
    },
  )
})

describe('YouTube error messages', () => {
  it('distinguishes a server-side IP block from a captionless video', () => {
    expect(transcriptStatusText('ip_blocked')).toContain('chặn máy chủ')
    expect(transcriptErrorMessage('no_transcript')).toContain('không có phụ đề')
  })

  it('explains disabled embedding and links the user back to YouTube', () => {
    expect(playerErrorMessage(150).message).toContain('tắt')
  })

  it('explains the missing referrer error', () => {
    expect(playerErrorMessage(153).message).toContain('Referer')
  })
})
