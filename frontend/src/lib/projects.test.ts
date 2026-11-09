import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatWhen, listProjects, listSharedProjects, parseShareSlug } from './projects'

afterEach(() => {
  vi.unstubAllGlobals()
})

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

describe('project list queries', () => {
  function mockList() {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ items: [], total: 0, limit: 10, offset: 0 }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    return fetchMock
  }

  it('sends search, sort and paging for owned projects', async () => {
    const fetchMock = mockList()

    await listProjects({
      draft: false,
      q: '  giải  ',
      sort: 'title',
      limit: 10,
      offset: 10,
    })

    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/api/projects?')
    expect(url).toContain('draft=false')
    expect(url).toContain('q=gi%E1%BA%A3i')
    expect(url).toContain('sort=title')
    expect(url).toContain('limit=10')
    expect(url).toContain('offset=10')
  })

  it('omits empty searches and a zero offset', async () => {
    const fetchMock = mockList()

    await listProjects({ q: '   ', sort: 'created' })

    const url = String(fetchMock.mock.calls[0][0])
    expect(url).not.toContain('q=')
    expect(url).not.toContain('offset=')
    expect(url).toContain('sort=created')
  })

  it('uses the shared endpoint with the same paging options', async () => {
    const fetchMock = mockList()

    await listSharedProjects({ sort: 'updated', limit: 10, offset: 20 })

    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/api/projects/shared?')
    expect(url).toContain('sort=updated')
    expect(url).toContain('limit=10')
    expect(url).toContain('offset=20')
  })
})
