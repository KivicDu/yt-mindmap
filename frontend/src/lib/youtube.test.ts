import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  extractVideoId,
  isCaptionOnlyProblem,
  listTranscriptLanguages,
  playerErrorMessage,
  transcriptSourceLabel,
  TranscriptLanguagesError,
  transcriptErrorMessage,
  transcriptStatusText,
} from './youtube'

afterEach(() => {
  vi.unstubAllGlobals()
})

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

  it('treats a content-policy refusal as an error, not a caption problem', () => {
    expect(isCaptionOnlyProblem('video_blocked')).toBe(false)
    expect(isCaptionOnlyProblem('content_not_lecture')).toBe(false)
    expect(isCaptionOnlyProblem('content_sensitive')).toBe(false)
    expect(transcriptStatusText('video_blocked')).toBe('Video bị chặn')
    expect(transcriptStatusText('content_sensitive')).toBe('Nội dung không phù hợp')
    expect(transcriptErrorMessage('content_not_lecture')).toContain('bài giảng')
    expect(transcriptErrorMessage('content_too_short')).toContain('quá ngắn')
    expect(transcriptErrorMessage('video_blocked')).not.toContain('.srt')
    expect(transcriptErrorMessage('content_sensitive')).not.toContain('.srt')
  })

  it('keeps the ASR failures informative but non-blocking', () => {
    for (const code of [
      'asr_sign_in_required',
      'asr_quota_exceeded',
      'asr_too_long',
      'asr_audio_blocked',
      'asr_failed',
    ]) {
      expect(isCaptionOnlyProblem(code)).toBe(true)
      expect(transcriptErrorMessage(code)).not.toContain('undefined')
    }
    expect(transcriptErrorMessage('asr_disabled')).toContain('.srt')
    expect(isCaptionOnlyProblem('asr_disabled')).toBe(false)
  })
})

describe('transcriptSourceLabel', () => {
  it('names the provenance shown on the workspace and dashboard', () => {
    expect(transcriptSourceLabel('youtube_manual')).toBe('Phụ đề của YouTube')
    expect(transcriptSourceLabel('youtube_auto')).toContain('tự động')
    expect(transcriptSourceLabel('asr')).toContain('nghe audio')
    expect(transcriptSourceLabel('upload')).toContain('tải lên')
    expect(transcriptSourceLabel(undefined)).toBeNull()
  })
})

describe('listTranscriptLanguages', () => {
  it('asks the API for the tracks of the given video', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [{ code: 'vi', name: 'Vietnamese', generated: false }],
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const items = await listTranscriptLanguages('https://youtu.be/abcdefghijk')

    expect(items).toEqual([{ code: 'vi', name: 'Vietnamese', generated: false }])
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/transcript/languages?url=')
    expect(url).toContain(encodeURIComponent('https://youtu.be/abcdefghijk'))
  })

  it('surfaces the API error code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ detail: { code: 'no_transcript', message: 'none' } }),
          { status: 422 },
        ),
      ) as unknown as typeof fetch,
    )

    const error = await listTranscriptLanguages('https://youtu.be/abcdefghijk').catch(
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(TranscriptLanguagesError)
    expect((error as TranscriptLanguagesError).code).toBe('no_transcript')
  })
})
