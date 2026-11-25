import { describe, expect, it } from 'vitest'
import { exportSlug, mapToMarkdown, parseStudyOutline } from './mapExport'
import type { MapNode } from './mindmapTree'

const NODES: MapNode[] = [
  {
    id: 'root',
    parentId: null,
    label: 'Root',
    time: 0,
    children: [
      {
        id: 'a',
        parentId: 'root',
        label: 'Ý chính',
        time: 65,
        note: 'ghi chú\ndòng 2',
        children: [],
      },
    ],
  },
]

describe('exportSlug', () => {
  it('strips accents and unsafe characters for a filename', () => {
    expect(exportSlug('Tổng quan: Bài giảng #1')).toBe('tong-quan-bai-giang-1')
  })

  it('falls back to a stable name when nothing remains', () => {
    expect(exportSlug('!!!')).toBe('mindmap')
  })
})

describe('mapToMarkdown', () => {
  it('writes nested bullets with timestamps and notes', () => {
    const markdown = mapToMarkdown({ title: 'Bài giảng', nodes: NODES })

    expect(markdown).toContain('# Bài giảng')
    expect(markdown).toContain('- [0:00] Root')
    expect(markdown).toContain('  - [1:05] Ý chính')
    expect(markdown).toContain('    > ghi chú')
    expect(markdown).toContain('    > dòng 2')
  })

  it('uses a fallback title for an untitled map', () => {
    expect(mapToMarkdown({ title: '', nodes: [] })).toBe('# Mind map\n\n')
  })
})

describe('parseStudyOutline', () => {
  it('recovers depth, playable timestamps and notes from the export', () => {
    const items = parseStudyOutline(mapToMarkdown({ title: 'Bài giảng', nodes: NODES }))

    expect(items).toEqual([
      { depth: 0, seconds: 0, label: 'Root', notes: [] },
      { depth: 1, seconds: 65, label: 'Ý chính', notes: ['ghi chú', 'dòng 2'] },
    ])
  })

  it('keeps untimed ideas and ignores headings', () => {
    expect(parseStudyOutline('# Tên\n\n- Ý không có mốc\n')).toEqual([
      { depth: 0, seconds: null, label: 'Ý không có mốc', notes: [] },
    ])
  })
})
