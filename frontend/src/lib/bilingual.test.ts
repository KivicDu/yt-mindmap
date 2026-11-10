import { describe, expect, it } from 'vitest'
import { cueTextAt, type Cue } from './bilingual'

const cues: Cue[] = [
  { start: 0, duration: 4, text: 'hello' },
  { start: 4, duration: 4, text: 'world' },
  { start: 8, duration: 4, text: 'again' },
]

describe('cueTextAt', () => {
  it('returns the line that has started most recently', () => {
    expect(cueTextAt(cues, 0)).toBe('hello')
    expect(cueTextAt(cues, 5.5)).toBe('world')
    expect(cueTextAt(cues, 20)).toBe('again')
  })

  it('returns an empty string before the first line', () => {
    expect(cueTextAt([{ start: 3, duration: 2, text: 'later' }], 1)).toBe('')
    expect(cueTextAt([], 5)).toBe('')
  })
})
