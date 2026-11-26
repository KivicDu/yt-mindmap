import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_OUTPUT_LANGUAGE,
  normalizeOutputLanguage,
  outputLanguageName,
  readStoredOutputLanguage,
  storeOutputLanguage,
} from './outputLanguage'

let store: Map<string, string>

beforeEach(() => {
  store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('output language', () => {
  it('normalises only supported codes', () => {
    expect(normalizeOutputLanguage('VI')).toBe('vi')
    expect(normalizeOutputLanguage('en')).toBe('en')
    expect(normalizeOutputLanguage('not-a-language')).toBeNull()
    expect(normalizeOutputLanguage(null)).toBeNull()
  })

  it('keeps "follow the captions" as a distinct stored choice', () => {
    storeOutputLanguage(null)
    expect(store.has('ytmm:output-language')).toBe(false)
    expect(readStoredOutputLanguage()).toBeNull()

    storeOutputLanguage('en')
    expect(readStoredOutputLanguage()).toBe('en')

    store.set('ytmm:output-language', 'bogus')
    expect(readStoredOutputLanguage()).toBeNull()
  })

  it('starts a fresh workspace in Vietnamese', () => {
    expect(DEFAULT_OUTPUT_LANGUAGE).toBe('vi')
    expect(outputLanguageName(null)).toBe('Theo ngôn ngữ phụ đề')
    expect(outputLanguageName('vi')).toBe('Tiếng Việt')
  })
})
