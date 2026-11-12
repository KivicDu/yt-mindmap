import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_STYLE,
  MAP_LAYOUTS,
  MAP_PALETTES,
  branchColor,
  hasStoredStyle,
  normalizeStyle,
  readStoredStyle,
  storeStyle,
  styleFromSearch,
  stripStyleFromSearch,
  styleVars,
} from './mapStyle'

describe('map style catalog', () => {
  it('offers six pastel palettes and five layouts, all with unique ids', () => {
    expect(MAP_PALETTES).toHaveLength(6)
    expect(MAP_LAYOUTS).toHaveLength(5)
    expect(new Set(MAP_PALETTES.map((item) => item.id)).size).toBe(6)
    expect(new Set(MAP_LAYOUTS.map((item) => item.id)).size).toBe(5)
  })

  it('gives every palette six distinct branch colours', () => {
    for (const palette of MAP_PALETTES) {
      expect(palette.branches).toHaveLength(6)
      expect(new Set(palette.branches).size).toBe(6)
      // Pastel means light: a branch colour must not be darker than this, or
      // a long lecture stops being calm.
      for (const color of palette.branches) {
        const [r, g, b] = [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16))
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
        expect(luminance).toBeGreaterThan(0.45)
      }
    }
  })
})

describe('normalizeStyle', () => {
  it('falls back to the default for anything unknown', () => {
    expect(normalizeStyle(null)).toEqual(DEFAULT_STYLE)
    expect(normalizeStyle({ layout: 'radial-9000' as never, palette: 'neon' as never })).toEqual(
      DEFAULT_STYLE,
    )
  })

  it('keeps a known half of the pair and repairs the other', () => {
    expect(normalizeStyle({ layout: 'spider', palette: 'neon' as never })).toEqual({
      layout: 'spider',
      palette: DEFAULT_STYLE.palette,
    })
  })
})

describe('branchColor', () => {
  it('wraps around so a wide map never runs out of colours', () => {
    const first = branchColor('sage', 0)
    expect(branchColor('sage', 6)).toBe(first)
    expect(branchColor('sage', 13)).toBe(branchColor('sage', 1))
  })

  it('survives a negative or non-finite index', () => {
    expect(branchColor('sky', -1)).toBe(branchColor('sky', 1))
    expect(branchColor('sky', Number.NaN)).toBe(branchColor('sky', 0))
  })
})

describe('styleVars', () => {
  it('exports one custom property per branch colour', () => {
    const vars = styleVars({ layout: 'tree', palette: 'blush' })
    expect(Object.keys(vars)).toHaveLength(6)
    expect(vars['--mm-b1']).toBe(branchColor('blush', 0))
    expect(vars['--mm-b6']).toBe(branchColor('blush', 5))
  })
})

describe('style in the URL', () => {
  it('reads a picker handoff', () => {
    expect(styleFromSearch('?layout=bubble&palette=lilac')).toEqual({
      layout: 'bubble',
      palette: 'lilac',
    })
  })

  it('ignores a search with no style params', () => {
    expect(styleFromSearch('?q=math')).toBeNull()
    expect(styleFromSearch('')).toBeNull()
  })

  it('strips only the style params, keeping the rest of the query', () => {
    expect(stripStyleFromSearch('?layout=circle&palette=sand&q=math')).toBe('?q=math')
    expect(stripStyleFromSearch('?layout=circle&palette=sand')).toBe('')
  })
})

describe('remembering the chosen look', () => {
  // The suite runs in Node, so `window.localStorage` has to be faked. The
  // module's own guard is what a private-mode browser hits, and that is
  // covered by the "no window" case below.
  const fakeStorage = () => {
    const items = new Map<string, string>()
    const storage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
      clear: () => items.clear(),
    }
    vi.stubGlobal('window', { localStorage: storage })
    return storage
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('falls back to the default when there is no browser storage', () => {
    expect(hasStoredStyle()).toBe(false)
    expect(readStoredStyle()).toEqual(DEFAULT_STYLE)
  })

  it('tells a first visit apart from a remembered default', () => {
    fakeStorage()
    expect(hasStoredStyle()).toBe(false)

    // Choosing the default is still a choice, so the picker stays quiet next
    // time instead of asking the same question again.
    storeStyle(DEFAULT_STYLE)
    expect(hasStoredStyle()).toBe(true)
    expect(readStoredStyle()).toEqual(DEFAULT_STYLE)
  })

  it('round-trips a non-default choice', () => {
    fakeStorage()
    storeStyle({ layout: 'spider', palette: 'sage' })
    expect(readStoredStyle()).toEqual({ layout: 'spider', palette: 'sage' })
  })

  it('keeps a hand-edited value from breaking the map', () => {
    const storage = fakeStorage()
    storage.setItem('yt-mindmap:map-style', '{"layout":"nope"}')
    expect(hasStoredStyle()).toBe(true)
    expect(readStoredStyle()).toEqual(DEFAULT_STYLE)
  })
})
