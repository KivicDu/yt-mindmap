import { describe, expect, it } from 'vitest'
import { likelyMissed, weakRangesFromMisses } from './review'

const cues = Array.from({ length: 6 }, (_, minute) => ({
  start: minute * 60,
  duration: 60,
  text: `phụ đề ${minute}`,
}))

describe('likelyMissed', () => {
  it('accepts the same words without diacritics', () => {
    expect(likelyMissed('dao ham cua ham so', 'Đạo hàm · Hàm số')).toBe(false)
  })

  it('flags an empty or unrelated answer as a minute to revisit', () => {
    expect(likelyMissed('   ', 'Đạo hàm')).toBe(true)
    expect(likelyMissed('không liên quan gì cả', 'Đạo hàm')).toBe(true)
  })
})

describe('weakRangesFromMisses', () => {
  it('groups missed timestamps into the same minute buckets as the index hint', () => {
    expect(
      weakRangesFromMisses([{ time: 10 }, { time: 70 }, { time: 130 }], cues),
    ).toEqual([[0, 180]])
  })

  it('drops untimed and out-of-range misses', () => {
    expect(weakRangesFromMisses([{ time: null }, { time: 999 }], cues)).toEqual([])
  })
})
