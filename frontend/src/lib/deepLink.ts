/**
 * `?t=&node=` — a link to one moment of the lecture and one idea on the map.
 *
 * The two parts are independent: `t` seeks the player, `node` selects (and
 * reveals) a branch. Both are optional and invalid values are ignored rather
 * than throwing, because these URLs are typed, copied and truncated by people.
 */

export interface DeepLink {
  /** Seconds into the video, or null when absent/invalid. */
  t: number | null
  /** Node id to select, or null when absent/invalid. */
  node: string | null
}

const NODE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/

/**
 * Accept plain seconds (`?t=90`, `?t=90.5`) and the familiar `m:ss` / `h:mm:ss`
 * shapes. Anything else is not a playhead and must not move the player.
 */
function parseSeconds(raw: string | null): number | null {
  if (!raw) return null
  const value = raw.trim()
  if (!value) return null

  if (/^\d+(?:\.\d+)?$/.test(value)) {
    const seconds = Number(value)
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
  }

  const parts = value.split(':')
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) {
    return null
  }
  const numbers = parts.map(Number)
  if (numbers.some((part) => part < 0)) return null
  // Minutes and seconds are fields; hours are a count and may be large.
  if (numbers.length === 2 && numbers[1] > 59) return null
  if (numbers.length === 3 && (numbers[1] > 59 || numbers[2] > 59)) return null
  const seconds =
    numbers.length === 3
      ? numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
      : numbers[0] * 60 + numbers[1]
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
}

/** Read a deep link without mutating the URL. */
export function parseDeepLink(search: string): DeepLink {
  const params = new URLSearchParams(search)
  const rawNode = params.get('node')?.trim() ?? ''
  return {
    t: parseSeconds(params.get('t')),
    node: NODE_ID_RE.test(rawNode) ? rawNode : null,
  }
}

/** Remove only the params the page has consumed; keep unrelated query keys. */
export function stripDeepLinkFromSearch(search: string): string {
  const params = new URLSearchParams(search)
  params.delete('t')
  params.delete('node')
  const rest = params.toString()
  return rest ? `?${rest}` : ''
}
