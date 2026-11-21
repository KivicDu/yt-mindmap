import { describe, expect, it } from 'vitest'
import { buildMapData, type MapNode, type MarkmapNode } from './mindmapTree'
import { layoutRadial, measureNode, subtreeWeight } from './radialLayout'

const node = (id: string, label: string, children: MapNode[] = []): MapNode => ({
  id,
  parentId: null,
  label,
  children,
})

const tree = (nodes: MapNode[], title = 'Bài giảng'): MarkmapNode => buildMapData({ title, nodes })

const radiusOf = (x: number, y: number) => Math.round(Math.hypot(x, y) * 100) / 100

describe('subtreeWeight', () => {
  it('counts leaves so a wide branch gets a wider arc', () => {
    const root = tree([
      node('a', 'A', [node('a1', 'A1'), node('a2', 'A2'), node('a3', 'A3')]),
      node('b', 'B'),
    ])
    const [a, b] = root.children
    expect(subtreeWeight(a)).toBe(3)
    expect(subtreeWeight(b)).toBe(1)
  })

  it('stops at a folded branch', () => {
    const root = tree([node('a', 'A', [node('a1', 'A1')])])
    const a = root.children[0]
    expect(subtreeWeight(a)).toBe(1)
    a.payload.fold = true
    expect(subtreeWeight(a)).toBe(1)
  })
})

describe('measureNode', () => {
  it('grows with the label and stays inside the width cap', () => {
    const short = measureNode('Ngắn', 1)
    const long = measureNode('Một nhãn rất dài '.repeat(20), 1)

    expect(short.width).toBeGreaterThanOrEqual(104)
    expect(long.width).toBeLessThanOrEqual(248)
    expect(long.height).toBeGreaterThan(short.height)
  })

  it('gives the root a wider minimum so the title never looks cramped', () => {
    expect(measureNode('A', 0).width).toBeGreaterThan(measureNode('A', 1).width)
  })

  it('reserves a line for a node that carries a note', () => {
    const plain = measureNode('Đạo hàm riêng', 2)
    const noted = measureNode('Đạo hàm riêng<span class="mm-note">Ghi chú</span>', 2)
    expect(noted.height).toBeGreaterThan(plain.height)
  })
})

