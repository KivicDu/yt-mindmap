import { describe, expect, it } from 'vitest'
import { SHORTCUTS, isTypingTarget, shortcutFor } from './shortcuts'

const page = { typing: false, hasHistory: true }

describe('shortcutFor', () => {
  it('maps the playback and tab keys', () => {
    expect(shortcutFor({ key: 'k' }, page)).toBe('toggle-play')
    expect(shortcutFor({ key: 'J' }, page)).toBe('seek-back')
    expect(shortcutFor({ key: 'l' }, page)).toBe('seek-forward')
    expect(shortcutFor({ key: 's' }, page)).toBe('tab-session')
    expect(shortcutFor({ key: 't' }, page)).toBe('tab-transcript')
    expect(shortcutFor({ key: 'h' }, page)).toBe('tab-history')
    expect(shortcutFor({ key: 'f' }, page)).toBe('fit-map')
    expect(shortcutFor({ key: '?' }, page)).toBe('toggle-help')
  })

  it('leaves typing alone except for Escape', () => {
    const typing = { typing: true, hasHistory: true }
    expect(shortcutFor({ key: 'k' }, typing)).toBeNull()
    expect(shortcutFor({ key: '?' }, typing)).toBeNull()
    expect(shortcutFor({ key: 'Escape' }, typing)).toBe('escape')
  })

  it('ignores modifier combos so browser shortcuts still work', () => {
    expect(shortcutFor({ key: 'k', metaKey: true }, page)).toBeNull()
    expect(shortcutFor({ key: 'f', ctrlKey: true }, page)).toBeNull()
    expect(shortcutFor({ key: 's', altKey: true }, page)).toBeNull()
  })

  it('only offers the history tab when it exists', () => {
    expect(shortcutFor({ key: 'h' }, { typing: false, hasHistory: false })).toBeNull()
  })

  it('ignores unassigned keys', () => {
    expect(shortcutFor({ key: 'x' }, page)).toBeNull()
    expect(shortcutFor({ key: 'Enter' }, page)).toBeNull()
  })
})

describe('isTypingTarget', () => {
  it('recognises form fields', () => {
    expect(isTypingTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true)
    expect(isTypingTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true)
    expect(isTypingTarget({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true)
    expect(
      isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget),
    ).toBe(true)
  })

  it('lets the page handle keys from ordinary elements', () => {
    expect(isTypingTarget({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

describe('SHORTCUTS', () => {
  it('documents every action exactly once', () => {
    const actions = SHORTCUTS.map((item) => item.action)
    expect(new Set(actions).size).toBe(actions.length)
    expect(actions).toContain('toggle-help')
    expect(actions).toContain('fit-map')
  })
})
