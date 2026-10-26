import { describe, expect, it } from 'vitest'
import {
  MAX_NOTE_CHARS,
  buildMapData,
  cleanLabel,
  cleanNote,
  collapseOlderBranches,
  collectIds,
  escapeHtml,
  findFirstNew,
  findNodeById,
  nodeToMarkmap,
  normalizeTree,
  type MapNode,
  type MarkmapNode,
} from './mindmapTree'

const node = (id: string, label: string, extra: Partial<MapNode> = {}): MapNode => ({
  id,
  parentId: null,
  label,
  children: [],
  ...extra,
})

describe('escapeHtml', () => {
  it('escapes the characters that would break markmap content', () => {
    expect(escapeHtml('<b>a & b</b> "q" \'s\'')).toBe(
      '&lt;b&gt;a &amp; b&lt;/b&gt; &quot;q&quot; &#39;s&#39;',
    )
  })

  it('handles nullish values', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })
})

describe('cleanLabel', () => {
  it('collapses whitespace', () => {
    expect(cleanLabel('  a\n\tb   c ')).toBe('a b c')
  })
})

describe('nodeToMarkmap', () => {
  it('turns a timestamped node into a seek link that carries the node id', () => {
    const data = nodeToMarkmap(node('abc', 'Recursion', { time: 12.34 }))
    expect(data.content).toBe('<a href="#seek-12.3" data-node-id="abc">Recursion</a>')
    expect(data.children).toEqual([])
  })

  it('renders a plain span when the node has no time', () => {
    expect(nodeToMarkmap(node('abc', 'Overview')).content).toBe(
      '<span data-node-id="abc">Overview</span>',
    )
  })

  it('escapes html in labels so text cannot inject markup', () => {
    const data = nodeToMarkmap(node('x', '<img src=x onerror=alert(1)>'))
    expect(data.content).toContain('&lt;img')
    expect(data.content).not.toContain('<img')
  })

  it('maps children recursively', () => {
    const parent = node('p', 'Parent', {
      children: [node('c', 'Child', { time: 3 })],
    })
    const data = nodeToMarkmap(parent)
    expect(data.children).toHaveLength(1)
    expect(data.children[0].content).toContain('href="#seek-3.0"')
    expect(data.children[0].content).toContain('data-node-id="c"')
  })
})

describe('buildMapData', () => {
  it('puts the title at the root and branches under it', () => {
    const data = buildMapData({ title: 'My lecture', nodes: [node('a', 'Topic')] })
    expect(data.content).toBe('My lecture')
    expect(data.children).toHaveLength(1)
    expect(data.children[0].content).toContain('Topic')
  })

  it('shows a placeholder branch when the map is empty', () => {
    const data = buildMapData({ title: 'My lecture', nodes: [] })
    expect(data.children).toHaveLength(1)
    expect(data.children[0].content).toContain('Mind map will build')
  })

  it('escapes the title', () => {
    expect(buildMapData({ title: '<x>', nodes: [] }).content).toBe('&lt;x&gt;')
  })
})

describe('collectIds', () => {
  it('collects every node id in the tree', () => {
    const root: MarkmapNode = {
      content: '<span data-node-id="root">Root</span>',
      payload: {},
      children: [
        {
          content: '<span data-node-id="a">A</span>',
          payload: {},
          children: [{ content: '<span data-node-id="b">B</span>', payload: {}, children: [] }],
        },
      ],
    }
    const ids = new Set<string>()
    collectIds(root, ids)
    expect([...ids]).toEqual(['root', 'a', 'b'])
  })

  it('ignores nodes without an id', () => {
    const ids = new Set<string>()
    collectIds({ content: 'plain text', payload: {}, children: [] }, ids)
    expect(ids.size).toBe(0)
  })
})

describe('findFirstNew', () => {
  const root = buildMapData({
    title: 'Title',
    nodes: [node('old', 'Old'), node('new', 'New', { children: [node('new-child', 'Child')] })],
  })

  it('returns the first node whose id was not known', () => {
    const found = findFirstNew(root, new Set(['old']), root)
    expect(found?.content).toContain('data-node-id="new"')
  })

  it('never returns the root title', () => {
    expect(findFirstNew(buildMapData({ title: 'T', nodes: [] }), new Set(), undefined)).toBeNull()
  })

  it('returns null when every id is already known', () => {
    const ids = new Set<string>()
    collectIds(root, ids)
    expect(findFirstNew(root, ids, root)).toBeNull()
  })

  it('handles empty input', () => {
    expect(findFirstNew(null, new Set(), null)).toBeNull()
  })
})

describe('collapseOlderBranches', () => {
  it('folds every branch except the newest keepLast', () => {
    const root = buildMapData({
      title: 'T',
      nodes: [node('a', 'A'), node('b', 'B'), node('c', 'C'), node('d', 'D')],
    })
    collapseOlderBranches(root, 2)
    expect(root.children.map((child) => child.payload.fold)).toEqual([1, 1, undefined, undefined])
  })

  it('does nothing when there are few branches', () => {
    const root = buildMapData({ title: 'T', nodes: [node('a', 'A'), node('b', 'B')] })
    collapseOlderBranches(root, 3)
    expect(root.children.every((child) => child.payload.fold === undefined)).toBe(true)
  })

  it('keeps existing payload fields', () => {
    const root = buildMapData({ title: 'T', nodes: [node('a', 'A'), node('b', 'B')] })
    root.children[0].payload = { color: 'red' }
    collapseOlderBranches(root, 1)
    expect(root.children[0].payload).toEqual({ color: 'red', fold: 1 })
  })

  it('tolerates a missing root', () => {
    expect(() => collapseOlderBranches(undefined, 1)).not.toThrow()
  })
})

