/**
 * "Phút trống" — whole lecture minutes that no branch timestamp can jump to.
 *
 * This is a navigation hint, not a judgement about the lecture: an intro or a
 * silent spell simply has no index entry yet. A branch covers the minute bucket
 * its timestamp falls in. Consecutive empty buckets are merged into one range
 * so a long gap does not produce a wall of warnings.
 *
 * ADR 0014 reuses this arithmetic for `weak_ranges`, so it stays pure and lives
 * in the lib rather than inside a page.
 */

import type { MapNode } from './mindmapTree'
import type { TranscriptCue } from './projects'

export interface EmptyMinuteRange {
  /** Start of the first empty minute, in seconds. */
  start: number
  /** End of the last empty minute (exclusive), in seconds. */
  end: number
  minutes: number
}

function timed(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** Lecture length from the cues; a saved project carries no separate duration. */
export function lectureDuration(cues: Array<{ start: number; duration: number }>): number {
  return cues.reduce(
    (latest, cue) => Math.max(latest, cue.start + Math.max(0, cue.duration || 0)),
    0,
  )
}

/** Merge a set of minute buckets into contiguous ranges. */
function rangesFromBuckets(buckets: Set<number>): EmptyMinuteRange[] {
  if (buckets.size === 0) return []
  const ranges: EmptyMinuteRange[] = []
  let first = -1
  let last = -1
  const flush = () => {
    if (first >= 0) {
      ranges.push({ start: first * 60, end: (last + 1) * 60, minutes: last - first + 1 })
    }
    first = -1
    last = -1
  }

  const ordered = [...buckets].sort((a, b) => a - b)
  for (const minute of ordered) {
    if (first >= 0 && minute === last + 1) {
      last = minute
    } else {
      flush()
      first = minute
      last = minute
    }
  }
  flush()
  return ranges
}

/** Buckets containing at least one of the given times (used for weak ranges). */
export function minuteRangesFromTimes(times: number[], duration: number): EmptyMinuteRange[] {
  const buckets = new Set<number>()
  for (const time of times) {
    if (timed(time) && time < duration) buckets.add(Math.floor(time / 60))
  }
  return rangesFromBuckets(buckets)
}

/** Merge consecutive uncovered minute buckets into ranges. */
export function findEmptyMinutes(nodes: MapNode[], cues: TranscriptCue[]): EmptyMinuteRange[] {
  const duration = lectureDuration(cues)
  if (duration <= 0) return []

  const covered = new Set<number>()
  for (const node of nodes) {
    if (timed(node.time) && node.time < duration) {
      covered.add(Math.floor(node.time / 60))
    }
  }
  // No timestamps yet means the map is still building, not that everything is
  // empty. Stay quiet until there is something to compare against.
  if (covered.size === 0) return []

  const empty = new Set<number>()
  const totalMinutes = Math.floor((duration - 1) / 60) + 1
  for (let minute = 0; minute < totalMinutes; minute += 1) {
    if (!covered.has(minute)) empty.add(minute)
  }
  return rangesFromBuckets(empty)
}