describe('layoutRadial', () => {
  it('puts every node of a depth on the same ring', () => {
    const layout = layoutRadial(
      tree([
        node('a', 'A', [node('a1', 'A1'), node('a2', 'A2')]),
        node('b', 'B'),
        node('c', 'C', [node('c1', 'C1')]),
      ]),
      'spider',
    )

    for (const depth of [1, 2]) {
      const radii = layout.boxes
        .filter((box) => box.depth === depth)
        .map((box) => radiusOf(box.x, box.y))
      expect(new Set(radii).size).toBe(1)
    }
  })

  it('never lets two labels on the same ring collide', () => {
    const layout = layoutRadial(
      tree(
        Array.from({ length: 8 }, (_, index) =>
          node(`n${index}`, `Chủ đề số ${index + 1} khá dài`),
        ),
      ),
      'bubble',
    )

    const ring = layout.boxes.filter((box) => box.depth === 1)
    for (let i = 0; i < ring.length; i += 1) {
      for (let j = i + 1; j < ring.length; j += 1) {
        const distance = Math.hypot(ring[i].x - ring[j].x, ring[i].y - ring[j].y)
        const needed = (ring[i].width + ring[j].width) / 2
        expect(distance).toBeGreaterThanOrEqual(needed)
      }
    }
  })

  it('colours a whole branch the same and numbers branches in order', () => {
    const layout = layoutRadial(
      tree([
        node('a', 'A', [node('a1', 'A1', [node('a1x', 'Sâu')])]),
        node('b', 'B'),
      ]),
      'circle',
    )
    const branchOf = (id: string) => layout.boxes.find((box) => box.id === id)?.branch

    expect(branchOf('a')).toBe(0)
    expect(branchOf('a1')).toBe(0)
    expect(branchOf('a1x')).toBe(0)
    expect(branchOf('b')).toBe(1)
    expect(layout.boxes.find((box) => box.depth === 0)?.branch).toBe(0)
  })

  it('hides the children of a folded branch', () => {
    const root = tree([node('a', 'A', [node('a1', 'A1')])])
    root.children[0].payload.fold = true

    const layout = layoutRadial(root, 'spider')
    const ids = layout.boxes.map((box) => box.id)
    expect(ids).toContain('a')
    expect(ids).not.toContain('a1')
    // Root plus the one visible branch: the folded child has no edge either.
    expect(layout.boxes).toHaveLength(2)
    expect(layout.edges).toHaveLength(1)
  })

  it('draws guide rings only for the circle family', () => {
    const data = tree([node('a', 'A', [node('a1', 'A1')])])
    expect(layoutRadial(data, 'circle').rings.length).toBeGreaterThan(0)
    expect(layoutRadial(data, 'spider').rings).toHaveLength(0)
    expect(layoutRadial(data, 'bubble').rings).toHaveLength(0)
  })

  it('gives the bubble family more air than the circle family', () => {
    // Six wide labels make the neighbour gap, not the minimum ring gap, decide
    // the radius — which is exactly what separates the two families.
    const data = tree(
      Array.from({ length: 6 }, (_, index) =>
        node(`n${index}`, `Chủ đề số ${index + 1} khá dài để đo`),
      ),
    )
    const bubble = layoutRadial(data, 'bubble')
    const circle = layoutRadial(data, 'circle')
    const ringOf = (layout: ReturnType<typeof layoutRadial>) => {
      const box = layout.boxes.find((item) => item.depth === 1)
      return box ? radiusOf(box.x, box.y) : 0
    }
    expect(ringOf(bubble)).toBeGreaterThan(ringOf(circle))
  })

  it('reports bounds that contain every label', () => {
    const layout = layoutRadial(
      tree([node('a', 'A', [node('a1', 'A1')]), node('b', 'B')]),
      'spider',
    )
    const { x1, y1, x2, y2 } = layout.bounds

    for (const box of layout.boxes) {
      expect(box.x - box.width / 2).toBeGreaterThanOrEqual(x1)
      expect(box.x + box.width / 2).toBeLessThanOrEqual(x2)
      expect(box.y - box.height / 2).toBeGreaterThanOrEqual(y1)
      expect(box.y + box.height / 2).toBeLessThanOrEqual(y2)
    }
  })

  it('produces finite geometry for a single root', () => {
    const bare: MarkmapNode = { content: 'Chỉ có gốc', children: [], payload: {} }
    const layout = layoutRadial(bare, 'spider')
    expect(layout.boxes).toHaveLength(1)
    expect(layout.edges).toHaveLength(0)
    expect(Number.isFinite(layout.bounds.x1)).toBe(true)
    expect(Number.isFinite(layout.bounds.x2)).toBe(true)
    expect(layout.bounds.x2).toBeGreaterThan(layout.bounds.x1)
  })

  it('never emits NaN coordinates on a deep, lopsided tree', () => {
    let deep = node('leaf', 'Lá')
    for (let depth = 0; depth < 6; depth += 1) {
      deep = node(`d${depth}`, `Tầng ${depth}`, [deep, node(`s${depth}`, `Nhánh ${depth}`)])
    }
    const layout = layoutRadial(tree([deep, node('wide', 'Rộng')]), 'circle')

    for (const box of layout.boxes) {
      expect(Number.isFinite(box.x)).toBe(true)
      expect(Number.isFinite(box.y)).toBe(true)
      expect(box.width).toBeGreaterThan(0)
      expect(box.height).toBeGreaterThan(0)
    }
    for (const edge of layout.edges) {
      expect(edge.d).not.toMatch(/NaN|Infinity/)
    }
  })
})
