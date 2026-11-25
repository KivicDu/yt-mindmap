import { describe, expect, it } from 'vitest'
import { parseDeepLink, stripDeepLinkFromSearch } from './deepLink'

describe('deep links', () => {
  it('reads a moment and a node together', () => {
    expect(parseDeepLink('?t=93.5&node=abc-123')).toEqual({ t: 93.5, node: 'abc-123' })
  })

  it('accepts m:ss and h:mm:ss like YouTube itself', () => {
    expect(parseDeepLink('?t=1:30').t).toBe(90)
    expect(parseDeepLink('?t=1:02:03').t).toBe(3723)
    expect(parseDeepLink('?t=90:30').t).toBe(5430)
  })

  it('ignores missing or nonsense values instead of seeking', () => {
    expect(parseDeepLink('')).toEqual({ t: null, node: null })
    expect(parseDeepLink('?t=-5&node=').t).toBeNull()
    expect(parseDeepLink('?t=abc').t).toBeNull()
    expect(parseDeepLink('?t=1:99').t).toBeNull()
    expect(parseDeepLink('?node=<script>').node).toBeNull()
    expect(parseDeepLink(`?node=${'a'.repeat(129)}`).node).toBeNull()
  })

  it('strips only what it consumed', () => {
    expect(stripDeepLinkFromSearch('?t=12&node=a&layout=bubble&q=math')).toBe(
      '?layout=bubble&q=math',
    )
    expect(stripDeepLinkFromSearch('?t=12&node=a')).toBe('')
    expect(stripDeepLinkFromSearch('?q=math')).toBe('?q=math')
  })
})
