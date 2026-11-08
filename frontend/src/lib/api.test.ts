import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAccessToken, refreshSession, setAccessToken } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
  setAccessToken(null)
})

describe('refreshSession', () => {
  it('shares one request between concurrent callers', async () => {
    // Rotation makes a second refresh with the same cookie fail, so callers
    // that hit a 401 together must not each start their own refresh.
    let resolveFetch!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })
    const fetchMock = vi.fn(() => pending)
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const first = refreshSession()
    const second = refreshSession()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch(
      new Response(JSON.stringify({ access_token: 'fresh-token' }), { status: 200 }),
    )

    expect(await first).toBe(true)
    expect(await second).toBe(true)
    expect(getAccessToken()).toBe('fresh-token')
  })

  it('starts a new request once the previous one settles', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'one' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'two' }), { status: 200 }),
      )
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    expect(await refreshSession()).toBe(true)
    expect(await refreshSession()).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(getAccessToken()).toBe('two')
  })

  it('clears the access token when the refresh cookie is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 401 })) as unknown as typeof fetch,
    )

    expect(await refreshSession()).toBe(false)
    expect(getAccessToken()).toBeNull()
  })
})
