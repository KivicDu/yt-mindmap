import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatDuration, searchYouTube, watchUrl } from './youtubeSearch'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('formatDuration', () => {
  it('uses m:ss for short lectures and h:mm:ss for long ones', () => {
    expect(formatDuration(750)).toBe('12:30')
    expect(formatDuration(3723)).toBe('1:02:03')
  })

  it('stays empty when the API did not return a duration', () => {
    expect(formatDuration(null)).toBe('')
    expect(formatDuration(undefined)).toBe('')
    expect(formatDuration(0)).toBe('')
  })
})

describe('searchYouTube', () => {
  it('sends the query and decodes the study-field and fit badges', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              video_id: 'abc12345678',
              url: watchUrl('abc12345678'),
              title: 'Đạo hàm là gì',
              channel: 'Toán học Việt',
              thumbnail: null,
              duration_seconds: 750,
              topic_code: 'toan-hoc',
              topic_label: 'Toán học',
              fit: 'likely',
              fit_label: 'Có vẻ là bài giảng',
              fit_reason: null,
            },
          ],
          next_page_token: 'next',
          unavailable: false,
          message: null,
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const result = await searchYouTube('toán học', undefined)

    expect(fetchMock.mock.calls[0]?.[0]).toContain('/youtube/search?q=to%C3%A1n+h%E1%BB%8Dc')
    expect(result.items[0]?.topic_label).toBe('Toán học')
    expect(result.items[0]?.fit).toBe('likely')
    expect(result.next_page_token).toBe('next')
  })

  it('passes an AbortSignal through to the shared api client', async () => {
    const controller = new AbortController()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ items: [], next_page_token: null, unavailable: false, message: null }),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    await searchYouTube('react', 'page-2', controller.signal)

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.signal).toBe(controller.signal)
    expect(fetchMock.mock.calls[0]?.[0]).toContain('page_token=page-2')
  })
})
