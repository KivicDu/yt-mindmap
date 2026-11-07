/**
 * Saved projects (phase 2) and the guest draft that stands in before login.
 *
 * Signed-in maps live in PostgreSQL, per user. Guests still get persistence,
 * but only inside this browser, and the transcript is not stored there (it is
 * re-fetched from YouTube when the draft is reopened).
 */

import { apiFetch } from './api'
import type { MapNode } from './mindmapTree'

export interface TranscriptCue {
  start: number
  duration: number
  text: string
}

export interface ProjectSummary {
  id: string
  title: string
  video_id: string | null
  is_draft: boolean
  visibility: string
  share_slug: string | null
  link_role: ShareRole
  node_count: number
  transcript_language: string | null
  consumed_until: number
  created_at: string | null
  updated_at: string | null
  last_opened_at: string | null
}

export type ShareRole = 'viewer' | 'editor'
export type ShareAccess = 'anyone' | 'invited'

export interface SharedProjectSummary extends ProjectSummary {
  role: ShareRole
  owner_name: string
}

export interface ProjectDetail extends ProjectSummary {
  nodes: MapNode[]
  transcript: TranscriptCue[]
  summary_so_far: string
}

export interface ProjectStats {
  saved: number
  drafts: number
  shared: number
  shared_with_me: number
  recent: ProjectSummary[]
}

export interface ProjectList {
  items: ProjectSummary[]
  total: number
  limit: number
  offset: number
}

export interface SharedProjectList extends ProjectList {
  items: SharedProjectSummary[]
}

export interface ShareMember {
  id: string
  email: string
  role: ShareRole
  registered: boolean
  created_at: string | null
}

export interface ShareSettings {
  enabled: boolean
  access: ShareAccess
  role: ShareRole
  slug: string | null
  visibility: 'private' | 'unlisted' | 'invited'
  members: ShareMember[]
}

/** What `/api/share/:slug` returns to a link holder. */
export interface SharedProjectView {
  project: ProjectDetail
  role: ShareRole
  can_edit: boolean
  requires_login: boolean
  owner_name: string
  session_id: string | null
}

export function listProjects(params: {
  draft?: boolean
  q?: string
  limit?: number
} = {}): Promise<ProjectList> {
  const search = new URLSearchParams()
  if (params.draft !== undefined) search.set('draft', String(params.draft))
  if (params.q?.trim()) search.set('q', params.q.trim())
  if (params.limit) search.set('limit', String(params.limit))
  const query = search.toString()
  return apiFetch<ProjectList>(`/projects${query ? `?${query}` : ''}`)
}

export function listSharedProjects(params: {
  q?: string
  limit?: number
} = {}): Promise<SharedProjectList> {
  const search = new URLSearchParams()
  if (params.q?.trim()) search.set('q', params.q.trim())
  if (params.limit) search.set('limit', String(params.limit))
  const query = search.toString()
  return apiFetch<SharedProjectList>(`/projects/shared${query ? `?${query}` : ''}`)
}

export function getProject(id: string): Promise<ProjectDetail> {
  return apiFetch<ProjectDetail>(`/projects/${id}`)
}

export function getSharedBySlug(slug: string): Promise<SharedProjectView> {
  return apiFetch<SharedProjectView>(`/share/${encodeURIComponent(slug)}`)
}

export function updateProject(
  id: string,
  patch: { title?: string; is_draft?: boolean; visibility?: 'private' | 'unlisted' },
): Promise<ProjectDetail> {
  return apiFetch<ProjectDetail>(`/projects/${id}`, { method: 'PATCH', body: patch })
}

export function deleteProject(id: string): Promise<void> {
  return apiFetch<void>(`/projects/${id}`, { method: 'DELETE' })
}

export function duplicateProject(id: string): Promise<ProjectSummary> {
  return apiFetch<ProjectSummary>(`/projects/${id}/duplicate`, { method: 'POST', body: {} })
}

export function fetchProjectStats(): Promise<ProjectStats> {
  return apiFetch<ProjectStats>('/projects/stats')
}

/* ---------------------------------------------------------------- */
/* Sharing                                                          */
/* ---------------------------------------------------------------- */

export function getShareSettings(projectId: string): Promise<ShareSettings> {
  return apiFetch<ShareSettings>(`/projects/${projectId}/share`)
}

export function updateShareSettings(
  projectId: string,
  input: { enabled: boolean; access?: ShareAccess; role?: ShareRole },
): Promise<ShareSettings> {
  return apiFetch<ShareSettings>(`/projects/${projectId}/share`, {
    method: 'PUT',
    body: { access: 'anyone', role: 'viewer', ...input },
  })
}

export function rotateShareLink(
  projectId: string,
  role?: ShareRole,
): Promise<ShareSettings> {
  return apiFetch<ShareSettings>(`/projects/${projectId}/share/rotate`, {
    method: 'POST',
    body: role ? { role } : {},
  })
}

export function addShareMember(
  projectId: string,
  email: string,
  role: ShareRole,
): Promise<ShareMember> {
  return apiFetch<ShareMember>(`/projects/${projectId}/members`, {
    method: 'POST',
    body: { email, role },
  })
}

export function updateShareMember(
  projectId: string,
  memberId: string,
  role: ShareRole,
): Promise<ShareMember> {
  return apiFetch<ShareMember>(`/projects/${projectId}/members/${memberId}`, {
    method: 'PATCH',
    body: { role },
  })
}

export function removeShareMember(projectId: string, memberId: string): Promise<void> {
  return apiFetch<void>(`/projects/${projectId}/members/${memberId}`, {
    method: 'DELETE',
  })
}

/** Absolute URL a recipient can open without an account. */
export function shareUrl(slug: string): string {
  return `${window.location.origin}/s/${slug}`
}

const SLUG_PATTERN = /YTMM-[A-Z0-9]{8}/i

/** Accept either a bare slug or a full share link and return the slug. */
export function parseShareSlug(input: string): string | null {
  const match = input.trim().match(SLUG_PATTERN)
  return match ? match[0].toUpperCase() : null
}

/**
 * Copy the live session into the database. Only ids travel: the server already
 * holds the nodes, transcript and AI summary.
 */
export function autosaveProject(input: {
  session_id: string
  project_id?: string | null
}): Promise<ProjectSummary> {
  return apiFetch<ProjectSummary>('/projects/autosave', {
    method: 'POST',
    body: {
      session_id: input.session_id,
      project_id: input.project_id || null,
    },
  })
}

/* ---------------------------------------------------------------- */
/* Guest draft (localStorage)                                       */
/* ---------------------------------------------------------------- */

export interface LocalDraft {
  videoId: string | null
  url: string
  title: string
  nodes: MapNode[]
  consumedUntil: number
  language: string | null
  savedAt: string
}

const DRAFT_KEY = 'ytmm:guest-draft'

export function readLocalDraft(): LocalDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LocalDraft
    if (!parsed || !parsed.url || !Array.isArray(parsed.nodes)) return null
    return parsed
  } catch {
    return null
  }
}

export function writeLocalDraft(draft: LocalDraft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // Quota or private mode: losing a guest draft is not worth an error screen.
  }
}

export function clearLocalDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    // ignore
  }
}

/** "vừa xong", "12 phút trước", "3 ngày trước", then a date. */
export function formatWhen(iso: string | null): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (seconds < 45) return 'vừa xong'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} phút trước`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} giờ trước`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} ngày trước`
  return new Date(then).toLocaleDateString('vi-VN')
}
