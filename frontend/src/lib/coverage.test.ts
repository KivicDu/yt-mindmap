import { describe, expect, it } from 'vitest'
import { findEmptyMinutes, lectureDuration } from './coverage'
import type { MapNode } from './mindmapTree'
import type { TranscriptCue } from './projects'

const cues: TranscriptCue[] = Array.from({ length: 6 }, (_, minute) => ({
  start: minute * 60,
  duration: 60,
  text: `phụ đề ${minute}`,
}))

const node = (time: number): MapNode => ({
  id: `n-${time}`,
  parentId: null,
  label: 'Nhánh',
  time,
  children: [],
})

describe('lectureDuration', () => {
  it('uses the end of the last cue', () => {
    expect(lectureDuration(cues)).toBe(360)
    expect(lectureDuration([{ start: 12, duration: 3.5, text: 'x' }])).toBe(15.5)
  })
})

describe('findEmptyMinutes', () => {
  it('merges consecutive uncovered minutes and leaves covered ones alone', () => {
    expect(findEmptyMinutes([node(30), node(180)], cues)).toEqual([
      { start: 60, end: 180, minutes: 2 },
      { start: 240, end: 360, minutes: 2 },
    ])
  })

  it('counts the intro before the first branch', () => {
    expect(findEmptyMinutes([node(125)], cues)).toEqual([
      { start: 0, end: 120, minutes: 2 },
      { start: 180, end: 360, minutes: 3 },
    ])
  })

  it('stays quiet while the map has no timestamps or the cues have no length', () => {
    expect(findEmptyMinutes([], cues)).toEqual([])
    expect(findEmptyMinutes([node(30)], [])).toEqual([])
  })

  it('ignores a timestamp beyond the end of the lecture', () => {
    expect(findEmptyMinutes([node(999)], cues)).toEqual([])
  })
})