describe('normalizeTree', () => {
  it('keeps valid nodes and their ids', () => {
    const tree = normalizeTree([{ id: 'a', parentId: null, label: ' A ', time: 1.5, children: [] }])
    expect(tree).toEqual([
      { id: 'a', parentId: null, label: 'A', time: 1.5, note: '', pinned: false, children: [] },
    ])
  })

  it('drops entries without a label and non-objects', () => {
    expect(normalizeTree([null, 3, { label: '  ' }, { label: 'Kept' }])).toHaveLength(1)
  })

  it('generates an id when one is missing', () => {
    const tree = normalizeTree([{ label: 'No id' }])
    expect(typeof tree[0].id).toBe('string')
    expect(tree[0].id.length).toBeGreaterThan(0)
  })

  it('rejects negative or non-numeric times', () => {
    const tree = normalizeTree([
      { id: 'a', label: 'A', time: -1 },
      { id: 'b', label: 'B', time: 'nope' },
    ])
    expect(tree.map((entry) => entry.time)).toEqual([null, null])
  })

  it('returns an empty array for garbage input', () => {
    expect(normalizeTree(undefined)).toEqual([])
    expect(normalizeTree({ nodes: [] })).toEqual([])
  })

  it('normalizes nested children', () => {
    const tree = normalizeTree([{ label: 'A', children: [{ label: 'B', children: 'x' }] }])
    expect(tree[0].children?.[0].label).toBe('B')
    expect(tree[0].children?.[0].children).toEqual([])
  })
})

describe('cleanNote', () => {
  it('keeps line breaks and trims the edges', () => {
    expect(cleanNote('  first line\nsecond  \n')).toBe('first line\nsecond')
  })

  it('normalises CRLF', () => {
    expect(cleanNote('a\r\nb')).toBe('a\nb')
  })

  it('caps the length and tolerates null', () => {
    expect(cleanNote(null)).toBe('')
    expect(cleanNote('x'.repeat(MAX_NOTE_CHARS + 50))).toHaveLength(MAX_NOTE_CHARS)
  })
})

describe('nodeToMarkmap user state', () => {
  it('renders a note as a second element after the label', () => {
    const data = nodeToMarkmap(node('a', 'Recursion', { time: 3, note: 'see 12:30' }))
    expect(data.content).toContain('>Recursion</a>')
    expect(data.content).toContain('<span class="mm-note">see 12:30</span>')
  })

  it('escapes a note so it cannot inject markup', () => {
    const data = nodeToMarkmap(node('a', 'A', { note: '<img src=x>' }))
    expect(data.content).not.toContain('<img')
    expect(data.content).toContain('&lt;img')
  })

  it('marks a pinned node with a pin glyph and a payload flag', () => {
    const data = nodeToMarkmap(node('a', 'A', { pinned: true }))
    expect(data.content).toContain('class="mm-pin"')
    expect(data.payload.pinned).toBe(true)
  })

  it('keeps note and pin on children', () => {
    const parent = node('p', 'Parent', {
      children: [node('c', 'Child', { note: 'child note', pinned: true })],
    })
    const child = nodeToMarkmap(parent).children[0]
    expect(child.content).toContain('mm-note')
    expect(child.content).toContain('mm-pin')
  })
})

describe('collapseOlderBranches with pins', () => {
  const rootWith = (nodes: MapNode[]) => buildMapData({ title: 'T', nodes })

  it('never folds a pinned branch', () => {
    const root = rootWith([
      node('a', 'A', { pinned: true }),
      node('b', 'B'),
      node('c', 'C'),
      node('d', 'D'),
    ])
    collapseOlderBranches(root, 2)
    expect(root.children.map((child) => child.payload.fold)).toEqual([undefined, 1, undefined, undefined])
  })

  it('folds unpinned branches of the same batch', () => {
    const root = rootWith([node('a', 'A'), node('b', 'B'), node('c', 'C')])
    collapseOlderBranches(root, 1)
    expect(root.children.map((child) => child.payload.fold)).toEqual([1, 1, undefined])
  })
})

describe('findNodeById', () => {
  const tree = [
    node('a', 'A', {
      children: [node('a1', 'A1', { children: [node('a1x', 'A1X')] })],
    }),
    node('b', 'B'),
  ]

  it('finds a root, a child and a grandchild', () => {
    expect(findNodeById(tree, 'a')?.label).toBe('A')
    expect(findNodeById(tree, 'a1')?.label).toBe('A1')
    expect(findNodeById(tree, 'a1x')?.label).toBe('A1X')
  })

  it('returns null for an unknown id or empty tree', () => {
    expect(findNodeById(tree, 'nope')).toBeNull()
    expect(findNodeById([], 'a')).toBeNull()
  })
})

describe('normalizeTree user state', () => {
  it('keeps notes, pins and aliases from the server', () => {
    const tree = normalizeTree([
      { id: 'a', label: 'Đệ quy', note: 'ghi chú', pinned: true, aliases: ['recursion'] },
    ])
    expect(tree[0].note).toBe('ghi chú')
    expect(tree[0].pinned).toBe(true)
    expect(tree[0].aliases).toEqual(['recursion'])
  })

  it('defaults missing state and drops bad aliases', () => {
    const tree = normalizeTree([{ id: 'a', label: 'A', pinned: 'yes', aliases: [1, 'x'] }])
    expect(tree[0].note).toBe('')
    expect(tree[0].pinned).toBe(false)
    expect(tree[0].aliases).toEqual(['x'])
  })

  it('omits the alias key when there are none', () => {
    expect('aliases' in normalizeTree([{ id: 'a', label: 'A' }])[0]).toBe(false)
  })
})
