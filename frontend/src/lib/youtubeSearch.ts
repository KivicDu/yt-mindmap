/** ADR 0016: the search box's API client, kept pure so it is easy to test. */

import { apiFetch } from './api'

export type StudyFit = 'likely' | 'unknown' | 'blocked'

export interface VideoSearchResult {
  video_id: string
  url: string
  title: string
  channel: string
  thumbnail: string | null
  duration_seconds: number | null
  topic_code: string
  topic_label: string
  fit: StudyFit
  fit_label: string
  fit_reason: string | null
}

export interface VideoSearchResponse {
  items: VideoSearchResult[]
  next_page_token: string | null
  unavailable: boolean
  message: string | null
}

/** The canonical link the Workspace already knows how to load. */
export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}

/** `750 → 12:30`, `3723 → 1:02:03`. Unknown duration renders as empty. */
export function formatDuration(seconds: number | null | undefined): string {
  if (!Number.isFinite(seconds) || !seconds || seconds < 0) return ''
  const total = Math.floor(seconds as number)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`
}

export function searchYouTube(
  query: string,
  pageToken?: string,
  signal?: AbortSignal,
): Promise<VideoSearchResponse> {
  const params = new URLSearchParams({ q: query.trim() })
  if (pageToken) params.set('page_token', pageToken)
  return apiFetch<VideoSearchResponse>(`/youtube/search?${params.toString()}`, { signal })
}
