/**
 * One place for the API base URL and for attaching credentials.
 *
 * The access token lives only in memory (never localStorage): a refresh token
 * in an HttpOnly cookie is what survives a reload. When a request comes back
 * 401 we try one silent refresh, then replay the original request.
 */

export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8001'
export const API_ROOT = `${API_BASE}/api`

/**
 * OAuth is a full-page redirect: the API sends the browser to Google/GitHub and
 * back, so there is no fetch to call here. The provider list comes from
 * `/auth/providers` so disabled buttons reflect the server configuration.
 */
export function oauthStartUrl(provider: 'google' | 'github'): string {
  return `${API_ROOT}/auth/${provider}`
}

export interface OAuthProviders {
  google: boolean
  github: boolean
}

const NO_PROVIDERS: OAuthProviders = { google: false, github: false }
let providersRequest: Promise<OAuthProviders> | null = null

/** Which OAuth buttons the server can actually handle (cached per page load). */
export function fetchOAuthProviders(): Promise<OAuthProviders> {
  providersRequest ??= fetch(`${API_ROOT}/auth/providers`, { credentials: 'include' })
    .then((response) => (response.ok ? (response.json() as Promise<OAuthProviders>) : NO_PROVIDERS))
    .catch(() => NO_PROVIDERS)
  return providersRequest
}

/** Non-secret cookie the API sets alongside the HttpOnly refresh token. */
export const SESSION_HINT_COOKIE = 'ytmm_session'

/**
 * True when the browser last received a session. Lets the app skip the
 * /auth/refresh round-trip (and its 401 in the console) for first-time visitors.
 */
export function hasSessionHint(): boolean {
  return document.cookie
    .split(';')
    .some((part) => part.trim().startsWith(`${SESSION_HINT_COOKIE}=`))
}

export class ApiError extends Error {
  status: number
  detail: unknown

  constructor(status: number, detail: unknown, message?: string) {
    super(message || `request failed with ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

let accessToken: string | null = null
let sessionLostHandler: (() => void) | null = null

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string | null): void {
  accessToken = token
}

/** Called when a refresh attempt fails, so the UI can drop the session. */
export function onSessionLost(handler: (() => void) | null): void {
  sessionLostHandler = handler
}

interface RequestOptions {
  method?: string
  body?: unknown
  signal?: AbortSignal
  /** Skip the Authorization header (login/register/refresh). */
  anonymous?: boolean
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (!options.anonymous && accessToken) headers.Authorization = `Bearer ${accessToken}`

  return fetch(`${API_ROOT}${path}`, {
    method: options.method || (options.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'include',
    signal: options.signal,
  })
}

/** Ask for a new access token using the HttpOnly refresh cookie. */
export async function refreshSession(): Promise<boolean> {
  const response = await send('/auth/refresh', { method: 'POST', anonymous: true })
  if (!response.ok) {
    setAccessToken(null)
    return false
  }
  const data = (await response.json()) as { access_token: string }
  setAccessToken(data.access_token)
  return true
}

async function toError(response: Response): Promise<ApiError> {
  let detail: unknown = null
  try {
    detail = (await response.json())?.detail ?? null
  } catch {
    detail = null
  }
  return new ApiError(response.status, detail)
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await send(path, options)

  if (response.status === 401 && !options.anonymous && accessToken) {
    const refreshed = await refreshSession()
    if (refreshed) {
      response = await send(path, options)
    } else {
      sessionLostHandler?.()
    }
  }

  if (!response.ok) throw await toError(response)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

/** Read the error detail the API puts in `detail`, e.g. "email_taken". */
export function errorCode(error: unknown): string | null {
  if (error instanceof ApiError && typeof error.detail === 'string') return error.detail
  return null
}
