import { describe, expect, it } from 'vitest'
import { activeChapter, buildChapters } from './chapters'
import type { MapNode } from './mindmapTree'

const node = (id: string, label: string, extra: Partial<MapNode> = {}): MapNode => ({
  id,
  parentId: null,
  label,
  children: [],
  ...extra,
})

describe('buildChapters', () => {
  it('turns timed top-level topics into ordered chapters', () => {
    const chapters = buildChapters([
      node('b', 'Đạo hàm', { time: 120, children: [node('b1', 'Quy tắc chuỗi')] }),
      node('a', 'Giới hạn', { time: 10 }),
      node('c', 'Tích phân', { time: 300 }),
    ])

    expect(chapters.map((chapter) => [chapter.label, chapter.start])).toEqual([
      ['Giới hạn', 10],
      ['Đạo hàm', 120],
      ['Tích phân', 300],
    ])
    expect(chapters[1].end).toBe(300)
    expect(chapters[1].nodeCount).toBe(2)
    expect(chapters[2].end).toBeNull()
  })

  it('skips topics without a timestamp', () => {
    const chapters = buildChapters([
      node('a', 'Mở đầu', { time: 0 }),
      node('x', 'Chưa có mốc'),
      node('b', 'Kết', { time: 90 }),
    ])
    expect(chapters.map((chapter) => chapter.id)).toEqual(['a', 'b'])
  })

  it('needs at least two timed topics to build a timeline', () => {
    expect(buildChapters([node('a', 'Một', { time: 5 })])).toEqual([])
    expect(buildChapters([])).toEqual([])
  })

  it('collapses chapters that start at the same second', () => {
    const chapters = buildChapters([
      node('a', 'Một', { time: 5 }),
      node('b', 'Hai', { time: 5 }),
      node('c', 'Ba', { time: 40 }),
    ])
    expect(chapters.map((chapter) => chapter.label)).toEqual(['Một', 'Ba'])
  })

  it('falls back to a placeholder label for blank topics', () => {
    const chapters = buildChapters([
      node('a', '   ', { time: 0 }),
      node('b', 'Sau', { time: 30 }),
    ])
    expect(chapters[0].label).toBe('Chủ đề')
  })
})

describe('activeChapter', () => {
  const chapters = buildChapters([
    node('a', 'Một', { time: 10 }),
    node('b', 'Hai', { time: 100 }),
    node('c', 'Ba', { time: 200 }),
  ])

  it('finds the chapter containing the playhead', () => {
    expect(activeChapter(chapters, 150)?.id).toBe('b')
    expect(activeChapter(chapters, 500)?.id).toBe('c')
  })

  it('returns null before the first chapter', () => {
    expect(activeChapter(chapters, 3)).toBeNull()
  })
})
