import { describe, expect, it } from 'vitest'
import { getRouteMetadata } from './seo'

describe('getRouteMetadata', () => {
  it('keeps the home and legal pages indexable with canonical URLs', () => {
    expect(getRouteMetadata('/').robots).toBe('index,follow')
    expect(getRouteMetadata('/privacy').canonical).toBe(true)
    expect(getRouteMetadata('/terms').canonical).toBe(true)
  })

  it.each(['/app', '/app/project-id', '/dashboard', '/login', '/register', '/s/YTMM-123'])(
    'marks private or unlisted route %s as non-indexable',
    (pathname) => {
      expect(getRouteMetadata(pathname).robots).toBe('noindex,nofollow')
      expect(getRouteMetadata(pathname).canonical).not.toBe(true)
    },
  )

  it('uses a noindex fallback for unknown routes and normalizes trailing slashes', () => {
    expect(getRouteMetadata('/does-not-exist').robots).toBe('noindex,nofollow')
    expect(getRouteMetadata('/privacy/').title).toBe(getRouteMetadata('/privacy').title)
  })
})
