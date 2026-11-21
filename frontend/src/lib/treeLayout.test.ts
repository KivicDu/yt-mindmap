import { describe, expect, it } from 'vitest'
import { buildMapData, type MapNode, type MarkmapNode } from './mindmapTree'
import { layoutTreeDown } from './treeLayout'

const node = (id: string, label: string, children: MapNode[] = []): MapNode => ({
  id,
  parentId: null,
  label,
  children,
})

const tree = (nodes: MapNode[], title = 'Bài giảng'): MarkmapNode =>
  buildMapData({ title, nodes })

const boxOf = (layout: ReturnType<typeof layoutTreeDown>, id: string) => {
  const box = layout.boxes.find((item) => item.id === id)
  if (!box) throw new Error(`no box for ${id}`)
  return box
}

describe('layoutTreeDown', () => {
  it('puts the root on top and each level below its parent', () => {
    const layout = layoutTreeDown(
      tree([node('a', 'Nhánh A', [node('a1', 'Ý A1')]), node('b', 'Nhánh B')]),
    )

    const root = layout.boxes.find((box) => box.depth === 0)!
    const a = boxOf(layout, 'a')
    const a1 = boxOf(layout, 'a1')
    const b = boxOf(layout, 'b')

    expect(a.y).toBeGreaterThan(root.y)
    expect(b.y).toBeGreaterThan(root.y)
    expect(a1.y).toBeGreaterThan(a.y)
    // Siblings share a row, so the map reads left to right within a level.
    expect(a.y).toBe(b.y)
  })

  it('centres a parent over the span of its children', () => {
    const layout = layoutTreeDown(tree([node('a', 'A'), node('b', 'B'), node('c', 'C')]))

    const [a, b, c] = ['a', 'b', 'c'].map((id) => boxOf(layout, id))
    const root = layout.boxes.find((box) => box.depth === 0)!

    expect(a.x).toBeLessThan(b.x)
    expect(b.x).toBeLessThan(c.x)
    // The middle child sits under the root, not off to one side.
    expect(Math.abs(root.x - b.x)).toBeLessThan(0.01)
  })

  it('keeps sibling boxes from overlapping', () => {
    const layout = layoutTreeDown(
      tree([
        node('a', 'Một nhãn khá dài để đo chiều rộng thật của hộp'),
        node('b', 'Nhãn thứ hai cũng dài tương tự như vậy'),
      ]),
    )

    const [a, b] = ['a', 'b'].map((id) => boxOf(layout, id))
    const gap = b.x - b.width / 2 - (a.x + a.width / 2)
    expect(gap).toBeGreaterThanOrEqual(20)
  })

  it('gives every child an edge that starts at the parent and ends at the child', () => {
    const layout = layoutTreeDown(tree([node('a', 'A', [node('a1', 'A1')])]))
    const a = boxOf(layout, 'a')
    const a1 = boxOf(layout, 'a1')

    expect(layout.edges).toHaveLength(2)
    const edge = layout.edges.find((item) => item.depth === 2)!
    expect(edge.d.startsWith(`M ${a.x} ${a.y + a.height / 2}`)).toBe(true)
    expect(edge.d.endsWith(`${a1.x} ${a1.y - a1.height / 2}`)).toBe(true)
  })

  it('draws no guide rings and reports bounds around every box', () => {
    const layout = layoutTreeDown(tree([node('a', 'A'), node('b', 'B')]))
    const { x1, y1, x2, y2 } = layout.bounds

    expect(layout.rings).toEqual([])
    for (const box of layout.boxes) {
      expect(box.x - box.width / 2).toBeGreaterThanOrEqual(x1 - 0.01)
      expect(box.x + box.width / 2).toBeLessThanOrEqual(x2 + 0.01)
      expect(box.y - box.height / 2).toBeGreaterThanOrEqual(y1 - 0.01)
      expect(box.y + box.height / 2).toBeLessThanOrEqual(y2 + 0.01)
    }
  })

  it('honours a folded branch instead of laying out hidden children', () => {
    const root = tree([node('a', 'A', [node('a1', 'A1'), node('a2', 'A2')])])
    root.children[0].payload.fold = true

    const layout = layoutTreeDown(root)
    expect(layout.boxes.map((box) => box.id)).not.toContain('a1')
    expect(layout.edges).toHaveLength(1)
  })
})
