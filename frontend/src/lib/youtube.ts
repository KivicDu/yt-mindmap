const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'youtu.be',
])
const VIDEO_PATH_PREFIXES = new Set(['shorts', 'embed', 'live', 'v', 'e'])

/**
 * Pull the 11-character id out of any common YouTube link, or accept a bare id.
 * Mirrors `backend/transcript.py` so the client and the server agree on what a
 * valid link is; anything else returns null and the caller shows a hint.
 */
export function extractVideoId(input: string): string | null {
  const value = input.trim()
  if (!value) return null
  if (VIDEO_ID.test(value)) return value

  let parsed: URL
  try {
    parsed = new URL(HAS_SCHEME.test(value) ? value : `https://${value}`)
  } catch {
    return null
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  if (!YOUTUBE_HOSTS.has(host)) return null

  if (host === 'youtu.be') {
    const segment = parsed.pathname.split('/').filter(Boolean)[0]
    return segment && VIDEO_ID.test(segment) ? segment : null
  }

  const fromQuery = parsed.searchParams.get('v')
  if (fromQuery && VIDEO_ID.test(fromQuery)) return fromQuery

  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length >= 2 && VIDEO_PATH_PREFIXES.has(segments[0].toLowerCase())) {
    const segment = segments[1]
    return VIDEO_ID.test(segment) ? segment : null
  }

  return null
}

/** Codes returned by `POST /transcript` in `detail.code`. */
export type TranscriptErrorCode =
  | 'invalid_url'
  | 'invalid_video_id'
  | 'transcripts_disabled'
  | 'no_transcript'
  | 'empty_transcript'
  | 'video_unavailable'
  | 'video_unplayable'
  | 'age_restricted'
  | 'ip_blocked'
  | 'request_blocked'
  | 'po_token_required'
  | 'youtube_unreachable'
  | 'youtube_unparsable'
  | 'youtube_error'
  | 'network_error'
  | 'invalid_subtitle_file'
  | 'missing_input'
  | 'session_error'
  | string

/**
 * Caption problems that do not prevent watching: the player stays on screen and
 * the hint only explains why the mind map is empty.
 */
export function isCaptionOnlyProblem(code: string | undefined): boolean {
  return [
    'transcripts_disabled',
    'no_transcript',
    'empty_transcript',
  ].includes(String(code))
}

export function transcriptErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'invalid_url':
    case 'invalid_video_id':
      return 'Link YouTube không hợp lệ. Dán link dạng https://www.youtube.com/watch?v=…, https://youtu.be/… hoặc /shorts/…'
    case 'transcripts_disabled':
      return 'Chủ video đã tắt phụ đề nên chưa tạo được sơ đồ. Bạn vẫn xem được video bên dưới, hoặc tải file .srt/.vtt.'
    case 'no_transcript':
      return 'Video không có phụ đề phù hợp để tạo sơ đồ. Bạn vẫn xem được video bên dưới, hoặc tải file .srt/.vtt.'
    case 'empty_transcript':
      return 'Phụ đề của video bị trống nên chưa tạo được sơ đồ. Bạn vẫn xem được video bên dưới.'
    case 'video_unavailable':
      return 'Video không tồn tại, đã bị xoá hoặc đang để riêng tư nên không mở được.'
    case 'video_unplayable':
      return 'YouTube không cho phát video này (giới hạn độ tuổi hoặc khu vực). Hãy mở trực tiếp trên YouTube.'
    case 'age_restricted':
      return 'Video giới hạn độ tuổi nên máy chủ không đọc được phụ đề. Bạn có thể tải file .srt/.vtt.'
    case 'ip_blocked':
    case 'request_blocked':
    case 'po_token_required':
      return 'YouTube đang tạm chặn máy chủ này. Thử lại sau ít phút, hoặc tải file .srt/.vtt bên dưới.'
    case 'youtube_unreachable':
    case 'youtube_unparsable':
    case 'youtube_error':
    case 'network_error':
      return 'Không kết nối được tới YouTube. Kiểm tra mạng rồi thử lại, hoặc tải file .srt/.vtt.'
    case 'invalid_subtitle_file':
      return 'File phụ đề không đọc được. Kiểm tra lại định dạng .srt hoặc .vtt.'
    case 'rate_limited':
      return 'Bạn thao tác quá nhanh. Chờ một chút rồi thử lại nhé.'
    case 'ai_quota_exceeded':
      return 'Đã hết hạn mức AI hôm nay. Đăng nhập hoặc thử lại vào ngày mai.'
    default:
      return 'Không tải được phụ đề cho link này. Thử tải file .srt/.vtt bên dưới.'
  }
}

export function transcriptStatusText(code: string | undefined): string {
  if (isCaptionOnlyProblem(code)) return 'Video không có phụ đề'
  switch (code) {
    case 'invalid_url':
    case 'invalid_video_id':
      return 'Link YouTube không hợp lệ'
    case 'video_unavailable':
    case 'video_unplayable':
      return 'Video không khả dụng'
    case 'age_restricted':
      return 'Video giới hạn độ tuổi'
    case 'ip_blocked':
    case 'request_blocked':
    case 'po_token_required':
      return 'YouTube đang chặn máy chủ'
    case 'youtube_unreachable':
    case 'youtube_unparsable':
    case 'youtube_error':
    case 'network_error':
      return 'Không kết nối được YouTube'
    case 'rate_limited':
      return 'Thao tác quá nhanh'
    case 'ai_quota_exceeded':
      return 'Hết hạn mức AI hôm nay'
    default:
      return 'Không tải được phụ đề'
  }
}

export interface PlayerErrorInfo {
  title: string
  message: string
}

/** YouTube iframe error codes: 2, 5, 100, 101, 150 and 153. */
export function playerErrorMessage(code: number): PlayerErrorInfo {
  switch (code) {
    case 2:
      return {
        title: 'Link video không hợp lệ',
        message: 'YouTube không nhận ra video này. Kiểm tra lại link đã dán.',
      }
    case 5:
      return {
        title: 'Trình phát gặp lỗi',
        message: 'Trình phát HTML5 của YouTube gặp sự cố. Tải lại trang rồi thử lại.',
      }
    case 100:
      return {
        title: 'Video không còn tồn tại',
        message: 'Video đã bị xoá hoặc đang để riêng tư nên không thể phát.',
      }
    case 101:
    case 150:
      return {
        title: 'Video không cho phép nhúng',
        message:
          'Chủ video đã tắt “Allow embedding”, nên video chỉ xem được trên YouTube. Sơ đồ vẫn tạo được nếu video có phụ đề.',
      }
    case 153:
      return {
        title: 'Thiếu thông tin nguồn phát',
        message:
          'YouTube không nhận được HTTP Referer hoặc thông tin nhận diện trình phát. Kiểm tra Referrer-Policy và cách trang được nhúng; có thể mở video trực tiếp trên YouTube.',
      }
    default:
      return {
        title: 'Không phát được video',
        message:
          'YouTube từ chối phát video trong trang này (giới hạn tuổi, khu vực hoặc quyền nhúng). Mở trên YouTube để xem.',
      }
  }
}

export interface VideoInfo {
  video_id: string
  title: string | null
  author_name: string | null
  thumbnail_url: string | null
  embeddable: boolean | null
  checked: boolean
  reason: string | null
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
}
