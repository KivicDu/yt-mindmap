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
  tags: string[]
  transcript_language: string | null
  consumed_until: number
  created_at: string | null
  updated_at: string | null
  last_opened_at: string | null
}

/** A soft-deleted project, plus how long the owner can still restore it. */
export interface TrashedProject extends ProjectSummary {
  deleted_at: string | null
  days_left: number
}

export type SearchMatchKind = 'title' | 'node' | 'note' | 'summary' | 'transcript'

export interface SearchMatch {
  kind: SearchMatchKind
  text: string
  time: number | null
}

export interface SearchResult extends ProjectSummary {
  match_count: number
  matches: SearchMatch[]
}

export interface TagCount {
  tag: string
  count: number
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
  trashed: number
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

export type ProjectSort = 'updated' | 'created' | 'title'

export function listProjects(params: {
  draft?: boolean
  q?: string
  tag?: string
  sort?: ProjectSort
  limit?: number
  offset?: number
} = {}): Promise<ProjectList> {
  const search = new URLSearchParams()
  if (params.draft !== undefined) search.set('draft', String(params.draft))
  if (params.q?.trim()) search.set('q', params.q.trim())
  if (params.tag) search.set('tag', params.tag)
  if (params.sort) search.set('sort', params.sort)
  if (params.limit) search.set('limit', String(params.limit))
  if (params.offset) search.set('offset', String(params.offset))
  const query = search.toString()
  return apiFetch<ProjectList>(`/projects${query ? `?${query}` : ''}`)
}

export function listSharedProjects(params: {
  q?: string
  sort?: ProjectSort
  limit?: number
  offset?: number
} = {}): Promise<SharedProjectList> {
  const search = new URLSearchParams()
  if (params.q?.trim()) search.set('q', params.q.trim())
  if (params.sort) search.set('sort', params.sort)
  if (params.limit) search.set('limit', String(params.limit))
  if (params.offset) search.set('offset', String(params.offset))
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
  patch: {
    title?: string
    is_draft?: boolean
    visibility?: 'private' | 'unlisted'
    tags?: string[]
  },
): Promise<ProjectDetail> {
  return apiFetch<ProjectDetail>(`/projects/${id}`, { method: 'PATCH', body: patch })
}

export function deleteProject(id: string): Promise<void> {
  return apiFetch<void>(`/projects/${id}`, { method: 'DELETE' })
}

export function restoreProject(id: string): Promise<ProjectDetail> {
  return apiFetch<ProjectDetail>(`/projects/${id}/restore`, { method: 'POST', body: {} })
}

export function purgeProject(id: string): Promise<void> {
  return apiFetch<void>(`/projects/${id}/purge`, { method: 'DELETE' })
}

export function listTrash(
  params: { limit?: number; offset?: number } = {},
): Promise<{ items: TrashedProject[]; total: number; limit: number; offset: number }> {
  const search = new URLSearchParams()
  if (params.limit) search.set('limit', String(params.limit))
  if (params.offset) search.set('offset', String(params.offset))
  const query = search.toString()
  return apiFetch<{
    items: TrashedProject[]
    total: number
    limit: number
    offset: number
  }>(`/projects/trash${query ? `?${query}` : ''}`)
}

export function listTags(): Promise<{ items: TagCount[] }> {
  return apiFetch<{ items: TagCount[] }>('/projects/tags')
}

export function searchProjects(
  q: string,
  limit = 30,
): Promise<{ items: SearchResult[] }> {
  const search = new URLSearchParams({ q: q.trim(), limit: String(limit) })
  return apiFetch<{ items: SearchResult[] }>(`/projects/search?${search.toString()}`)
}

export function duplicateProject(id: string): Promise<ProjectSummary> {
  return apiFetch<ProjectSummary>(`/projects/${id}/duplicate`, { method: 'POST', body: {} })
}

export function fetchProjectStats(): Promise<ProjectStats> {
  return apiFetch<ProjectStats>('/projects/stats')
}

/* ---------------------------------------------------------------- */
/* Version history                                                  */
/* ---------------------------------------------------------------- */

export interface ProjectVersionSummary {
  id: string
  title: string
  node_count: number
  consumed_until: number
  summary: string
  created_at: string | null
}

export interface ProjectVersionDetail extends ProjectVersionSummary {
  nodes: MapNode[]
  summary_so_far: string
}

export function listProjectVersions(
  projectId: string,
): Promise<{ items: ProjectVersionSummary[] }> {
  return apiFetch<{ items: ProjectVersionSummary[] }>(`/projects/${projectId}/versions`)
}

export function getProjectVersion(
  projectId: string,
  versionId: string,
): Promise<ProjectVersionDetail> {
  return apiFetch<ProjectVersionDetail>(`/projects/${projectId}/versions/${versionId}`)
}

/** Roll the map back; the response also carries the restored project. */
export function restoreProjectVersion(
  projectId: string,
  versionId: string,
): Promise<ProjectDetail & { restored_version_id: string; session_id: string | null }> {
  return apiFetch<ProjectDetail & { restored_version_id: string; session_id: string | null }>(
    `/projects/${projectId}/versions/${versionId}/restore`,
    { method: 'POST', body: {} },
  )
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
